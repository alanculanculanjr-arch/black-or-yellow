// Point Store: top-up and redemption requests, banker decisions, starting balance.
//
// Rules (spec 20-25):
//   - Top-ups: 5-100 points, multiples of 5. Redemptions: multiples of 5, up to the
//     points available (balance minus anything already reserved).
//   - One pending request per player. Only active players may ask. Requests are made and
//     decided only between rounds.
//   - A redemption reserves its points immediately so they can't also be bet; approval
//     removes them, rejection or cancellation gives them back.
//   - Deciding a request checks it is still PENDING inside the same transaction that
//     changes the wallet, so a double-clicked APPROVE credits once.

const { createWallet, LIMITS } = require('./wallet');

const ERRORS = {
  NOT_BETWEEN_ROUNDS: 'Point requests are handled between rounds. Please wait for this round to finish.',
  NOT_ACTIVE: 'Inactive players cannot buy or redeem points. Ask the banker to reactivate you.',
  BAD_PURCHASE: 'Top-ups must be 5 to 100 points, in steps of 5.',
  BAD_REDEMPTION: 'Redemptions must be at least 5 points, in steps of 5.',
  NOT_ENOUGH: 'You do not have enough available points for that.',
  ALREADY_PENDING: 'You already have a pending request. Wait for the banker to handle it.',
  NOT_FOUND: 'Request not found.',
  NOT_PENDING: 'This request has already been handled.',
  BAD_START: 'Starting points must be 0 to 100, in steps of 5.',
  NO_PLAYER: 'Player not found.',
};

function fail(code, extra) {
  return { ok: false, code, message: ERRORS[code], ...extra };
}

// Accepts 25 or "25"; anything else (null, "", "2.5", "abc") becomes NaN and is refused.
// Plain Number() would turn null and "" into 0.
function toInt(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number(raw);
  return NaN;
}

const isStep = (n) => Number.isInteger(n) && n > 0 && n % LIMITS.STEP === 0;

// The short message the player's phone shows for 5 seconds (spec 25.4).
function noticeFor(req) {
  if (req.status === 'CANCELLED') return 'Point Request Cancelled';
  if (req.type === 'PURCHASE') {
    return req.status === 'APPROVED' ? `${req.amount} Points Added Successfully` : 'Top-Up Request Rejected';
  }
  return req.status === 'APPROVED' ? `${req.amount} Points Redeemed Successfully` : 'Redemption Request Rejected';
}

