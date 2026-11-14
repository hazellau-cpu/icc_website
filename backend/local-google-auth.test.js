const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { createServer } = require('./local-google-auth-server');

test('local Google trial verifies credentials and restricts approved verified accounts', async () => {
  const config = { clientId: 'test-client', emails: new Set(['approved@example.com']) };
  let claims = { email: 'APPROVED@example.com', email_verified: true };
  let verified = 0;
  const server = createServer({
    getConfig: async () => config,
    verify: async (token, audience) => {
      verified += 1;
      assert.equal(audience, config.clientId);
      if (token !== 'valid') throw new Error('Bad token');
      return { getPayload: () => claims };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const headers = { Host: 'localhost:8788', Origin: 'http://localhost:8000', 'Content-Type': 'application/json', Connection: 'close' };
  const request = (path, { method = 'GET', headers: requestHeaders = headers, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: requestHeaders }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, data }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const signIn = (credential) => request('/verify', { method: 'POST', body: JSON.stringify({ credential }) });
  try {
    assert.equal((await request('/config', { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
    assert.equal((await request('/config', { headers: { ...headers, Host: 'attacker.example:8788' } })).status, 403);
    const configResponse = await request('/config');
    assert.equal(configResponse.status, 200);
    assert.deepEqual(JSON.parse(configResponse.data), { clientId: config.clientId });
    assert.equal((await request('/verify', { method: 'OPTIONS' })).status, 204);
    assert.equal((await request('/verify', { method: 'POST', body: '{' })).status, 400);
    assert.equal((await request('/verify', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 400);
    assert.equal((await signIn('')).status, 400);
    assert.equal(verified, 0);
    assert.equal((await signIn('invalid')).status, 401);
    const approvedResponse = await signIn('valid');
    assert.equal(approvedResponse.status, 200);
    assert.deepEqual(JSON.parse(approvedResponse.data), { email: 'approved@example.com' });
    claims = { email: 'other@example.com', email_verified: true };
    assert.equal((await signIn('valid')).status, 403);
    claims = { email: 'approved@example.com', email_verified: false };
    assert.equal((await signIn('valid')).status, 403);
    assert.equal((await request('/verify', { method: 'POST', body: JSON.stringify({ credential: 'x'.repeat(17000) }) })).status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
