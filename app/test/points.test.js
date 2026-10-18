const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createGame } = require('../src/game');
const { createPlayers } = require('../src/players');
const { createPoints } = require('../src/points');

function setup() {
  const db = openDatabase(':memory:');
  const game = createGame(db);
  const points = createPoints(db, game);
  const players = createPlayers(db, game, { onRegistered: points.grantStartingCredit });
  const join = (nick) => players.register(nick).player.id;
  const bal = (id) => players.get(id).balance;
  const avail = (id) => players.get(id).balance - players.get(id).reserved;
  const ledger = (id) => db.prepare('SELECT type, amount, balance_after FROM transactions WHERE player_id = ? ORDER BY id').all(id);
  return { db, game, points, players, join, bal, avail, ledger };
}

test('new players get the default 20 starting points, logged as STARTING_CREDIT', () => {
  const { join, bal, ledger, points } = setup();
  assert.equal(points.getStartingBalance(), 20);
  const id = join('Christian');
  assert.equal(bal(id), 20);
  assert.deepEqual(ledger(id), [{ type: 'STARTING_CREDIT', amount: 20, balance_after: 20 }]);
});

test('changing starting points affects only future players', () => {
  const { join, bal, points } = setup();
  const early = join('Christian');
  assert.equal(points.setStartingBalance(50).ok, true);
  const late = join('Later01');
  assert.equal(bal(early), 20);
  assert.equal(bal(late), 50);
});

test('starting points: 0-100 in steps of 5, between rounds only', () => {
  const { join, bal, ledger, points, game } = setup();
  for (const bad of [-5, 3, 101, 105, 'abc', null, 2.5]) assert.equal(points.setStartingBalance(bad).code, 'BAD_START', String(bad));
  assert.equal(points.setStartingBalance(0).ok, true);
  const id = join('Zero01');
  assert.equal(bal(id), 0);
  assert.deepEqual(ledger(id), [], 'no zero-point ledger rows');
  game.setState('BETTING_OPEN');
  assert.equal(points.setStartingBalance(10).code, 'NOT_BETWEEN_ROUNDS');
});

test('top-up amounts: 5-100 in steps of 5', () => {
  const { join, points } = setup();
  const id = join('Buyer01');
  for (const bad of [0, 3, 7, 105, 1000, -5, 'x', null]) {
    assert.equal(points.requestPurchase(id, bad).code, 'BAD_PURCHASE', String(bad));
  }
  assert.equal(points.requestPurchase(id, 100).ok, true);
});

test('approved top-up adds points once, even if APPROVE is clicked twice', () => {
  const { join, points, bal, ledger } = setup();
  const id = join('Buyer01');
  const { request } = points.requestPurchase(id, 50);
  assert.equal(bal(id), 20, 'nothing added while pending');

  const first = points.decide(request.id, 'approve');
  assert.equal(first.ok, true);
  assert.equal(first.notice, '50 Points Added Successfully');
  const second = points.decide(request.id, 'approve');
  assert.equal(second.code, 'NOT_PENDING');
  assert.equal(second.status, 'APPROVED');

  assert.equal(bal(id), 70, '50 credited, never 100 (spec 24.4)');
  assert.equal(ledger(id).filter((t) => t.type === 'POINT_PURCHASE').length, 1);
});

test('the ledger refuses the same event twice even if code tried', () => {
  const { db, join } = setup();
  const id = join('Twice01');
  assert.throws(() => db.prepare(`INSERT INTO transactions (player_id, type, amount, balance_after, idempotency_key)
                                  VALUES (?, 'STARTING_CREDIT', 20, 40, ?)`).run(id, `start:${id}`));
});

test('one pending request at a time, purchase or redemption', () => {
  const { join, points, db } = setup();
  const id = join('Busy01');
  assert.equal(points.requestPurchase(id, 10).ok, true);
  assert.equal(points.requestPurchase(id, 10).code, 'ALREADY_PENDING');
  assert.equal(points.requestRedemption(id, 5).code, 'ALREADY_PENDING');
  assert.throws(() => db.prepare("INSERT INTO point_requests (player_id, type, amount) VALUES (?, 'PURCHASE', 5)").run(id),
    'database also blocks a second pending request');
});

test('redemption reserves points, approval removes them', () => {
  const { join, points, bal, avail, ledger } = setup();
  const id = join('Cashout1');
  const { request } = points.requestRedemption(id, 15);
  assert.equal(bal(id), 20);
  assert.equal(avail(id), 5, '15 held, 5 still available');

  const r = points.decide(request.id, 'approve');
  assert.equal(r.notice, '15 Points Redeemed Successfully');
  assert.equal(bal(id), 5);
  assert.equal(avail(id), 5);
  assert.deepEqual(ledger(id).at(-1), { type: 'POINT_REDEMPTION', amount: -15, balance_after: 5 });
  assert.equal(points.decide(request.id, 'approve').code, 'NOT_PENDING');
  assert.equal(bal(id), 5, 'second approve removes nothing');
});

