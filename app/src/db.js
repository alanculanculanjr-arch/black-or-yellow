// SQLite database: opening, safety settings and schema migrations.
//
// Migrations run in order and are never edited once shipped: to change the schema,
// append a new entry. PRAGMA user_version records how many have been applied, so an
// existing database is upgraded in place instead of being recreated (spec 38.7).

const Database = require('better-sqlite3');

const MIGRATIONS = [
  // 1: Phase 2 foundation (banker, players, sessions, game state, settings)
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Exactly one banker account (id is always 1).
  CREATE TABLE banker (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE banker_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  -- balance is every point the player owns; reserved is the part held for a pending
  -- redemption (Phase 3). Points available to bet or redeem = balance - reserved.
  CREATE TABLE players (
    id                      INTEGER PRIMARY KEY,
    nickname                TEXT NOT NULL UNIQUE COLLATE NOCASE
                            CHECK (length(nickname) BETWEEN 3 AND 12
                                   AND nickname NOT GLOB '*[^A-Za-z0-9]*'),
    status                  TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    balance                 INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    reserved                INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= balance),
    reactivation_requested_at TEXT,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at            TEXT
  );

  CREATE TABLE player_sessions (
    token_hash   TEXT PRIMARY KEY,
    player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX player_sessions_player ON player_sessions(player_id);

  -- Single-row game state. Phase 4 adds rounds and the full state machine.
  CREATE TABLE game_state (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    state      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO game_state (id, state) VALUES (1, 'IDLE');
  `,

  // 2: Phase 3 wallet (ledger, point requests, starting balance)
  `
  INSERT OR IGNORE INTO settings (key, value) VALUES ('starting_balance', '20');

  -- Top-ups and redemptions waiting for the banker (spec 21-23).
  CREATE TABLE point_requests (
    id          INTEGER PRIMARY KEY,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('PURCHASE', 'REDEMPTION')),
    amount      INTEGER NOT NULL CHECK (amount > 0 AND amount % 5 = 0
                                        AND (type = 'REDEMPTION' OR amount <= 100)),
    status      TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT CHECK (resolved_by IN ('BANKER', 'SYSTEM'))
  );
  -- At most one pending request per player (spec 21.4), enforced by the database itself.
  CREATE UNIQUE INDEX point_requests_one_pending ON point_requests(player_id) WHERE status = 'PENDING';

  -- Every point that moves in or out of a wallet (spec 30.3). amount is signed:
  -- positive adds points, negative removes them. idempotency_key names the event that
  -- caused the movement ('start:7', 'request:12', later 'bet:30'), and UNIQUE makes the
  -- database refuse to record the same event twice (spec 24).
  CREATE TABLE transactions (
    id               INTEGER PRIMARY KEY,
    player_id        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    type             TEXT NOT NULL CHECK (type IN ('STARTING_CREDIT', 'POINT_PURCHASE', 'POINT_REDEMPTION',
                                                   'BET_DEBIT', 'WIN_PAYOUT', 'ROUND_REFUND', 'ADMIN_RESET')),
    amount           INTEGER NOT NULL CHECK (amount <> 0),
    balance_after    INTEGER NOT NULL CHECK (balance_after >= 0),
    idempotency_key  TEXT NOT NULL UNIQUE,
    point_request_id INTEGER REFERENCES point_requests(id) ON DELETE CASCADE,
    round_id         INTEGER,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (type = 'ADMIN_RESET'
           OR (type IN ('POINT_REDEMPTION', 'BET_DEBIT') AND amount < 0)
           OR (type IN ('STARTING_CREDIT', 'POINT_PURCHASE', 'WIN_PAYOUT', 'ROUND_REFUND') AND amount > 0))
  );
  CREATE INDEX transactions_player ON transactions(player_id, id);
  `,

  // 3: Phase 4 rounds and bets
  `
  CREATE TABLE rounds (
    id               INTEGER PRIMARY KEY,
    status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SETTLED', 'CANCELLED')),
    drop_attempts    INTEGER NOT NULL DEFAULT 0,
    detection_status TEXT CHECK (detection_status IN ('OK', 'TIMEOUT', 'INVALID', 'CAMERA_LOST')),
    detected_cell    INTEGER CHECK (detected_cell BETWEEN 1 AND 16),
    detected_color   TEXT CHECK (detected_color IN ('BLACK', 'YELLOW')),
    final_color      TEXT CHECK (final_color IN ('BLACK', 'YELLOW')),
    corrected        INTEGER NOT NULL DEFAULT 0,
    cancel_reason    TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    betting_closed_at TEXT,
    ended_at         TEXT,
    CHECK ((status = 'SETTLED') = (final_color IS NOT NULL))
  );
  -- Only one unfinished round can exist at a time.
  CREATE UNIQUE INDEX rounds_one_open ON rounds(status) WHERE status = 'OPEN';

  CREATE TABLE bets (
    id         INTEGER PRIMARY KEY,
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    color      TEXT NOT NULL CHECK (color IN ('BLACK', 'YELLOW')),
    amount     INTEGER NOT NULL CHECK (amount IN (5, 10, 15, 20)),
    status     TEXT NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('LOCKED', 'WON', 'LOST', 'REFUNDED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (round_id, player_id)   -- one bet per player per round (spec 11.6)
  );

  ALTER TABLE game_state ADD COLUMN round_id INTEGER REFERENCES rounds(id);
  ALTER TABLE game_state ADD COLUMN reason TEXT;
  ALTER TABLE game_state ADD COLUMN system_ready INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE game_state ADD COLUMN interrupted_state TEXT;

  -- LEAVE GAME pressed during a round: the exit completes when the round ends (spec 18.3).
  ALTER TABLE players ADD COLUMN leave_requested_at TEXT;

  INSERT OR IGNORE INTO settings (key, value) VALUES ('boot_id', '');
  `,

  // 4: admin log. Resets wipe the transaction history, so they are recorded here instead
  // (spec 30.3 "ADMIN_RESET or equivalent audit records").
  `
  CREATE TABLE admin_log (
    id         INTEGER PRIMARY KEY,
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

function openDatabase(file) {
  const db = new Database(file);
  // WAL + synchronous=FULL: a committed wallet change survives a power cut.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  if (current > MIGRATIONS.length) {
    throw new Error(`Database is version ${current}, newer than this code (${MIGRATIONS.length}). Refusing to start.`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

module.exports = { openDatabase, MIGRATIONS };
