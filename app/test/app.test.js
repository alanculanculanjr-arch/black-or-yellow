// End-to-end tests over real HTTP against a server on a random port.

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const { createSimHardware, createSimVision } = require('../src/sim');

async function start() {
  const db = openDatabase(':memory:');
  const ctx = createApp({
    db, port: 0, log: () => {}, network: false, backupDir: require('os').tmpdir() + '/by-test-backups',
    hardware: createSimHardware({ dropMs: 5, recoverMs: 5 }),
    vision: createSimVision({ detectMs: 5 }),
  });
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${ctx.server.address().port}`;

  // A tiny client that remembers its cookies, like one phone's browser.
  function client() {
    const jar = {};
    return async (path, body) => {
      const res = await fetch(base + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const [k, v] = pair.split('=');
        if (v) jar[k] = v;
        else delete jar[k];
      }
      return { status: res.status, body: await res.json() };
    };
  }

  return { ...ctx, db, client, stop: () => { ctx.close(); db.close(); } };
}

test('player registers, is remembered, and cannot create a second account', async (t) => {
  const s = await start();
  t.after(s.stop);
  const phone = s.client();

  assert.equal((await phone('/api/me')).status, 401);
  const r = await phone('/api/register', { nickname: 'Christian' });
  assert.equal(r.status, 201);
  assert.equal(r.body.me.nickname, 'Christian');
  assert.equal(r.body.me.status, 'ACTIVE');

  const me = await phone('/api/me');
  assert.equal(me.body.me.nickname, 'Christian');

  const again = await phone('/api/register', { nickname: 'Other01' });
  assert.equal(again.body.me.nickname, 'Christian', 'same browser keeps its account');
  assert.equal(s.players.list().length, 1);

  const other = s.client();
  const dup = await other('/api/register', { nickname: 'CHRISTIAN' });
  assert.equal(dup.body.message, 'Nickname Already Taken');
});

test('player responses never include other players', async (t) => {
  const s = await start();
  t.after(s.stop);
  const a = s.client();
  const b = s.client();
  await a('/api/register', { nickname: 'Alice1' });
  await b('/api/register', { nickname: 'Bobby2' });
  const status = await a('/api/status');
  const me = await a('/api/me');
  const text = JSON.stringify([status.body, me.body]);
  assert.equal(text.includes('Bobby2'), false);
});

test('banker: login required, wrong password refused, session works, logout ends it', async (t) => {
  const s = await start();
  t.after(s.stop);
  s.banker.setAccount('banker', 'correct-horse');
  const bank = s.client();

  assert.equal((await bank('/api/banker/overview')).status, 401);
  const bad = await bank('/api/banker/login', { username: 'banker', password: 'nope' });
  assert.equal(bad.status, 400);

  const ok = await bank('/api/banker/login', { username: 'banker', password: 'correct-horse' });
  assert.equal(ok.body.ok, true);
  const ov = await bank('/api/banker/overview');
  assert.equal(ov.body.maxActive, 10);

  await bank('/api/banker/logout', {});
  assert.equal((await bank('/api/banker/overview')).status, 401);
});

test('a player cookie does not grant banker access', async (t) => {
  const s = await start();
  t.after(s.stop);
  s.banker.setAccount('banker', 'correct-horse');
  const phone = s.client();
  await phone('/api/register', { nickname: 'Sneaky1' });
  assert.equal((await phone('/api/banker/overview')).status, 401);
  assert.equal((await phone('/api/banker/players/1/deactivate', {})).status, 401);
});

test('banker password is stored hashed', async (t) => {
  const s = await start();
  t.after(s.stop);
  s.banker.setAccount('banker', 'correct-horse');
  const row = s.db.prepare('SELECT password_hash FROM banker').get();
  assert.equal(row.password_hash.includes('correct-horse'), false);
  assert.match(row.password_hash, /^scrypt\$/);
});

test('banker sessions are wiped when the server starts (crash recovery)', async (t) => {
  const db = openDatabase(':memory:');
  const first = createApp({ db, port: 0, log: () => {}, network: false });
  first.banker.setAccount('banker', 'correct-horse');
  const token = first.banker.login('banker', 'correct-horse');
  assert.equal(first.banker.isValidSession(token), true);
  first.close();

  const second = createApp({ db, port: 0, log: () => {}, network: false });
  t.after(() => { second.close(); db.close(); });
  assert.equal(second.banker.isValidSession(token), false);
});

test('deactivate, request reactivation, approve: full loop over HTTP', async (t) => {
  const s = await start();
  t.after(s.stop);
  s.banker.setAccount('banker', 'correct-horse');
  const bank = s.client();
  await bank('/api/banker/login', { username: 'banker', password: 'correct-horse' });
  const phone = s.client();
  const { body } = await phone('/api/register', { nickname: 'Comeback' });
  const id = body.me.id;

  assert.equal((await bank(`/api/banker/players/${id}/deactivate`, {})).body.ok, true);
  assert.equal((await phone('/api/me')).body.me.status, 'INACTIVE');

  assert.equal((await phone('/api/reactivation', {})).body.ok, true);
  const ov = await bank('/api/banker/overview');
  assert.equal(ov.body.pendingReactivations.length, 1);

  assert.equal((await bank(`/api/banker/players/${id}/approve-reactivation`, {})).body.ok, true);
  assert.equal((await phone('/api/me')).body.me.status, 'ACTIVE');
});

test('top-up over HTTP: player requests, banker double-clicks approve, credited once', async (t) => {
  const s = await start();
  t.after(s.stop);
  s.banker.setAccount('banker', 'correct-horse');
  const bank = s.client();
  await bank('/api/banker/login', { username: 'banker', password: 'correct-horse' });
  const phone = s.client();
  const reg = await phone('/api/register', { nickname: 'Buyer01' });
  assert.equal(reg.body.me.balance, 20);

  const req = await phone('/api/points/purchase', { amount: 50 });
  assert.equal(req.body.me.request.status, 'PENDING');
  const reqId = req.body.me.request.id;

  const [a, b] = await Promise.all([
    bank(`/api/banker/requests/${reqId}/approve`, {}),
    bank(`/api/banker/requests/${reqId}/approve`, {}),
  ]);
  assert.deepEqual([a.body.ok, b.body.ok].sort(), [false, true]);

  const me = await phone('/api/me');
  assert.equal(me.body.me.balance, 70);
  assert.equal(me.body.me.request.status, 'APPROVED');
  assert.equal((await bank('/api/banker/overview')).body.walletCheck.ok, true);
});

test('a player cannot approve their own request', async (t) => {
  const s = await start();
  t.after(s.stop);
  const phone = s.client();
  await phone('/api/register', { nickname: 'Cheater1' });
  const req = await phone('/api/points/purchase', { amount: 100 });
  const r = await phone(`/api/banker/requests/${req.body.me.request.id}/approve`, {});
  assert.equal(r.status, 401);
  assert.equal((await phone('/api/me')).body.me.balance, 20);
});

test('banker deactivation cancels a pending redemption and frees the points', async (t) => {
  const s = await start();
  t.after(s.stop);
  s.banker.setAccount('banker', 'correct-horse');
  const bank = s.client();
  await bank('/api/banker/login', { username: 'banker', password: 'correct-horse' });
  const phone = s.client();
  const { body } = await phone('/api/register', { nickname: 'Leaver01' });
  await phone('/api/points/redeem', { amount: 20 });
  assert.equal((await phone('/api/me')).body.me.available, 0);

  await bank(`/api/banker/players/${body.me.id}/deactivate`, {});
  const me = (await phone('/api/me')).body.me;
  assert.equal(me.status, 'INACTIVE');
  assert.equal(me.available, 20);
  assert.equal(me.request.status, 'CANCELLED');
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function bankerAndPlayer(s, nickname) {
  s.banker.setAccount('banker', 'correct-horse');
  const bank = s.client();
  await bank('/api/banker/login', { username: 'banker', password: 'correct-horse' });
  const phone = s.client();
  await phone('/api/register', { nickname });
  const game = (action, body = {}) => bank(`/api/banker/game/${action}`, body);
  return { bank, phone, game };
}

test('full simulated round over HTTP', async (t) => {
  const s = await start();
  t.after(s.stop);
  const { phone, game, bank } = await bankerAndPlayer(s, 'Player01');

  assert.equal((await game('start-round')).body.code, 'NOT_ALLOWED', 'system not confirmed yet');
  assert.equal((await game('confirm-system-ready')).body.ok, true);
  assert.equal((await game('start-round')).body.ok, true);

  const status = (await phone('/api/status')).body;
  const bet = await phone('/api/bet', { roundId: status.roundId, color: 'BLACK', amount: 20 });
  assert.equal(bet.body.me.bet.status, 'LOCKED');
  assert.equal(bet.body.me.balance, 0);
  const dup = await phone('/api/bet', { roundId: status.roundId, color: 'BLACK', amount: 20 });
  assert.equal(dup.body.code, 'ALREADY_BET');

  await game('close-betting');
  assert.equal((await game('drop', { sim: '16' })).body.ok, true);
  await wait(60);
  const ov = (await bank('/api/banker/overview')).body.game;
  assert.equal(ov.state, 'AWAITING_RESULT_CONFIRMATION');
  assert.equal(ov.round.detected_cell, 16);
  assert.equal((await phone('/api/status')).body.provisional, 'BLACK');

  assert.equal((await game('confirm-result', { color: 'BLACK' })).body.ok, true);
  assert.equal((await phone('/api/me')).body.me.balance, 40);
  await wait(60);
  assert.equal((await game('confirm-ready')).body.ok, true);
  assert.equal((await phone('/api/status')).body.state, 'IDLE');
  assert.equal((await bank('/api/banker/overview')).body.walletCheck.ok, true);
});

test('players cannot use banker game controls', async (t) => {
  const s = await start();
  t.after(s.stop);
  const { phone } = await bankerAndPlayer(s, 'Sneaky2');
  for (const action of ['confirm-system-ready', 'start-round', 'confirm-result', 'stop']) {
    assert.equal((await phone(`/api/banker/game/${action}`, { color: 'BLACK' })).status, 401, action);
  }
});

test('leave game between rounds: inactive at once, wallet kept, request cancelled', async (t) => {
  const s = await start();
  t.after(s.stop);
  const { phone } = await bankerAndPlayer(s, 'Leaver02');
  await phone('/api/points/redeem', { amount: 10 });
  const r = await phone('/api/leave', {});
  assert.equal(r.body.left, true);
  assert.equal(r.body.me.status, 'INACTIVE');
  assert.equal(r.body.me.balance, 20);
  assert.equal(r.body.me.available, 20, 'reserved points released');
  assert.equal(r.body.me.request.status, 'CANCELLED');
  assert.equal((await phone('/api/leave', {})).body.code, 'NOT_ACTIVE');
});

test('leave game during a round: queued, paid, then inactive', async (t) => {
  const s = await start();
  t.after(s.stop);
  const { phone, game } = await bankerAndPlayer(s, 'Leaver03');
  await game('confirm-system-ready');
  const { body } = await game('start-round');
  await phone('/api/bet', { roundId: body.roundId, color: 'YELLOW', amount: 10 });
  const r = await phone('/api/leave', {});
  assert.equal(r.body.left, false);
  assert.equal(r.body.me.leaveQueued, true);
  assert.equal(r.body.me.status, 'ACTIVE');

  await game('close-betting');
  await game('drop', { sim: '2' });
  await wait(60);
  await game('confirm-result', { color: 'YELLOW' });
  const me = (await phone('/api/me')).body.me;
  assert.equal(me.balance, 30, 'paid before leaving');
  assert.equal(me.status, 'INACTIVE');
  assert.equal(me.leaveQueued, false);
});

test('reset A over HTTP: password needed, balances reset, starting points re-granted', async (t) => {
  const s = await start();
  t.after(s.stop);
  const { phone, bank } = await bankerAndPlayer(s, 'Resetme1');
  const req = await phone('/api/points/purchase', { amount: 50 });
  await bank(`/api/banker/requests/${req.body.me.request.id}/approve`, {});
  assert.equal((await phone('/api/me')).body.me.balance, 70);

  assert.equal((await bank('/api/banker/reset/points', { password: 'wrong' })).body.code, 'BAD_PASSWORD');
  const r = await bank('/api/banker/reset/points', { password: 'correct-horse' });
  assert.equal(r.body.ok, true);
  const me = (await phone('/api/me')).body.me;
  assert.equal(me.balance, 20, 'back to the starting points');
  assert.equal(me.nickname, 'Resetme1', 'account and login kept');
  const ov = (await bank('/api/banker/overview')).body;
  assert.equal(ov.walletCheck.ok, true);
  assert.equal(ov.adminLog[0].action, 'RESET_POINTS');
});

test('reset B over HTTP: accounts deleted, nickname free again', async (t) => {
  const s = await start();
  t.after(s.stop);
  const { phone, bank } = await bankerAndPlayer(s, 'Gone02');
  const r = await bank('/api/banker/reset/players', { password: 'correct-horse' });
  assert.equal(r.body.players, 1);
  assert.equal((await phone('/api/me')).status, 401, 'old phone login no longer works');
  const fresh = s.client();
  assert.equal((await fresh('/api/register', { nickname: 'Gone02' })).status, 201);
});

test('pages and the Socket.IO client script are served', async (t) => {
  const s = await start();
  t.after(s.stop);
  const base = `http://127.0.0.1:${s.server.address().port}`;
  for (const path of ['/', '/banker', '/player.js', '/banker.js', '/style.css', '/socket.io/socket.io.js']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
  }
});
