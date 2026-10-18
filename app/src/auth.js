// Passwords, session tokens and cookies.
//
// The banker password is stored as a salted scrypt hash (spec 27.1). Session tokens are
// random 256-bit values; the database keeps only their SHA-256 hash, so a copied database
// file can't be used to log in as anyone.

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}

module.exports = { hashPassword, verifyPassword, newToken, hashToken, parseCookies };
