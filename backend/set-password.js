const crypto = require('node:crypto');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { transaction, close } = require('./db');
const { normalizeEmail, validatePassword, hashPassword, matchesPassword } = require('./password-auth');

async function promptPassword(label) {
  process.stdout.write(label);
  const mutedOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const input = readline.createInterface({ input: process.stdin, output: mutedOutput, terminal: true });
  try {
    return await new Promise((resolve, reject) => {
      input.question('', resolve);
      input.once('SIGINT', () => reject(new Error('Password entry cancelled.')));
      input.once('close', () => reject(new Error('Password entry cancelled.')));
    });
  } finally {
    input.close();
    process.stdout.write('\n');
  }
}

async function main() {
  const email = normalizeEmail(process.argv[2]);
  if (!email || process.argv.length !== 3) throw new Error('Usage: node set-password.js ACCOUNT_EMAIL');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in a private interactive terminal.');
  const password = await promptPassword('New password (at least 16 characters, input hidden): ');
  if (!validatePassword(password)) throw new Error('Password must be at least 16 characters and no more than 1024 UTF-8 bytes.');
  const confirmation = await promptPassword('Confirm password (input hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const { salt, hash } = await hashPassword(password);
  const bucket = crypto.createHash('sha256').update(email).digest()[0];
  await transaction(async (connection) => {
    const [existing] = await connection.execute('SELECT password_salt, password_hash FROM password_accounts WHERE email <> ? FOR UPDATE', [email]);
    for (const account of existing) {
      if (await matchesPassword(password, account.password_salt, account.password_hash)) {
        throw new Error('Each account must use a different password.');
      }
    }
    await connection.execute(
      `INSERT INTO password_accounts (account_id, email, password_salt, password_hash)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_salt = VALUES(password_salt), password_hash = VALUES(password_hash),
         token_version = token_version + 1, enabled = TRUE`,
      [crypto.randomUUID(), email, salt, hash],
    );
    await connection.execute('DELETE FROM password_login_buckets WHERE bucket_id = ?', [bucket]);
  });
  console.log('Password account saved. Existing sessions for this account are invalidated.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(close);
