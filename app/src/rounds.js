// Round engine: the game's state machine (spec 13, 35), bets, settlement, refunds,
// STOP, and recovery after a crash or power cut.
//
//   IDLE ─start─▶ BETTING_OPEN ─close─▶ BETTING_CLOSED ─drop─▶ DROPPING ─▶ DETECTING
//     ▲                                       ▲                                │
//     │                                       │ (retry drop: recover, then     ▼
//     │                                       │  CONFIRM READY, drop again)  AWAITING_RESULT_CONFIRMATION
//     │                                       │                   or DETECTION_FAILED (timeout/invalid)
//     │                                       │                                │ confirm result = settle
//     └──── CONFIRM READY ◀── AWAITING_BALL_READY ◀── BALL_RECOVERY ◀──────────┘
//
// Every banker action is one SQLite transaction that first checks the current state, so
// a double click, a stale page or two phones pressing at once can't apply it twice.
// Slow steps (servo, camera) run after the transaction commits; when they finish they
// only take effect if the game is still in the step that started them (the "op" token).
//
// Money moves only through wallet.apply with a unique key per bet ('bet:', 'payout:',
// 'refund:'), so each bet is debited, paid or refunded at most once.

const fs = require('fs');

const COLORS = ['BLACK', 'YELLOW'];
const BET_AMOUNTS = [5, 10, 15, 20];
const PAYOUT_MULTIPLIER = 2; // stake included (spec 12)
// Row-major numbering, cell 1 top-left (spec 3.1). Orientation is checked at calibration.
const BLACK_CELLS = new Set([1, 3, 6, 8, 9, 11, 14, 16]);
const cellColor = (cell) => (BLACK_CELLS.has(cell) ? 'BLACK' : 'YELLOW');

const ACTION_NAMES = {
  'confirm-system-ready': 'CONFIRM SYSTEM READY',
  'start-round': 'START ROUND',
  'close-betting': 'CLOSE BETTING',
  drop: 'DROP',
  'retry-scan': 'RETRY SCAN',
  'confirm-result': 'CONFIRM RESULT',
  'retry-drop': 'RETRY DROP',
  'cancel-round': 'CANCEL ROUND',
  'confirm-ready': 'CONFIRM READY',
  resume: 'RESUME ROUND',
  stop: 'STOP',
};

