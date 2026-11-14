const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { hashPassword } = require('./password-auth');

test('password route issues revocable tokens and validates request bodies', async () => {
  const credentials = await hashPassword('a unique test password for login');
  const account = {
    account_id: 'test-account', email: 'user@example.test', password_salt: credentials.salt,
    password_hash: credentials.hash, token_version: 1, enabled: 1,
  };
  let failures = 0;
  const fakeDb = {
    async query(sql) {
      if (sql.startsWith('SELECT token_version')) return [account];
      if (sql.includes('FROM students')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async transaction(callback) {
      return callback({
        async execute(sql, params) {
          if (sql.startsWith('INSERT IGNORE')) return [[]];
          if (sql.startsWith('SELECT failures')) return [[{ failures, elapsed: 0 }]];
          if (sql.startsWith('SELECT account_id')) return [[params[0] === account.email ? account : undefined].filter(Boolean)];
          if (sql.includes('failures = failures + 1')) { failures += 1; return [[]]; }
          if (sql.includes('SET failures = 0')) { failures = 0; return [[]]; }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      });
    },
  };
  require.cache[require.resolve('./db')] = { exports: fakeDb };
  process.env.PORT = '0';
  process.env.JWT_SECRET = 'test-secret-with-more-than-32-characters';
  const server = require('./server');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const signIn = (body) => fetch(`${base}/auth/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });

    for (const body of ['null', '[]', '{}', '{']) {
      assert.equal((await signIn(body)).status, 400);
    }
    assert.equal((await signIn(JSON.stringify({ email: account.email, password: 'x'.repeat(5000) }))).status, 400);
    assert.equal((await signIn(JSON.stringify({ email: account.email, password: 'wrong' }))).status, 401);

    const response = await signIn(JSON.stringify({ email: account.email, password: 'a unique test password for login' }));
    assert.equal(response.status, 200);
    const token = (await response.json()).access_token;
    const students = () => fetch(`${base}/students`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await students()).status, 200);
    account.token_version += 1;
    assert.equal((await students()).status, 401);

    const chunkedStatus = await new Promise((resolve, reject) => {
      const request = http.request(`${base}/auth/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      request.on('error', reject);
      request.end(JSON.stringify({ email: account.email, password: 'wrong' }));
    });
    assert.equal(chunkedStatus, 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
