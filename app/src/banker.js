// Banker account and login sessions (spec 27.1). Separate from player sessions: a banker
// cookie never identifies a player and vice versa.

const { hashPassword, verifyPassword, newToken, hashToken } = require('./auth');

const SESSION_HOURS = 12;

function createBanker(db) {
  const q = {
    get: db.prepare('SELECT * FROM banker WHERE id = 1'),
    upsert: db.prepare(`
      INSERT INTO banker (id, username, password_hash) VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash`),
    insertSession: db.prepare(
      `INSERT INTO banker_sessions (token_hash, expires_at) VALUES (?, datetime('now', '+${SESSION_HOURS} hours'))`),
    findSession: db.prepare("SELECT 1 FROM banker_sessions WHERE token_hash = ? AND expires_at > datetime('now')"),
    deleteSession: db.prepare('DELETE FROM banker_sessions WHERE token_hash = ?'),
    deleteAll: db.prepare('DELETE FROM banker_sessions'),
  };

  return {
    exists: () => Boolean(q.get.get()),

    setAccount(username, password) {
      q.upsert.run(String(username).trim(), hashPassword(password));
      q.deleteAll.run(); // a new password logs out every existing banker session
    },

    // Returns a session token, or null when the username or password is wrong.
    login(username, password) {
      const b = q.get.get();
      if (!b) return null;
      const userOk = String(username ?? '').trim() === b.username;
      const passOk = verifyPassword(String(password ?? ''), b.password_hash);
      if (!userOk || !passOk) return null;
      const token = newToken();
      q.insertSession.run(hashToken(token));
      return token;
    },

    verifyPassword(password) {
      const b = q.get.get();
      return Boolean(b) && verifyPassword(String(password ?? ''), b.password_hash);
    },

    isValidSession: (token) => Boolean(token) && Boolean(q.findSession.get(hashToken(token))),
    logout: (token) => token && q.deleteSession.run(hashToken(token)),

    // Called at every server start: after a crash or reboot the banker must log in again
    // and re-inspect the system (spec 29.3).
    invalidateAllSessions: () => q.deleteAll.run(),
  };
}

module.exports = { createBanker };
