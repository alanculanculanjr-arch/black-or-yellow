const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createGame } = require('../src/game');
const { createPlayers } = require('../src/players');
const { createPoints } = require('../src/points');
const { createWallet } = require('../src/wallet');
const { createRounds, cellColor } = require('../src/rounds');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// Fake hardware/camera whose steps finish when the test says so.
function controllable() {
  const pending = { drop: [], recover: [], detect: [] };
  const later = (list) => new Promise((resolve, reject) => list.push({ resolve, reject }));
  const hardware = {
    stops: 0,
    dropBall: () => later(pending.drop),
    recoverBall: () => later(pending.recover),
    stopAll() { this.stops++; },
  };
  const vision = { detect: () => later(pending.detect) };
  const finish = async (kind, value) => {
    const p = pending[kind].shift();
    assert.ok(p, `nothing waiting for ${kind}`);
    p.resolve(value);
    await tick();
  };
  return { hardware, vision, finish, pending };
}

function setup({ db = openDatabase(':memory:'), bootId = () => 'boot-1', hw = controllable() } = {}) {
  const game = createGame(db);
  const wallet = createWallet(db);
  const points = createPoints(db, game, wallet);
  const players = createPlayers(db, game, { onRegistered: points.grantStartingCredit });
  const ended = [];
  const rounds = createRounds({
    db, game, wallet, hardware: hw.hardware, vision: hw.vision, bootId,
    onRoundEnded: () => ended.push(game.row().round_id),
  });
  rounds.init();
  const join = (nick) => players.register(nick).player.id;
  const bal = (id) => players.get(id).balance;
  const state = () => game.getState();
  return { db, game, wallet, points, players, rounds, hw, join, bal, state, ended };
}

// Gets a fresh setup to "betting open" with the system confirmed ready.
function open(t) {
  assert.equal(t.rounds.confirmSystemReady().ok, true);
  assert.equal(t.rounds.startRound().ok, true);
  return t.game.row().round_id;
}

async function dropAndDetect(t, detection) {
  assert.equal(t.rounds.closeBetting().ok, true);
  assert.equal(t.rounds.drop().ok, true);
  assert.equal(t.state(), 'DROPPING');
  await t.hw.finish('drop');
  assert.equal(t.state(), 'DETECTING');
  await t.hw.finish('detect', detection);
}

test('checkerboard colors match spec 3.1', () => {
  assert.deepEqual([1, 3, 6, 8, 9, 11, 14, 16].map(cellColor), Array(8).fill('BLACK'));
  assert.deepEqual([2, 4, 5, 7, 10, 12, 13, 15].map(cellColor), Array(8).fill('YELLOW'));
});

test('full round: winner gets 2x stake, loser gets nothing (spec 12 example)', async () => {
  const t = setup();
  const a = t.join('Winner01');
  const b = t.join('Loser01');
  for (const id of [a, b]) {
    t.points.decide(t.points.requestPurchase(id, 80).request.id, 'approve'); // 20 start + 80 = 100
  }
  const roundId = open(t);
  assert.equal(t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 }).ok, true);
  assert.equal(t.rounds.placeBet(b, { roundId, color: 'YELLOW', amount: 20 }).ok, true);
  assert.equal(t.bal(a), 80, 'deducted immediately');

  await dropAndDetect(t, { status: 'OK', cell: 6 });
  assert.equal(t.state(), 'AWAITING_RESULT_CONFIRMATION');
  assert.equal(t.rounds.publicStatus().provisional, 'BLACK');
  assert.equal(t.bal(a), 80, 'provisional result pays nothing (spec 9.2)');

  assert.equal(t.rounds.confirmResult('BLACK').ok, true);
  assert.equal(t.bal(a), 120);
  assert.equal(t.bal(b), 80);
  assert.equal(t.state(), 'BALL_RECOVERY');
  assert.deepEqual(t.ended, [roundId]);

  await t.hw.finish('recover');
  assert.equal(t.state(), 'AWAITING_BALL_READY');
  assert.equal(t.rounds.confirmReady().ok, true);
  assert.equal(t.state(), 'IDLE');
  assert.equal(t.wallet.audit().ok, true);
});

