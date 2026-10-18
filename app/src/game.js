// Stored game state: the single game_state row. The round engine (rounds.js) decides the
// transitions; this module only reads and writes the row.
//
// "Between rounds" (IDLE) is when registration, point requests, reactivation approvals and
// setting changes are allowed (spec 16.1, 17, 20.2, 23.3).

const BETWEEN_ROUNDS = new Set(['IDLE']);
const FIELDS = ['state', 'round_id', 'reason', 'system_ready', 'interrupted_state'];

function createGame(db) {
  const get = db.prepare('SELECT * FROM game_state WHERE id = 1');

  function update(fields) {
    const keys = Object.keys(fields);
    for (const k of keys) if (!FIELDS.includes(k)) throw new Error(`unknown game_state field ${k}`);
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE game_state SET ${sets}, updated_at = datetime('now') WHERE id = 1`).run(fields);
  }

  return {
    row: () => get.get(),
    getState: () => get.get().state,
    setState: (state) => update({ state }),
    update,
    isBetweenRounds: () => BETWEEN_ROUNDS.has(get.get().state),
  };
}

module.exports = { createGame };
