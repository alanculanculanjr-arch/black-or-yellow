// Create the banker account or change its username/password: `npm run set-banker`.
// The password is typed without being shown and is stored only as a salted hash.
// Changing it logs out any open banker session.

const path = require('path');
const readline = require('readline');
const { openDatabase } = require('../src/db');
const { createBanker } = require('../src/banker');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'game.db');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const username = (await ask('Banker username: ')).trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    console.error('Username must be 3-20 letters, numbers or _.');
    process.exit(1);
  }
  const pw = await ask('Password (at least 8 characters): ', { hidden: true });
  if (pw.length < 8) {
    console.error('Password too short.');
    process.exit(1);
  }
  const again = await ask('Type the password again: ', { hidden: true });
  if (pw !== again) {
    console.error('Passwords do not match.');
    process.exit(1);
  }
  const db = openDatabase(DB_PATH);
  createBanker(db).setAccount(username, pw);
  db.close();
  console.log(`Banker account "${username}" saved. If the server is running, log in again.`);
})();
