const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createGame } = require('../src/game');
const { createPlayers } = require('../src/players');

function setup() {
  const db = openDatabase(':memory:');
  const game = createGame(db);
  return { db, game, players: createPlayers(db, game) };
}

test('nickname rules: 3-12 letters or numbers only', () => {
  const { players } = setup();
  for (const good of ['Christian', 'Player123', 'Mark05', 'abc', 'A23456789012']) {
    assert.equal(players.register(good).ok, true, good);
  }
  for (const bad of ['Jo', 'John Doe', 'Player@1', 'A234567890123', '', null, 'ñandu', '<b>x</b>']) {
    assert.equal(players.register(bad).code, 'INVALID_NICKNAME', String(bad));
  }
});

test('nicknames are unique ignoring case', () => {
  const { players } = setup();
  assert.equal(players.register('Mark05').ok, true);
  const r = players.register('MARK05');
  assert.equal(r.code, 'NICKNAME_TAKEN');
  assert.equal(r.message, 'Nickname Already Taken');
});

test('nickname stays reserved after the player goes inactive', () => {
  const { players } = setup();
  const r = players.register('Christian');
  players.deactivate(r.player.id);
  assert.equal(players.register('christian').code, 'NICKNAME_TAKEN');
});

test('database itself rejects bad nicknames even if code is bypassed', () => {
  const { db } = setup();
  assert.throws(() => db.prepare("INSERT INTO players (nickname, status) VALUES ('a b c', 'ACTIVE')").run());
  assert.throws(() => db.prepare("INSERT INTO players (nickname, status) VALUES ('ab', 'ACTIVE')").run());
});

test('registration is closed during a round', () => {
  const { players, game } = setup();
  game.setState('BETTING_OPEN');
  const r = players.register('Late01');
  assert.equal(r.code, 'REGISTRATION_CLOSED');
  assert.equal(r.message, 'Registration Temporarily Closed');
  game.setState('IDLE');
  assert.equal(players.register('Late01').ok, true);
});

test('at most 10 active players: the 11th gets Game Full', () => {
  const { players } = setup();
  for (let i = 1; i <= 10; i++) assert.equal(players.register(`Player${i}`).ok, true);
  const r = players.register('Player11');
  assert.equal(r.code, 'GAME_FULL');
  assert.equal(players.activeCount(), 10);
});

test('sessions: token finds the same player; unknown token finds nobody', () => {
  const { players } = setup();
  const r = players.register('Mark05');
  assert.equal(players.findBySession(r.token).id, r.player.id);
  assert.equal(players.findBySession('made-up-token'), null);
  assert.equal(players.findBySession(undefined), null);
});

test('session tokens are stored hashed, never in plain text', () => {
  const { players, db } = setup();
  const r = players.register('Mark05');
  const rows = db.prepare('SELECT token_hash FROM player_sessions').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, r.token);
});

test('reactivation: request, approve between rounds only', () => {
  const { players, game } = setup();
  const { player } = players.register('Back01');
  assert.equal(players.requestReactivation(player.id).code, 'NOT_INACTIVE');
  players.deactivate(player.id);

  assert.equal(players.approveReactivation(player.id).code, 'NO_REQUEST');
  assert.equal(players.requestReactivation(player.id).ok, true);

  game.setState('BETTING_OPEN'); // requests allowed during a round, approval is not
  assert.equal(players.requestReactivation(player.id).ok, true);
  assert.equal(players.approveReactivation(player.id).code, 'NOT_BETWEEN_ROUNDS');

  game.setState('IDLE');
  assert.equal(players.approveReactivation(player.id).ok, true);
  assert.equal(players.get(player.id).status, 'ACTIVE');
  assert.equal(players.get(player.id).reactivation_requested_at, null);
});

test('reactivation is rejected immediately when 10 are active', () => {
  const { players } = setup();
  const { player } = players.register('Waiting1');
  players.deactivate(player.id);
  for (let i = 1; i <= 10; i++) players.register(`Player${i}`);
  assert.equal(players.requestReactivation(player.id).code, 'GAME_FULL');
});

test('filling the 10th slot auto-rejects the other pending requests', () => {
  const { players } = setup();
  const a = players.register('WaitA').player;
  const b = players.register('WaitB').player;
  const c = players.register('WaitC').player;
  for (const p of [a, b, c]) players.deactivate(p.id);
  for (let i = 1; i <= 9; i++) players.register(`Player${i}`);
  for (const p of [a, b, c]) assert.equal(players.requestReactivation(p.id).ok, true);

  const r = players.approveReactivation(a.id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.autoRejected.sort(), [b.id, c.id].sort());
  assert.equal(players.activeCount(), 10);
  assert.equal(players.get(b.id).reactivation_requested_at, null);
  assert.equal(players.approveReactivation(b.id).code, 'NO_REQUEST');
});

test('deactivating keeps the wallet', () => {
  const { players, db } = setup();
  const { player } = players.register('Saver1');
  db.prepare('UPDATE players SET balance = 55 WHERE id = ?').run(player.id);
  players.deactivate(player.id);
  assert.equal(players.get(player.id).balance, 55);
  assert.equal(players.deactivate(player.id).code, 'NOT_ACTIVE');
});

test('reopening an existing database keeps its data (no recreation)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'by-test-'));
  const file = path.join(dir, 'game.db');
  try {
    let db = openDatabase(file);
    createPlayers(db, createGame(db)).register('Keeper1');
    db.close();
    db = openDatabase(file);
    assert.equal(db.pragma('user_version', { simple: true }), require('../src/db').MIGRATIONS.length);
    assert.equal(db.prepare('SELECT nickname FROM players').get().nickname, 'Keeper1');
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('synchronous', { simple: true }), 2); // 2 = FULL
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
