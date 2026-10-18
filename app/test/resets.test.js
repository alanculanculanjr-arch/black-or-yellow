const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db');
const { createGame } = require('../src/game');
const { createPlayers } = require('../src/players');
const { createPoints } = require('../src/points');
const { createWallet } = require('../src/wallet');
const { createBanker } = require('../src/banker');
const { createResets, KEEP_BACKUPS } = require('../src/resets');
const { watchNetwork } = require('../src/network');

function setup() {
  const db = openDatabase(':memory:');
  const game = createGame(db);
  const wallet = createWallet(db);
  const points = createPoints(db, game, wallet);
  const players = createPlayers(db, game, { onRegistered: points.grantStartingCredit });
  const banker = createBanker(db);
  banker.setAccount('banker', 'secret123');
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'by-backups-'));
  const resets = createResets({ db, game, banker, points, backupDir });
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { db, game, wallet, points, players, resets, backupDir, count };
}

test('reset A: balances and history cleared, accounts kept, optional starting points', async () => {
  const t = setup();
  const a = t.players.register('Alpha1');
  t.points.decide(t.points.requestPurchase(a.player.id, 80).request.id, 'approve');
  t.points.setStartingBalance(30); // current setting is what gets re-granted

  const r = await t.resets.resetPoints('secret123');
  assert.equal(r.ok, true);
  assert.equal(t.players.get(a.player.id).balance, 30);
  assert.equal(t.players.findBySession(a.token).nickname, 'Alpha1', 'phone login still works');
  assert.equal(t.count('point_requests'), 0);
  assert.equal(t.count('transactions'), 1, 'only the fresh STARTING_CREDIT');
  assert.equal(t.wallet.audit().ok, true);
  assert.equal(t.resets.recentLog()[0].action, 'RESET_POINTS');
  assert.ok(fs.existsSync(path.join(t.backupDir, r.backup)), 'backup written first');

  await t.resets.resetPoints('secret123', { regrant: false });
  assert.equal(t.players.get(a.player.id).balance, 0);
});

test('reset B: all players gone, nicknames free, settings kept', async () => {
  const t = setup();
  t.players.register('Alpha1');
  t.players.register('Beta22');
  t.points.setStartingBalance(50);
  const r = await t.resets.resetPlayers('secret123');
  assert.equal(r.players, 2);
  assert.equal(t.count('players'), 0);
  assert.equal(t.count('player_sessions'), 0);
  assert.equal(t.count('transactions'), 0);
  assert.equal(t.points.getStartingBalance(), 50);
  assert.equal(t.players.register('alpha1').ok, true, 'nickname reusable after full reset (spec 31.2)');
  assert.equal(t.resets.recentLog()[0].action, 'RESET_PLAYERS');
});

test('resets need the password, an idle game and no pending requests', async () => {
  const t = setup();
  const a = t.players.register('Alpha1');
  assert.equal((await t.resets.resetPlayers('nope')).code, 'BAD_PASSWORD');

  t.points.requestPurchase(a.player.id, 10);
  assert.equal((await t.resets.resetPoints('secret123')).code, 'PENDING');
  t.db.prepare("UPDATE point_requests SET status = 'CANCELLED'").run();

  t.game.setState('BETTING_OPEN');
  assert.equal((await t.resets.resetPlayers('secret123')).code, 'NOT_IDLE');
  assert.equal(t.count('players'), 1, 'nothing deleted');
});

test('only the newest backups are kept', async () => {
  const t = setup();
  for (let i = 0; i < KEEP_BACKUPS + 3; i++) {
    // distinct timestamps in the file names
    fs.writeFileSync(path.join(t.backupDir, `game-2026010${Math.floor(i / 10)}-0000${i % 10}0-before-points.db`), '');
  }
  await t.resets.resetPoints('secret123');
  const files = fs.readdirSync(t.backupDir).filter((f) => f.endsWith('.db'));
  assert.equal(files.length, KEEP_BACKUPS);
});

test('hotspot watcher: brief blips ignored, long outage reported once, recovery reported', async () => {
  let ip = '172.20.10.3';
  const events = [];
  const w = watchNetwork({
    intervalMs: 10, graceMs: 50, address: () => ip,
    onLost: () => events.push('lost'), onBack: () => events.push('back'),
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  ip = null; await wait(25); ip = '172.20.10.3'; await wait(30);
  assert.deepEqual(events, [], 'short blip ignored');
  ip = null; await wait(120);
  assert.deepEqual(events, ['lost'], 'reported once');
  ip = '172.20.10.5'; await wait(30);
  assert.deepEqual(events, ['lost', 'back']);
  w.stop();
});