test('confirming the result twice pays once', async () => {
  const t = setup();
  const a = t.join('Double01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'YELLOW', amount: 10 });
  await dropAndDetect(t, { status: 'OK', cell: 2 });
  assert.equal(t.rounds.confirmResult('YELLOW').ok, true);
  assert.equal(t.rounds.confirmResult('YELLOW').code, 'NOT_ALLOWED');
  assert.equal(t.bal(a), 30, '20 - 10 + 20');
});

test('manual color correction pays the corrected color', async () => {
  const t = setup();
  const a = t.join('Fixed01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'YELLOW', amount: 5 });
  await dropAndDetect(t, { status: 'OK', cell: 1 }); // camera says BLACK
  t.rounds.confirmResult('YELLOW'); // banker sees it's really yellow
  assert.equal(t.bal(a), 25);
  const r = t.db.prepare('SELECT final_color, detected_color, corrected FROM rounds WHERE id = ?').get(roundId);
  assert.deepEqual({ ...r }, { final_color: 'YELLOW', detected_color: 'BLACK', corrected: 1 });
});

test('bet rules: amounts, colors, one per round, balance, only while betting is open', () => {
  const t = setup();
  const a = t.join('Rules01');
  const poor = t.join('Poor01');
  t.points.decide(t.points.requestRedemption(poor, 10).request.id, 'approve'); // 10 left
  const roundId = open(t);

  for (const amount of [0, 1, 25, 100, '20', null]) {
    assert.equal(t.rounds.placeBet(a, { roundId, color: 'BLACK', amount }).code, 'BAD_AMOUNT', String(amount));
  }
  assert.equal(t.rounds.placeBet(a, { roundId, color: 'RED', amount: 5 }).code, 'BAD_COLOR', 'never Red (spec 37)');
  assert.equal(t.rounds.placeBet(poor, { roundId, color: 'BLACK', amount: 15 }).code, 'INSUFFICIENT');
  assert.equal(t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 5 }).ok, true);
  assert.equal(t.rounds.placeBet(a, { roundId, color: 'YELLOW', amount: 5 }).code, 'ALREADY_BET', 'locked (spec 11.4)');
  assert.equal(t.bal(a), 15, 'duplicate submission did not deduct twice');
  assert.equal(t.rounds.placeBet(poor, { roundId: roundId + 1, color: 'BLACK', amount: 5 }).code, 'ROUND_CHANGED');

  t.rounds.closeBetting();
  assert.equal(t.rounds.placeBet(poor, { roundId, color: 'BLACK', amount: 5 }).code, 'BETTING_CLOSED');
});

test('reserved redemption points cannot be bet', () => {
  const t = setup();
  const a = t.join('Held01');
  t.points.requestRedemption(a, 15); // 5 available
  const roundId = open(t);
  assert.equal(t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 10 }).code, 'INSUFFICIENT');
  assert.equal(t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 5 }).ok, true);
});

test('cannot drop with zero bets; cannot start a round twice', () => {
  const t = setup();
  open(t);
  assert.equal(t.rounds.startRound().code, 'NOT_ALLOWED');
  assert.equal(t.rounds.drop().code, 'NOT_ALLOWED', 'betting still open');
  t.rounds.closeBetting();
  assert.equal(t.rounds.drop().code, 'NO_BETS');
});

test('nothing happens before CONFIRM SYSTEM READY', () => {
  const t = setup();
  assert.equal(t.rounds.startRound().code, 'NOT_ALLOWED');
  assert.deepEqual(t.rounds.allowedActions().sort(), ['confirm-system-ready', 'stop']);
});

test('cancel round refunds every bet exactly once (spec 10.4)', () => {
  const t = setup();
  const a = t.join('Refund01');
  const b = t.join('Refund02');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });
  t.rounds.placeBet(b, { roundId, color: 'YELLOW', amount: 5 });
  assert.equal(t.rounds.cancelRound().ok, true);
  assert.equal(t.rounds.cancelRound().code, 'NOT_ALLOWED');
  assert.equal(t.bal(a), 20);
  assert.equal(t.bal(b), 20);
  assert.equal(t.state(), 'IDLE', 'ball never dropped, nothing to recover');
  assert.equal(t.rounds.publicStatus().lastResult.status, 'CANCELLED');
  assert.equal(t.wallet.audit().ok, true);
});

