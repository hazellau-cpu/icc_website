const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const dummySalt = Buffer.alloc(16);
const dummyHash = Buffer.alloc(32);
const maxAttempts = 5;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 16 && Buffer.byteLength(password, 'utf8') <= 1024;
}

async function hashPassword(password) {
  if (!validatePassword(password)) throw new Error('Password must be at least 16 characters and no more than 1024 UTF-8 bytes.');
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 32, options);
  return { salt, hash };
}

async function matchesPassword(password, salt, expected) {
  if (!Buffer.isBuffer(salt) || salt.length !== 16 || !Buffer.isBuffer(expected) || expected.length !== 32) {
    throw new Error('Stored password credentials have an invalid format.');
  }
  const actual = await scrypt(password, salt, 32, options);
  return crypto.timingSafeEqual(actual, expected);
}

async function authenticatePassword(transaction, email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 1024) return { status: 'invalid' };
  const bucket = crypto.createHash('sha256').update(normalized).digest()[0];
  return transaction(async (connection) => {
    await connection.execute('INSERT IGNORE INTO password_login_buckets (bucket_id, failures, window_started_at) VALUES (?, 0, UTC_TIMESTAMP())', [bucket]);
    const [buckets] = await connection.execute(
      'SELECT failures, TIMESTAMPDIFF(SECOND, window_started_at, UTC_TIMESTAMP()) AS elapsed FROM password_login_buckets WHERE bucket_id = ? FOR UPDATE',
      [bucket],
    );
    const bucketState = buckets[0];
    if (Number(bucketState.elapsed) >= 900) {
      await connection.execute('UPDATE password_login_buckets SET failures = 0, window_started_at = UTC_TIMESTAMP() WHERE bucket_id = ?', [bucket]);
      bucketState.failures = 0;
    }
    if (Number(bucketState.failures) >= maxAttempts) return { status: 'limited' };
    const [accounts] = await connection.execute(
      'SELECT account_id, email, password_salt, password_hash, token_version, enabled FROM password_accounts WHERE email = ? LIMIT 1',
      [normalized],
    );
    const account = accounts[0];
    const salt = account ? account.password_salt : dummySalt;
    const expected = account ? account.password_hash : dummyHash;
    const matches = await matchesPassword(password, salt, expected);
    if (!account || !account.enabled || !matches) {
      await connection.execute('UPDATE password_login_buckets SET failures = failures + 1 WHERE bucket_id = ?', [bucket]);
      return { status: 'invalid' };
    }
    await connection.execute('UPDATE password_login_buckets SET failures = 0, window_started_at = UTC_TIMESTAMP() WHERE bucket_id = ?', [bucket]);
    return { status: 'ok', user: { sub: account.account_id, email: account.email, name: account.email, tokenVersion: account.token_version } };
  });
}

module.exports = { normalizeEmail, validatePassword, hashPassword, matchesPassword, authenticatePassword };