function createPoints(db, game, wallet = createWallet(db)) {
  const q = {
    player: db.prepare('SELECT * FROM players WHERE id = ?'),
    pendingFor: db.prepare("SELECT * FROM point_requests WHERE player_id = ? AND status = 'PENDING'"),
    latestFor: db.prepare('SELECT id, type, amount, status FROM point_requests WHERE player_id = ? ORDER BY id DESC LIMIT 1'),
    byId: db.prepare('SELECT * FROM point_requests WHERE id = ?'),
    insert: db.prepare('INSERT INTO point_requests (player_id, type, amount) VALUES (?, ?, ?)'),
    resolve: db.prepare(`
      UPDATE point_requests SET status = ?, resolved_at = datetime('now'), resolved_by = ?
      WHERE id = ? AND status = 'PENDING'`),
    pendingAll: db.prepare(`
      SELECT r.id, r.player_id, p.nickname, r.type, r.amount, r.created_at,
             p.balance, p.balance - p.reserved AS available
      FROM point_requests r JOIN players p ON p.id = r.player_id
      WHERE r.status = 'PENDING' ORDER BY r.id`),
    recent: db.prepare(`
      SELECT t.id, t.created_at, p.nickname, t.type, t.amount, t.balance_after
      FROM transactions t JOIN players p ON p.id = t.player_id
      ORDER BY t.id DESC LIMIT ?`),
    getSetting: db.prepare("SELECT value FROM settings WHERE key = 'starting_balance'"),
    setSetting: db.prepare("UPDATE settings SET value = ? WHERE key = 'starting_balance'"),
  };

  function submit(playerId, type, rawAmount) {
    const amount = toInt(rawAmount);
    const p = q.player.get(playerId);
    if (!p) return fail('NO_PLAYER');
    if (p.status !== 'ACTIVE') return fail('NOT_ACTIVE');
    if (!game.isBetweenRounds()) return fail('NOT_BETWEEN_ROUNDS');
    if (type === 'PURCHASE' && !(isStep(amount) && amount <= LIMITS.PURCHASE_MAX)) return fail('BAD_PURCHASE');
    if (type === 'REDEMPTION' && !isStep(amount)) return fail('BAD_REDEMPTION');
    if (q.pendingFor.get(playerId)) return fail('ALREADY_PENDING');
    if (type === 'REDEMPTION' && amount > p.balance - p.reserved) return fail('NOT_ENOUGH');

    const id = q.insert.run(playerId, type, amount).lastInsertRowid;
    if (type === 'REDEMPTION') wallet.reserve(playerId, amount);
    return { ok: true, request: q.byId.get(id) };
  }

  const requestPurchase = db.transaction((playerId, amount) => submit(playerId, 'PURCHASE', amount)).immediate;
  const requestRedemption = db.transaction((playerId, amount) => submit(playerId, 'REDEMPTION', amount)).immediate;

  // action: 'approve' | 'reject' | 'cancel'. by: 'BANKER' | 'SYSTEM'.
  function decideInner(requestId, action, by) {
    const req = q.byId.get(requestId);
    if (!req) return fail('NOT_FOUND');
    if (req.status !== 'PENDING') return fail('NOT_PENDING', { status: req.status });

    const status = { approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' }[action];
    if (!status) throw new Error(`bad action ${action}`);
    if (q.resolve.run(status, by, requestId).changes !== 1) return fail('NOT_PENDING');

    if (req.type === 'REDEMPTION') wallet.release(req.player_id, req.amount);
    if (status === 'APPROVED') {
      wallet.apply({
        playerId: req.player_id,
        type: req.type === 'PURCHASE' ? 'POINT_PURCHASE' : 'POINT_REDEMPTION',
        amount: req.type === 'PURCHASE' ? req.amount : -req.amount,
        key: `request:${req.id}`,
        requestId: req.id,
      });
    }
    const done = q.byId.get(requestId);
    return { ok: true, request: done, playerId: done.player_id, notice: noticeFor(done) };
  }

  const decide = db.transaction((requestId, action) => {
    if (!game.isBetweenRounds()) return fail('NOT_BETWEEN_ROUNDS');
    return decideInner(requestId, action, 'BANKER');
  }).immediate;

  // When a player becomes inactive (leaves, times out, or is deactivated), their pending
  // request is cancelled and any reserved points are released (spec 18.4). Works at any
  // time, since it only gives points back. Returns the cancelled request or null.
  const cancelPendingFor = db.transaction((playerId) => {
    const req = q.pendingFor.get(playerId);
    if (!req) return null;
    return decideInner(req.id, 'cancel', 'SYSTEM');
  });

  function getStartingBalance() {
    return Number(q.getSetting.get().value);
  }

  const setStartingBalance = db.transaction((raw) => {
    const v = toInt(raw);
    if (!Number.isInteger(v) || v < 0 || v > LIMITS.START_MAX || v % LIMITS.STEP !== 0) return fail('BAD_START');
    if (!game.isBetweenRounds()) return fail('NOT_BETWEEN_ROUNDS');
    q.setSetting.run(String(v));
    return { ok: true, startingBalance: v };
  }).immediate;

  // Called by registration, inside its transaction (spec 20).
  function grantStartingCredit(playerId) {
    const amount = getStartingBalance();
    if (amount > 0) wallet.apply({ playerId, type: 'STARTING_CREDIT', amount, key: `start:${playerId}` });
    return amount;
  }

  return {
    requestPurchase,
    requestRedemption,
    decide,
    cancelPendingFor,
    getStartingBalance,
    setStartingBalance,
    grantStartingCredit,
    latestRequest: (playerId) => q.latestFor.get(playerId) || null,
    listPending: () => q.pendingAll.all(),
    recentTransactions: (limit = 50) => q.recent.all(limit),
    audit: () => wallet.audit(),
  };
}

module.exports = { createPoints, noticeFor, ERRORS };
