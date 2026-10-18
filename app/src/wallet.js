// Wallet: the only code allowed to change a player's balance.
//
// Every change writes one ledger row and updates the balance together, inside the
// caller's SQLite transaction. The ledger's idempotency key means the same event (one
// approval, one payout) can be recorded at most once, however many times it is retried.

const LIMITS = { STEP: 5, PURCHASE_MAX: 100, START_MAX: 100 };

function createWallet(db) {
  const q = {
    player: db.prepare('SELECT id, balance, reserved FROM players WHERE id = ?'),
    hasKey: db.prepare('SELECT 1 FROM transactions WHERE idempotency_key = ?'),
    insert: db.prepare(`
      INSERT INTO transactions (player_id, type, amount, balance_after, idempotency_key, point_request_id, round_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    setBalance: db.prepare('UPDATE players SET balance = ? WHERE id = ?'),
    addReserved: db.prepare('UPDATE players SET reserved = reserved + ? WHERE id = ?'),
    ledgerMismatch: db.prepare(`
      SELECT p.id, p.nickname, p.balance, COALESCE(SUM(t.amount), 0) AS ledger
      FROM players p LEFT JOIN transactions t ON t.player_id = p.id
      GROUP BY p.id HAVING p.balance <> COALESCE(SUM(t.amount), 0)`),
    reservedMismatch: db.prepare(`
      SELECT p.id, p.nickname, p.reserved,
             COALESCE((SELECT SUM(amount) FROM point_requests r
                       WHERE r.player_id = p.id AND r.status = 'PENDING' AND r.type = 'REDEMPTION'), 0) AS held
      FROM players p WHERE p.reserved <> held`),
  };

  // Must run inside a db.transaction. Returns { applied: true, balance } or
  // { applied: false, duplicate: true } if this event was already recorded.
  // Throws if the change would leave fewer points than are reserved (a bug, never user input).
  function apply({ playerId, type, amount, key, requestId = null, roundId = null }) {
    if (!db.inTransaction) throw new Error('wallet.apply must run inside a transaction');
    if (!Number.isInteger(amount) || amount === 0) throw new Error(`bad amount ${amount}`);
    if (q.hasKey.get(key)) return { applied: false, duplicate: true };
    const p = q.player.get(playerId);
    if (!p) throw new Error(`no player ${playerId}`);
    const after = p.balance + amount;
    if (after < p.reserved) throw new Error(`player ${playerId} would go below reserved points`);
    q.insert.run(playerId, type, amount, after, key, requestId, roundId);
    q.setBalance.run(after, playerId);
    return { applied: true, balance: after };
  }

  // Holding points for a pending redemption doesn't move them, so it isn't a ledger entry;
  // the reserved total is checked against pending redemptions by audit() instead.
  function reserve(playerId, amount) {
    q.addReserved.run(amount, playerId);
  }

  function release(playerId, amount) {
    q.addReserved.run(-amount, playerId);
  }

  // Consistency check: every balance equals the sum of its ledger rows, and every
  // reserved amount equals that player's pending redemption. Empty arrays = all good.
  function audit() {
    const ledger = q.ledgerMismatch.all();
    const reserved = q.reservedMismatch.all();
    return { ok: ledger.length === 0 && reserved.length === 0, ledger, reserved };
  }

  return { apply, reserve, release, audit };
}

module.exports = { createWallet, LIMITS };