function readBootId() {
  try {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

function fail(code, message) {
  return { ok: false, code, message };
}

function createRounds({
  db, game, wallet, hardware, vision,
  onChange = () => {}, onRoundEnded = () => {}, log = () => {}, bootId = readBootId,
}) {
  const q = {
    round: db.prepare('SELECT * FROM rounds WHERE id = ?'),
    lastRound: db.prepare('SELECT * FROM rounds ORDER BY id DESC LIMIT 1'),
    insertRound: db.prepare('INSERT INTO rounds DEFAULT VALUES'),
    closeBetting: db.prepare("UPDATE rounds SET betting_closed_at = datetime('now') WHERE id = ?"),
    addAttempt: db.prepare(`UPDATE rounds SET drop_attempts = drop_attempts + 1, detection_status = NULL,
                            detected_cell = NULL, detected_color = NULL WHERE id = ?`),
    detected: db.prepare('UPDATE rounds SET detection_status = ?, detected_cell = ?, detected_color = ? WHERE id = ?'),
    settle: db.prepare(`UPDATE rounds SET status = 'SETTLED', final_color = ?, corrected = ?, ended_at = datetime('now')
                        WHERE id = ? AND status = 'OPEN'`),
    cancel: db.prepare(`UPDATE rounds SET status = 'CANCELLED', cancel_reason = ?, ended_at = datetime('now')
                        WHERE id = ? AND status = 'OPEN'`),
    player: db.prepare('SELECT * FROM players WHERE id = ?'),
    betFor: db.prepare('SELECT * FROM bets WHERE round_id = ? AND player_id = ?'),
    insertBet: db.prepare('INSERT INTO bets (round_id, player_id, color, amount) VALUES (?, ?, ?, ?)'),
    lockedBets: db.prepare("SELECT * FROM bets WHERE round_id = ? AND status = 'LOCKED'"),
    setBet: db.prepare('UPDATE bets SET status = ? WHERE id = ?'),
    betCount: db.prepare('SELECT COUNT(*) AS n FROM bets WHERE round_id = ?'),
    roundBets: db.prepare(`
      SELECT b.id, p.nickname, b.color, b.amount, b.status
      FROM bets b JOIN players p ON p.id = b.player_id WHERE b.round_id = ? ORDER BY b.id`),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('UPDATE settings SET value = ? WHERE key = ?'),
  };

  let op = 0; // bumped whenever a slow step starts or is abandoned

  function current() {
    const g = game.row();
    return { g, round: g.round_id ? q.round.get(g.round_id) : null };
  }

  // Which banker buttons make sense right now (spec 27.2: only show what applies).
  function allowedActions() {
    const { g, round } = current();
    const s = g.state;
    const a = ['stop'];
    const open = round && round.status === 'OPEN';
    if (s === 'RECOVERY_REVIEW') return [...a, 'resume', 'cancel-round'];
    if (!g.system_ready) {
      if (!['DROPPING', 'DETECTING', 'BALL_RECOVERY'].includes(s)) a.push('confirm-system-ready');
      if (open && !['DROPPING', 'DETECTING'].includes(s)) a.push('cancel-round');
      return a;
    }
    switch (s) {
      case 'IDLE': a.push('start-round'); break;
      case 'BETTING_OPEN': a.push('close-betting', 'cancel-round'); break;
      case 'BETTING_CLOSED': a.push('drop', 'cancel-round'); break;
      case 'DETECTION_FAILED':
        if (g.reason !== 'INVALID') a.push('retry-scan');
        a.push('retry-drop', 'cancel-round');
        break;
      case 'AWAITING_RESULT_CONFIRMATION': a.push('confirm-result', 'retry-scan', 'cancel-round'); break;
      case 'AWAITING_BALL_READY': a.push('confirm-ready'); break;
      default: break;
    }
    return a;
  }

  function check(action) {
    if (allowedActions().includes(action)) return null;
    return fail('NOT_ALLOWED', `${ACTION_NAMES[action] || action} isn't available right now (game is ${game.getState()}).`);
  }

  // Refund every locked bet once and mark the round cancelled. Safe to call twice.
  function cancelInner(roundId, reason) {
    if (q.cancel.run(reason, roundId).changes !== 1) return false;
    for (const bet of q.lockedBets.all(roundId)) {
      wallet.apply({ playerId: bet.player_id, type: 'ROUND_REFUND', amount: bet.amount, key: `refund:${bet.id}`, roundId });
      q.setBet.run('REFUNDED', bet.id);
    }
    log(`round ${roundId} cancelled (${reason}), bets refunded`);
    return true;
  }

  function settleInner(roundId, color, detectedColor) {
    if (q.settle.run(color, color !== detectedColor ? 1 : 0, roundId).changes !== 1) return false;
    for (const bet of q.lockedBets.all(roundId)) {
      if (bet.color === color) {
        wallet.apply({
          playerId: bet.player_id, type: 'WIN_PAYOUT', amount: bet.amount * PAYOUT_MULTIPLIER, key: `payout:${bet.id}`, roundId,
        });
        q.setBet.run('WON', bet.id);
      } else {
        q.setBet.run('LOST', bet.id);
      }
    }
    log(`round ${roundId} settled: ${color}` + (color !== detectedColor ? ` (banker corrected from ${detectedColor})` : ''));
    return true;
  }

  // ---- slow steps (run after the transaction has committed) ----------------------------

  // Moves from `from` to the next state only if nothing else happened meanwhile.
  function stillAt(token, state) {
    return token === op && game.getState() === state;
  }

  async function runDrop(token, sim) {
    try {
      await hardware.dropBall();
    } catch (e) {
      return hardwareFault(token, 'DROPPING', e);
    }
    if (!stillAt(token, 'DROPPING')) return;
    game.update({ state: 'DETECTING' });
    onChange();
    runDetect(token, sim);
  }

  async function runDetect(token, sim) {
    let r;
    try {
      r = await vision.detect({ sim });
    } catch (e) {
      log('vision error:', e.message);
      r = { status: 'CAMERA_LOST' };
    }
    if (token !== op) return; // abandoned (STOP, retry, or server shutting down)
    let ended = false;
    db.transaction(() => {
      if (!stillAt(token, 'DETECTING')) return;
      const { round } = current();
      if (r.status === 'OK') {
        const color = cellColor(r.cell);
        q.detected.run('OK', r.cell, color, round.id);
        game.update({ state: 'AWAITING_RESULT_CONFIRMATION', reason: null });
        log(`round ${round.id}: ball detected in cell ${r.cell} (${color}), awaiting banker`);
      } else if (r.status === 'CAMERA_LOST') {
        // Spec 29.1: cancel and refund, and no further drops until the system is checked.
        q.detected.run('CAMERA_LOST', null, null, round.id);
        ended = cancelInner(round.id, 'CAMERA_LOST');
        game.update({ state: 'IDLE', round_id: null, system_ready: 0, reason: 'CAMERA_LOST' });
      } else {
        q.detected.run(r.status, null, null, round.id);
        game.update({ state: 'DETECTION_FAILED', reason: r.status });
        log(`round ${round.id}: detection ${r.status}`);
      }
    }).immediate();
    if (ended) onRoundEnded();
    onChange();
  }

  function startRecovery() {
    const token = ++op;
    hardware.recoverBall().then(
      () => {
        if (!stillAt(token, 'BALL_RECOVERY')) return;
        game.update({ state: 'AWAITING_BALL_READY', reason: null });
        onChange();
      },
      (e) => {
        // Banker checks the ball by eye and fixes it by hand (spec 5.3).
        log('recovery error:', e.message);
        hardware.stopAll();
        if (!stillAt(token, 'BALL_RECOVERY')) return;
        game.update({ state: 'AWAITING_BALL_READY', reason: 'RECOVERY_FAILED' });
        onChange();
      },
    );
  }

  function hardwareFault(token, state, e) {
    log('hardware error:', e.message);
    if (!stillAt(token, state)) return;
    stop('HARDWARE_FAULT');
  }

  // ---- banker actions ------------------------------------------------------------------

  const confirmSystemReady = db.transaction(() => {
    const err = check('confirm-system-ready');
    if (err) return err;
    game.update({ system_ready: 1, reason: null });
    log('banker confirmed system ready');
    return { ok: true };
  }).immediate;

  const startRound = db.transaction(() => {
    const err = check('start-round');
    if (err) return err;
    const id = q.insertRound.run().lastInsertRowid;
    game.update({ state: 'BETTING_OPEN', round_id: id, reason: null });
    log(`round ${id} started, betting open`);
    return { ok: true, roundId: id };
  }).immediate;

  const closeBetting = db.transaction(() => {
    const err = check('close-betting');
    if (err) return err;
    const { round } = current();
    q.closeBetting.run(round.id);
    game.update({ state: 'BETTING_CLOSED' });
    log(`round ${round.id} betting closed (${q.betCount.get(round.id).n} bets)`);
    return { ok: true };
  }).immediate;

  const beginDrop = db.transaction(() => {
    const err = check('drop');
    if (err) return err;
    const { round } = current();
    if (q.betCount.get(round.id).n < 1) return fail('NO_BETS', 'At least one confirmed bet is needed before DROP.');
    q.addAttempt.run(round.id);
    game.update({ state: 'DROPPING', reason: null });
    log(`round ${round.id}: drop attempt ${round.drop_attempts + 1}`);
    return { ok: true, token: ++op };
  }).immediate;

  function drop({ sim } = {}) {
    const r = beginDrop();
    if (r.ok) runDrop(r.token, sim);
    return r.ok ? { ok: true } : r;
  }

  const beginRetryScan = db.transaction(() => {
    const err = check('retry-scan');
    if (err) return err;
    game.update({ state: 'DETECTING', reason: null });
    return { ok: true, token: ++op };
  }).immediate;

  function retryScan({ sim } = {}) {
    const r = beginRetryScan();
    if (r.ok) runDetect(r.token, sim);
    return r.ok ? { ok: true } : r;
  }

  const confirmResultTx = db.transaction((color) => {
    const err = check('confirm-result');
    if (err) return err;
    if (!COLORS.includes(color)) return fail('BAD_COLOR', 'Choose BLACK or YELLOW.');
    const { round } = current();
    if (!settleInner(round.id, color, round.detected_color)) return fail('NOT_ALLOWED', 'This round is already finished.');
    game.update({ state: 'BALL_RECOVERY', reason: null });
    return { ok: true, color };
  }).immediate;

  // color may differ from the detected one: that is MANUAL COLOR CORRECTION (spec 9.1).
  function confirmResult(color) {
    const r = confirmResultTx(color);
    if (r.ok) {
      onRoundEnded();
      startRecovery();
    }
    return r;
  }

  const retryDropTx = db.transaction(() => {
    const err = check('retry-drop');
    if (err) return err;
    game.update({ state: 'BALL_RECOVERY', reason: null });
    return { ok: true };
  }).immediate;

  // Same round, same bets: recover the ball, banker confirms ready, then DROP again (spec 10.3).
  function retryDrop() {
    const r = retryDropTx();
    if (r.ok) startRecovery();
    return r;
  }

  const cancelRoundTx = db.transaction(() => {
    const err = check('cancel-round');
    if (err) return err;
    const { g, round } = current();
    cancelInner(round.id, 'BANKER');
    // If the ball was dropped and the hardware is trusted, bring it back automatically.
    const recover = round.drop_attempts > 0 && g.system_ready && g.state !== 'RECOVERY_REVIEW';
    game.update({
      state: recover ? 'BALL_RECOVERY' : 'IDLE',
      round_id: recover ? round.id : null,
      reason: null,
      interrupted_state: null,
    });
    return { ok: true, recover };
  }).immediate;

  function cancelRound() {
    const r = cancelRoundTx();
    if (r.ok) {
      onRoundEnded();
      if (r.recover) startRecovery();
    }
    return r.ok ? { ok: true } : r;
  }

  const confirmReady = db.transaction(() => {
    const err = check('confirm-ready');
    if (err) return err;
    const { round } = current();
    if (round && round.status === 'OPEN') {
      game.update({ state: 'BETTING_CLOSED', reason: null }); // retry drop: ready to drop again
    } else {
      game.update({ state: 'IDLE', round_id: null, reason: null });
    }
    log('banker confirmed ball ready');
    return { ok: true };
  }).immediate;

  // After a power cut the banker looked at the board and chose to carry on (spec 29.4).
  // A drop or scan that was cut off can't be trusted, so it becomes a failed detection
  // and the banker picks RETRY SCAN, RETRY DROP or CANCEL.
  const RESUME_TO = {
    BETTING_OPEN: 'BETTING_OPEN',
    BETTING_CLOSED: 'BETTING_CLOSED',
    DROPPING: 'DETECTION_FAILED',
    DETECTING: 'DETECTION_FAILED',
    DETECTION_FAILED: 'DETECTION_FAILED',
    AWAITING_RESULT_CONFIRMATION: 'AWAITING_RESULT_CONFIRMATION',
    BALL_RECOVERY: 'AWAITING_BALL_READY',
    AWAITING_BALL_READY: 'AWAITING_BALL_READY',
  };

  const resume = db.transaction(() => {
    const err = check('resume');
    if (err) return err;
    const { g } = current();
    const to = RESUME_TO[g.interrupted_state] || 'DETECTION_FAILED';
    const reason = to === 'DETECTION_FAILED' && g.interrupted_state !== 'DETECTION_FAILED' ? 'INTERRUPTED' : g.reason;
    game.update({ state: to, interrupted_state: null, reason: reason === 'POWER_LOSS' ? null : reason });
    log(`banker resumed interrupted round in ${to}`);
    return { ok: true, state: to };
  }).immediate;

  // STOP (spec 28): actuators off now, unfinished round cancelled and refunded once,
  // a settled round is left alone, and nothing runs until CONFIRM SYSTEM READY.
  function stop(reason = 'STOPPED') {
    op++;
    hardware.stopAll();
    let ended = false;
    db.transaction(() => {
      const { round } = current();
      if (round && round.status === 'OPEN') ended = cancelInner(round.id, reason);
      game.update({ state: 'IDLE', round_id: null, system_ready: 0, reason, interrupted_state: null });
    }).immediate();
    log(`STOP (${reason})`);
    if (ended) onRoundEnded();
    onChange();
    return { ok: true };
  }

  // ---- players -------------------------------------------------------------------------

  const placeBet = db.transaction((playerId, { roundId, color, amount } = {}) => {
    const { g, round } = current();
    if (g.state !== 'BETTING_OPEN') return fail('BETTING_CLOSED', 'Betting is closed.');
    if (roundId !== undefined && Number(roundId) !== round.id) {
      return fail('ROUND_CHANGED', 'That round has ended. Check the current round and try again.');
    }
    const p = q.player.get(playerId);
    if (!p || p.status !== 'ACTIVE') return fail('NOT_ACTIVE', 'Only active players can bet.');
    if (p.leave_requested_at) return fail('LEAVING', 'You are leaving the game and cannot place more bets.');
    if (!COLORS.includes(color)) return fail('BAD_COLOR', 'Choose BLACK or YELLOW.');
    if (!BET_AMOUNTS.includes(amount)) return fail('BAD_AMOUNT', 'Bets are 5, 10, 15 or 20 points.');
    const existing = q.betFor.get(round.id, playerId);
    if (existing) return fail('ALREADY_BET', 'You already have a bet in this round.');
    if (amount > p.balance - p.reserved) return fail('INSUFFICIENT', 'Not enough points for that bet.');

    const betId = q.insertBet.run(round.id, playerId, color, amount).lastInsertRowid;
    wallet.apply({ playerId, type: 'BET_DEBIT', amount: -amount, key: `bet:${betId}`, roundId: round.id });
    log(`player ${playerId} bet ${amount} on ${color} in round ${round.id}`);
    return { ok: true, bet: { roundId: round.id, color, amount, status: 'LOCKED' } };
  }).immediate;

  // ---- startup -------------------------------------------------------------------------

  // Called once when the server starts (spec 29.3-29.5, 38.10).
  //   Same Linux boot ID as last time: only the server process restarted (a crash or a
  //   manual restart), so an unfinished round is cancelled and refunded.
  //   New boot ID: the whole Pi restarted (power cut or reboot), so an unfinished round
  //   waits for the banker to RESUME or CANCEL it.
  // Either way the banker must CONFIRM SYSTEM READY before play continues.
  function init() {
    op++;
    const now = bootId();
    const prev = q.getSetting.get('boot_id').value;
    q.setSetting.run(now, 'boot_id');
    const rebooted = prev !== '' && prev !== now;
    let ended = false;
    let outcome = 'clean';
    db.transaction(() => {
      const { g, round } = current();
      if (round && round.status === 'OPEN') {
        if (rebooted) {
          const was = g.state === 'RECOVERY_REVIEW' ? g.interrupted_state : g.state;
          game.update({ state: 'RECOVERY_REVIEW', interrupted_state: was, system_ready: 0, reason: 'POWER_LOSS' });
          outcome = `round ${round.id} awaits banker review (was ${was})`;
          return;
        }
        ended = cancelInner(round.id, 'SERVER_RESTART');
        outcome = `round ${round.id} cancelled and refunded after server restart`;
      }
      game.update({ state: 'IDLE', round_id: null, system_ready: 0, interrupted_state: null, reason: ended ? 'SERVER_RESTART' : null });
    }).immediate();
    log(`startup recovery: ${outcome}`);
    if (ended) onRoundEnded();
  }

  // ---- views ---------------------------------------------------------------------------

  // What every phone may see (no other players' bets or counts: spec 26.5).
  function publicStatus() {
    const { g, round } = current();
    const last = q.lastRound.get();
    const view = { state: g.state, roundId: round ? round.id : null, systemReady: Boolean(g.system_ready) };
    if (g.state === 'AWAITING_RESULT_CONFIRMATION' && round) view.provisional = round.detected_color;
    if (last && last.status !== 'OPEN') {
      view.lastResult = { roundId: last.id, status: last.status, color: last.final_color };
    }
    return view;
  }

  // This player's bet in the current round, or in the last finished round.
  function playerBet(playerId) {
    const last = q.lastRound.get();
    if (!last) return null;
    const b = q.betFor.get(last.id, playerId);
    if (!b) return null;
    return {
      roundId: last.id, color: b.color, amount: b.amount, status: b.status,
      payout: b.status === 'WON' ? b.amount * PAYOUT_MULTIPLIER : 0,
    };
  }

  function bankerView() {
    const { g } = current();
    const r = g.round_id ? q.round.get(g.round_id) : q.lastRound.get();
    let round = null;
    if (r) {
      const bets = q.roundBets.all(r.id);
      const totals = Object.fromEntries(COLORS.map((c) => [c, {
        count: bets.filter((b) => b.color === c).length,
        amount: bets.filter((b) => b.color === c).reduce((s, b) => s + b.amount, 0),
      }]));
      round = { ...r, bets, totals, current: r.id === g.round_id };
    }
    return {
      state: g.state,
      reason: g.reason,
      systemReady: Boolean(g.system_ready),
      interruptedState: g.interrupted_state,
      actions: allowedActions(),
      simulated: Boolean(hardware.simulated || vision.simulated),
      round,
    };
  }

  // Server shutting down: late servo/camera completions must not touch the database.
  function shutdown() {
    op++;
  }

  return {
    init,
    shutdown,
    allowedActions,
    confirmSystemReady,
    startRound,
    closeBetting,
    drop,
    retryScan,
    confirmResult,
    retryDrop,
    cancelRound,
    confirmReady,
    resume,
    stop: () => stop('STOPPED'),
    // Automatic halt for a detected fault, e.g. the hotspot going away (spec 29.2).
    halt: (reason) => stop(reason),
    placeBet,
    publicStatus,
    playerBet,
    bankerView,
  };
}

module.exports = { createRounds, cellColor, BLACK_CELLS, BET_AMOUNTS, COLORS, PAYOUT_MULTIPLIER };