test('timeout: banker can retry scan, then confirm', async () => {
  const t = setup();
  const a = t.join('Retry01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 5 });
  await dropAndDetect(t, { status: 'TIMEOUT' });
  assert.equal(t.state(), 'DETECTION_FAILED');
  assert.ok(t.rounds.allowedActions().includes('retry-scan'));
  assert.equal(t.rounds.retryScan().ok, true);
  await t.hw.finish('detect', { status: 'OK', cell: 3 });
  assert.equal(t.state(), 'AWAITING_RESULT_CONFIRMATION');
});

test('invalid landing: retry scan not offered; retry drop keeps the same bets', async () => {
  const t = setup();
  const a = t.join('Again01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 10 });
  await dropAndDetect(t, { status: 'INVALID' });
  assert.equal(t.rounds.allowedActions().includes('retry-scan'), false);

  assert.equal(t.rounds.retryDrop().ok, true);
  await t.hw.finish('recover');
  t.rounds.confirmReady();
  assert.equal(t.state(), 'BETTING_CLOSED', 'same round, ready to drop again (spec 10.3)');
  assert.equal(t.game.row().round_id, roundId);
  assert.equal(t.rounds.drop().ok, true);
  await t.hw.finish('drop');
  await t.hw.finish('detect', { status: 'OK', cell: 8 });
  t.rounds.confirmResult('BLACK');
  assert.equal(t.bal(a), 30, 'debited once, paid once across two drops');
  assert.equal(t.db.prepare('SELECT drop_attempts FROM rounds WHERE id = ?').get(roundId).drop_attempts, 2);
});

test('camera lost during detection cancels, refunds and requires system check (spec 29.1)', async () => {
  const t = setup();
  const a = t.join('Cam01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });
  await dropAndDetect(t, { status: 'CAMERA_LOST' });
  assert.equal(t.bal(a), 20);
  assert.equal(t.state(), 'IDLE');
  assert.equal(t.game.row().system_ready, 0);
});

test('STOP cancels an unfinished round and halts', async () => {
  const t = setup();
  const a = t.join('Stop01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 15 });
  t.rounds.closeBetting();
  t.rounds.drop();
  t.rounds.stop();
  assert.equal(t.bal(a), 20, 'refunded');
  assert.equal(t.hw.hardware.stops, 1, 'actuators stopped');
  assert.equal(t.game.row().system_ready, 0);
  await t.hw.finish('drop'); // the servo finishing late must not restart anything
  assert.equal(t.state(), 'IDLE');
});

test('STOP after settlement does not undo payouts (spec 28.1)', async () => {
  const t = setup();
  const a = t.join('Kept01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });
  await dropAndDetect(t, { status: 'OK', cell: 9 });
  t.rounds.confirmResult('BLACK');
  assert.equal(t.bal(a), 40);
  t.rounds.stop(); // during ball recovery
  assert.equal(t.bal(a), 40);
  assert.equal(t.wallet.audit().ok, true);
});

test('server crash mid-round (same boot): round cancelled and refunded on restart', () => {
  const db = openDatabase(':memory:');
  const t1 = setup({ db, bootId: () => 'boot-A' });
  const a = t1.join('Crash01');
  const roundId = open(t1);
  t1.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });
  t1.rounds.closeBetting();
  assert.equal(t1.bal(a), 0);

  const t2 = setup({ db, bootId: () => 'boot-A' }); // process restarts, same boot
  assert.equal(t2.bal(a), 20);
  assert.equal(t2.state(), 'IDLE');
  assert.equal(t2.game.row().reason, 'SERVER_RESTART');
  assert.equal(t2.game.row().system_ready, 0);
  assert.equal(t2.wallet.audit().ok, true);
});

test('server crash after settlement keeps the payout', async () => {
  const db = openDatabase(':memory:');
  const t1 = setup({ db, bootId: () => 'boot-A' });
  const a = t1.join('Settled1');
  const roundId = open(t1);
  t1.rounds.placeBet(a, { roundId, color: 'YELLOW', amount: 10 });
  await dropAndDetect(t1, { status: 'OK', cell: 4 });
  t1.rounds.confirmResult('YELLOW'); // crash during recovery
  const t2 = setup({ db, bootId: () => 'boot-A' });
  assert.equal(t2.bal(a), 30, 'settled round is not mistaken for unfinished (spec 29.3)');
});

test('power cut mid-round (new boot): banker reviews and can resume', () => {
  const db = openDatabase(':memory:');
  const t1 = setup({ db, bootId: () => 'boot-A' });
  const a = t1.join('Power01');
  const roundId = open(t1);
  t1.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });

  const t2 = setup({ db, bootId: () => 'boot-B' });
  assert.equal(t2.state(), 'RECOVERY_REVIEW');
  assert.equal(t2.bal(a), 0, 'bet still locked, nothing refunded yet');
  assert.deepEqual(t2.rounds.allowedActions().sort(), ['cancel-round', 'resume', 'stop']);

  assert.equal(t2.rounds.resume().ok, true);
  assert.equal(t2.state(), 'BETTING_OPEN');
  assert.equal(t2.rounds.closeBetting().code, 'NOT_ALLOWED', 'still needs CONFIRM SYSTEM READY');
  t2.rounds.confirmSystemReady();
  assert.equal(t2.rounds.closeBetting().ok, true);
});

test('power cut during detection resumes as a failed detection; cancel refunds', async () => {
  const db = openDatabase(':memory:');
  const t1 = setup({ db, bootId: () => 'boot-A' });
  const a = t1.join('Power02');
  const roundId = open(t1);
  t1.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });
  t1.rounds.closeBetting();
  t1.rounds.drop();
  await t1.hw.finish('drop'); // power dies while DETECTING

  const t2 = setup({ db, bootId: () => 'boot-B' });
  assert.equal(t2.game.row().interrupted_state, 'DETECTING');
  t2.rounds.resume();
  assert.equal(t2.state(), 'DETECTION_FAILED');
  assert.equal(t2.game.row().reason, 'INTERRUPTED');
  assert.equal(t2.rounds.cancelRound().ok, true);
  assert.equal(t2.bal(a), 20);
});

