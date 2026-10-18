// Prototype reset modes (spec 31). Banker only, password required, only while the game
// is idle with nothing financial left open, and always after a database backup.
//
//   A "points": balances to zero and all point history cleared. Players, nicknames and
//              their phones' logins stay. Optionally gives everyone the current starting
//              points again so a demo can begin straight away.
//   B "players": every player account deleted (nicknames become free again).
//
// Kept by both: banker account, settings (starting points), camera calibration.

const fs = require('fs');
const path = require('path');

const KEEP_BACKUPS = 10;

function fail(code, message) {
  return { ok: false, code, message };
}

function createResets({ db, game, banker, points, backupDir, log = () => {} }) {
  const q = {
    pendingRequests: db.prepare("SELECT COUNT(*) AS n FROM point_requests WHERE status = 'PENDING'"),
    openRounds: db.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status = 'OPEN'"),
    playerIds: db.prepare('SELECT id FROM players ORDER BY id'),
    logEntry: db.prepare('INSERT INTO admin_log (action, detail) VALUES (?, ?)'),
    recentLog: db.prepare('SELECT action, detail, created_at FROM admin_log ORDER BY id DESC LIMIT 10'),
  };

  function precheck(password) {
    if (!banker.verifyPassword(password)) return fail('BAD_PASSWORD', 'Wrong banker password.');
    if (!game.isBetweenRounds() || q.openRounds.get().n) {
      return fail('NOT_IDLE', 'Resets are only allowed between rounds. Finish or cancel the current round first.');
    }
    if (q.pendingRequests.get().n) {
      return fail('PENDING', 'There are pending point requests. Approve, reject or cancel them first.');
    }
    return null;
  }

  // Copies the live database (safe while running) and keeps only the newest backups.
  async function backup(label) {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const file = path.join(backupDir, `game-${stamp}-before-${label}.db`);
    await db.backup(file);
    const old = fs.readdirSync(backupDir).filter((f) => /^game-\d{8}-\d{6}-before-.*\.db$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) fs.rmSync(path.join(backupDir, f));
    return file;
  }

  const resetPointsTx = db.transaction((regrant) => {
    db.exec(`
      DELETE FROM transactions;
      DELETE FROM point_requests;
      UPDATE game_state SET round_id = NULL;
      DELETE FROM bets;
      DELETE FROM rounds;
      UPDATE players SET balance = 0, reserved = 0;
    `);
    let granted = 0;
    if (regrant) for (const { id } of q.playerIds.all()) granted = points.grantStartingCredit(id);
    const n = q.playerIds.all().length;
    q.logEntry.run('RESET_POINTS', `${n} players set to ${regrant ? granted : 0} points; history cleared`);
    return { players: n, startingPoints: regrant ? granted : 0 };
  }).immediate;

  const resetPlayersTx = db.transaction(() => {
    const n = q.playerIds.all().length;
    db.exec(`
      UPDATE game_state SET round_id = NULL;
      DELETE FROM players;           -- also removes their sessions, bets, requests, transactions
      DELETE FROM rounds;
    `);
    q.logEntry.run('RESET_PLAYERS', `${n} player accounts deleted`);
    return { players: n };
  }).immediate;

  async function run(mode, password, opts) {
    const err = precheck(password);
    if (err) return err;
    const file = await backup(mode);
    // Re-check: something may have changed while the backup was being written.
    const again = precheck(password);
    if (again) return again;
    const r = mode === 'points' ? resetPointsTx(Boolean(opts.regrant)) : resetPlayersTx();
    log(`RESET ${mode}: ${JSON.stringify(r)}; backup ${file}`);
    return { ok: true, mode, backup: path.basename(file), ...r };
  }

  return {
    resetPoints: (password, { regrant = true } = {}) => run('points', password, { regrant }),
    resetPlayers: (password) => run('players', password, {}),
    recentLog: () => q.recentLog.all(),
  };
}

module.exports = { createResets, KEEP_BACKUPS };
