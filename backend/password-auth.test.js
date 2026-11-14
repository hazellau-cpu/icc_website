const test = require('node:test');
const assert = require('node:assert/strict');
const { authenticatePassword, hashPassword, matchesPassword, normalizeEmail, validatePassword } = require('./password-auth');

function fakeDatabase(account) {
  let failures = 0;
  let elapsed = 0;
  return {
    expireWindow() { elapsed = 901; },
    async transaction(callback) {
      return callback({
        async execute(sql, params) {
          if (sql.startsWith('INSERT IGNORE')) return [[]];
          if (sql.startsWith('SELECT failures')) return [[{ failures, elapsed }]];
          if (sql.startsWith('SELECT account_id')) return [[account && params[0] === account.email ? account : undefined].filter(Boolean)];
          if (sql.includes('failures = failures + 1')) { failures += 1; return [[]]; }
          if (sql.includes('SET failures = 0')) { failures = 0; elapsed = 0; return [[]]; }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      });
    },
  };
}

test('password login verifies hashes and locks repeated failures across transactions', async () => {
  const credentials = await hashPassword('a long unique password for tests');
  const account = { account_id: 'test-account', email: 'user@example.test', password_salt: credentials.salt, password_hash: credentials.hash, token_version: 3, enabled: 1 };
  const db = fakeDatabase(account);
  assert.equal(normalizeEmail(' USER@example.test '), account.email);
  assert.equal(validatePassword('short'), false);
  assert.equal(await matchesPassword('a long unique password for tests', credentials.salt, credentials.hash), true);
  assert.equal((await authenticatePassword(db.transaction, account.email, 'wrong password')).status, 'invalid');
  const success = await authenticatePassword(db.transaction, ' USER@example.test ', 'a long unique password for tests');
  assert.equal(success.status, 'ok');
  assert.equal(success.user.tokenVersion, 3);
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await authenticatePassword(db.transaction, account.email, 'wrong password')).status, 'invalid');
  }
  assert.equal((await authenticatePassword(db.transaction, account.email, 'a long unique password for tests')).status, 'limited');
  db.expireWindow();
  assert.equal((await authenticatePassword(db.transaction, account.email, 'a long unique password for tests')).status, 'ok');
  account.enabled = 0;
  assert.equal((await authenticatePassword(db.transaction, account.email, 'a long unique password for tests')).status, 'invalid');
  assert.equal((await authenticatePassword(db.transaction, 'unknown@example.test', 'wrong password')).status, 'invalid');
});