test('players see their own bet only, and the latest result', async () => {
  const t = setup();
  const a = t.join('Mine01');
  const b = t.join('Theirs01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });
  assert.equal(t.rounds.playerBet(b), null);
  assert.equal(JSON.stringify(t.rounds.publicStatus()).includes('20'), false, 'no bet amounts in public status');
  await dropAndDetect(t, { status: 'OK', cell: 11 });
  t.rounds.confirmResult('BLACK');
  assert.deepEqual(t.rounds.playerBet(a), { roundId, color: 'BLACK', amount: 20, status: 'WON', payout: 40 });
  assert.deepEqual(t.rounds.publicStatus().lastResult, { roundId, status: 'SETTLED', color: 'BLACK' });
});

test('inactive and leaving players are still paid; leaving players cannot bet again', async () => {
  const t = setup();
  const a = t.join('Gone01');
  const b = t.join('Leave01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'YELLOW', amount: 10 });
  t.players.deactivate(a); // e.g. 2-minute disconnect during the round
  t.players.queueLeave(b);
  assert.equal(t.rounds.placeBet(b, { roundId, color: 'BLACK', amount: 5 }).code, 'LEAVING');
  await dropAndDetect(t, { status: 'OK', cell: 7 });
  t.rounds.confirmResult('YELLOW');
  assert.equal(t.bal(a), 30, 'offline winner credited (spec 15.4)');
});

test('automatic halt (hotspot lost) cancels and refunds like STOP', () => {
  const t = setup();
  const a = t.join('Wifi01');
  const roundId = open(t);
  t.rounds.placeBet(a, { roundId, color: 'BLACK', amount: 20 });
  t.rounds.halt('HOTSPOT_LOST');
  assert.equal(t.bal(a), 20);
  assert.equal(t.game.row().reason, 'HOTSPOT_LOST');
  assert.equal(t.game.row().system_ready, 0);
});
