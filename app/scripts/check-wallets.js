// Wallet check for the deploy checklist: `npm run check-wallets`.
// Confirms every balance equals the sum of its transaction log and every reserved amount
// equals that player's pending redemption. Read-only; safe while the server runs.

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'game.db');
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const { createWallet } = require('../src/wallet');
const { MIGRATIONS } = require('../src/db');

if (db.pragma('user_version', { simple: true }) < MIGRATIONS.length) {
  console.log('Database not upgraded yet: start the server once (npm start), then run this again.');
  process.exit(1);
}

const r = createWallet(db).audit();
const { n } = db.prepare('SELECT COUNT(*) AS n FROM players').get();
const { t } = db.prepare('SELECT COUNT(*) AS t FROM transactions').get();
db.close();

if (r.ok) {
  console.log(`OK: ${n} players, ${t} transactions, all balances match.`);
} else {
  for (const p of r.ledger) console.log(`MISMATCH ${p.nickname}: balance ${p.balance}, ledger says ${p.ledger}`);
  for (const p of r.reserved) console.log(`MISMATCH ${p.nickname}: reserved ${p.reserved}, pending redemptions ${p.held}`);
  process.exit(1);
}
