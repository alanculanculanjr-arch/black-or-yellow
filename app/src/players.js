// Player accounts: registration, sessions, the 10-active-player limit and reactivation.
//
// Every function that changes accounts runs inside one SQLite transaction, so two phones
// registering or being reactivated at the same moment can never push the game past 10
// active players (spec 16.2).

const { newToken, hashToken } = require('./auth');

const MAX_ACTIVE = 10;
const NICKNAME_RE = /^[A-Za-z0-9]{3,12}$/;

const ERRORS = {
  INVALID_NICKNAME: 'Nicknames must be 3-12 letters or numbers, with no spaces or symbols.',
  NICKNAME_TAKEN: 'Nickname Already Taken',
  REGISTRATION_CLOSED: 'Registration Temporarily Closed',
  GAME_FULL: 'Game Full',
  NOT_BETWEEN_ROUNDS: 'This can only be done between rounds.',
  NOT_FOUND: 'Player not found.',
  NOT_INACTIVE: 'This player is already active.',
  NOT_ACTIVE: 'This player is already inactive.',
  NO_REQUEST: 'This player has no pending reactivation request.',
};

function fail(code) {
  return { ok: false, code, message: ERRORS[code] };
}

// hooks.onRegistered(playerId) runs inside the registration transaction (used to grant
// starting points), so a new account and its starting credit are saved together or not at all.
function createPlayers(db, game, hooks = {}) {
  const q = {
    activeCount: db.prepare("SELECT COUNT(*) AS n FROM players WHERE status = 'ACTIVE'"),
    byId: db.prepare('SELECT * FROM players WHERE id = ?'),
    byNickname: db.prepare('SELECT id FROM players WHERE nickname = ?'),
    insert: db.prepare("INSERT INTO players (nickname, status, last_seen_at) VALUES (?, 'ACTIVE', datetime('now'))"),
    insertSession: db.prepare('INSERT INTO player_sessions (token_hash, player_id) VALUES (?, ?)'),
    bySession: db.prepare(`
      SELECT p.* FROM player_sessions s JOIN players p ON p.id = s.player_id
      WHERE s.token_hash = ?`),
    touchSession: db.prepare("UPDATE player_sessions SET last_used_at = datetime('now') WHERE token_hash = ?"),
    setStatus: db.prepare('UPDATE players SET status = ?, reactivation_requested_at = NULL, leave_requested_at = NULL WHERE id = ?'),
    queueLeave: db.prepare("UPDATE players SET leave_requested_at = COALESCE(leave_requested_at, datetime('now')) WHERE id = ?"),
    queuedLeaves: db.prepare("SELECT id FROM players WHERE status = 'ACTIVE' AND leave_requested_at IS NOT NULL"),
    requestReactivation: db.prepare(
      "UPDATE players SET reactivation_requested_at = COALESCE(reactivation_requested_at, datetime('now')) WHERE id = ?"),
    clearRequest: db.prepare('UPDATE players SET reactivation_requested_at = NULL WHERE id = ?'),
    pendingRequests: db.prepare(
      "SELECT id FROM players WHERE status = 'INACTIVE' AND reactivation_requested_at IS NOT NULL"),
    touchSeen: db.prepare("UPDATE players SET last_seen_at = datetime('now') WHERE id = ?"),
    all: db.prepare(`
      SELECT id, nickname, status, balance, reserved, reactivation_requested_at, leave_requested_at, created_at, last_seen_at
      FROM players ORDER BY status, nickname`),
    activeIds: db.prepare("SELECT id FROM players WHERE status = 'ACTIVE'"),
  };

  const activeCount = () => q.activeCount.get().n;

  // Returns { ok, player, token } on success. The token goes into the player's cookie.
  const register = db.transaction((rawNickname) => {
    const nickname = String(rawNickname ?? '').trim();
    if (!NICKNAME_RE.test(nickname)) return fail('INVALID_NICKNAME');
    if (!game.isBetweenRounds()) return fail('REGISTRATION_CLOSED');
    if (q.byNickname.get(nickname)) return fail('NICKNAME_TAKEN');
    if (activeCount() >= MAX_ACTIVE) return fail('GAME_FULL');

    const id = q.insert.run(nickname).lastInsertRowid;
    const token = newToken();
    q.insertSession.run(hashToken(token), id);
    hooks.onRegistered?.(id);
    return { ok: true, player: q.byId.get(id), token };
  }).immediate;

  function findBySession(token) {
    if (!token) return null;
    const h = hashToken(token);
    const player = q.bySession.get(h);
    if (player) q.touchSession.run(h);
    return player || null;
  }

  // Inactive players ask the banker to let them back in (spec 16).
  const requestReactivation = db.transaction((playerId) => {
    const p = q.byId.get(playerId);
    if (!p) return fail('NOT_FOUND');
    if (p.status !== 'INACTIVE') return fail('NOT_INACTIVE');
    if (activeCount() >= MAX_ACTIVE) return fail('GAME_FULL');
    q.requestReactivation.run(playerId);
    return { ok: true };
  }).immediate;

  // Banker approval. When this fills the 10th slot, every other pending request is
  // rejected automatically; their ids are returned so they can be told.
  const approveReactivation = db.transaction((playerId) => {
    if (!game.isBetweenRounds()) return fail('NOT_BETWEEN_ROUNDS');
    const p = q.byId.get(playerId);
    if (!p) return fail('NOT_FOUND');
    if (p.status !== 'INACTIVE') return fail('NOT_INACTIVE');
    if (!p.reactivation_requested_at) return fail('NO_REQUEST');
    if (activeCount() >= MAX_ACTIVE) return fail('GAME_FULL');

    q.setStatus.run('ACTIVE', playerId);
    const autoRejected = [];
    if (activeCount() >= MAX_ACTIVE) {
      for (const { id } of q.pendingRequests.all()) {
        q.clearRequest.run(id);
        autoRejected.push(id);
      }
    }
    return { ok: true, autoRejected };
  }).immediate;

  const rejectReactivation = db.transaction((playerId) => {
    const p = q.byId.get(playerId);
    if (!p) return fail('NOT_FOUND');
    if (!p.reactivation_requested_at) return fail('NO_REQUEST');
    q.clearRequest.run(playerId);
    return { ok: true };
  }).immediate;

  // Used by the banker and by the 2-minute disconnect timeout. Wallet, nickname and
  // history are kept; only the active slot is freed.
  const deactivate = db.transaction((playerId) => {
    const p = q.byId.get(playerId);
    if (!p) return fail('NOT_FOUND');
    if (p.status !== 'ACTIVE') return fail('NOT_ACTIVE');
    q.setStatus.run('INACTIVE', playerId);
    return { ok: true };
  }).immediate;

  return {
    MAX_ACTIVE,
    activeCount,
    register,
    findBySession,
    get: (id) => q.byId.get(id) || null,
    list: () => q.all.all(),
    activeIds: () => q.activeIds.all().map((r) => r.id),
    touchSeen: (id) => q.touchSeen.run(id),
    requestReactivation,
    approveReactivation,
    rejectReactivation,
    deactivate,
    // LEAVE GAME during a round: remembered, then completed when the round ends (spec 18.3).
    queueLeave: (id) => q.queueLeave.run(id),
    queuedLeaves: () => q.queuedLeaves.all().map((r) => r.id),
  };
}

// What a player is allowed to see about themselves (never other players: spec 26.5).
function publicView(p) {
  if (!p) return null;
  return {
    id: p.id,
    nickname: p.nickname,
    status: p.status,
    balance: p.balance,
    available: p.balance - p.reserved,
    reactivationRequested: Boolean(p.reactivation_requested_at),
    leaveQueued: Boolean(p.leave_requested_at),
  };
}

module.exports = { createPlayers, publicView, MAX_ACTIVE, NICKNAME_RE, ERRORS };