test('redemption: multiples of 5, not more than available, all point origins redeemable', () => {
  const { join, points } = setup();
  const id = join('Cashout2');
  for (const bad of [0, 3, -5, 'x']) assert.equal(points.requestRedemption(id, bad).code, 'BAD_REDEMPTION', String(bad));
  assert.equal(points.requestRedemption(id, 25).code, 'NOT_ENOUGH');
  assert.equal(points.requestRedemption(id, 20).ok, true, 'starting points are redeemable (spec 19.4)');
});

test('redemption has no 100-point cap, only the balance', () => {
  const { join, points, bal } = setup();
  const id = join('Rich01');
  for (let i = 0; i < 2; i++) {
    const { request } = points.requestPurchase(id, 100);
    points.decide(request.id, 'approve');
  }
  assert.equal(bal(id), 220, 'no wallet maximum (spec 21.2)');
  const { request } = points.requestRedemption(id, 150);
  assert.equal(points.decide(request.id, 'approve').ok, true);
  assert.equal(bal(id), 70);
});

test('rejecting or cancelling a redemption gives the reserved points back', () => {
  const { join, points, bal, avail } = setup();
  const id = join('Undo01');
  let { request } = points.requestRedemption(id, 10);
  let r = points.decide(request.id, 'reject');
  assert.equal(r.notice, 'Redemption Request Rejected');
  assert.equal(avail(id), 20);

  ({ request } = points.requestRedemption(id, 10));
  r = points.decide(request.id, 'cancel');
  assert.equal(r.notice, 'Point Request Cancelled');
  assert.equal(avail(id), 20);
  assert.equal(bal(id), 20);
  assert.equal(points.decide(request.id, 'approve').code, 'NOT_PENDING', 'cancelled stays cancelled');
});

test('rejected top-up adds nothing', () => {
  const { join, points, bal } = setup();
  const id = join('NoBuy01');
  const { request } = points.requestPurchase(id, 30);
  assert.equal(points.decide(request.id, 'reject').notice, 'Top-Up Request Rejected');
  assert.equal(bal(id), 20);
});

test('requests and decisions only between rounds', () => {
  const { join, points, game, bal } = setup();
  const id = join('Timing01');
  const { request } = points.requestPurchase(id, 10);
  game.setState('BETTING_OPEN');
  assert.equal(points.requestRedemption(id, 5).code, 'NOT_BETWEEN_ROUNDS');
  assert.equal(points.decide(request.id, 'approve').code, 'NOT_BETWEEN_ROUNDS');
  assert.equal(bal(id), 20, 'held until between rounds (spec 23.3)');
  game.setState('IDLE');
  assert.equal(points.decide(request.id, 'approve').ok, true);
});

test('inactive players cannot make requests', () => {
  const { join, points, players } = setup();
  const id = join('Gone01');
  players.deactivate(id);
  assert.equal(points.requestPurchase(id, 10).code, 'NOT_ACTIVE');
  assert.equal(points.requestRedemption(id, 10).code, 'NOT_ACTIVE');
});

test('going inactive cancels the pending request and frees reserved points', () => {
  const { join, points, avail } = setup();
  const id = join('Leaver01');
  points.requestRedemption(id, 20);
  assert.equal(avail(id), 0);
  const c = points.cancelPendingFor(id);
  assert.equal(c.request.status, 'CANCELLED');
  assert.equal(c.request.resolved_by, 'SYSTEM');
  assert.equal(avail(id), 20, 'points never stay locked (spec 18.4)');
  assert.equal(points.cancelPendingFor(id), null, 'nothing left to cancel');
});

test('wallet check passes after a mix of operations and catches tampering', () => {
  const { db, join, points } = setup();
  const a = join('AuditA');
  const b = join('AuditB');
  points.decide(points.requestPurchase(a, 40).request.id, 'approve');
  points.decide(points.requestRedemption(b, 10).request.id, 'approve');
  points.requestRedemption(a, 30); // left pending
  assert.equal(points.audit().ok, true);

  db.prepare('UPDATE players SET balance = balance + 5 WHERE id = ?').run(b);
  const r = points.audit();
  assert.equal(r.ok, false);
  assert.equal(r.ledger[0].nickname, 'AuditB');
});

test('balance can never go below reserved points', () => {
  const { db, join, points } = setup();
  const id = join('Guard01');
  points.requestRedemption(id, 20);
  assert.throws(() => db.prepare('UPDATE players SET balance = 10 WHERE id = ?').run(id));
});
