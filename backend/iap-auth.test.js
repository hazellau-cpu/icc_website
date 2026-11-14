const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createIapAuthenticator } = require('./iap-auth');

const audience = '/projects/123/global/backendServices/456';

function createAssertion(privateKey, claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://cloud.google.com/iap',
    aud: audience,
    sub: 'accounts.google.com:123456789',
    email: 'James@example.com',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

test('verifies IAP assertions and normalizes the verified email', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let keyRequests = 0;
  const verify = createIapAuthenticator({
    audience,
    fetchImpl: async () => {
      keyRequests += 1;
      return {
        ok: true,
        headers: { get: () => 'public, max-age=300' },
        json: async () => ({ 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) }),
      };
    },
  });

  const user = await verify(createAssertion(privateKey, {}));
  assert.deepEqual(user, {
    sub: 'accounts.google.com:123456789',
    email: 'james@example.com',
    name: 'james@example.com',
  });
  await verify(createAssertion(privateKey, { name: 'James Lau' }));
  assert.equal(keyRequests, 1);
});

test('rejects invalid IAP audience and unverified email claims', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const verify = createIapAuthenticator({
    audience,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) }),
    }),
  });

  assert.equal(await verify(createAssertion(privateKey, { aud: '/projects/123/global/backendServices/789' })), null);
  assert.equal(await verify(createAssertion(privateKey, { email_verified: false })), null);
  assert.equal(await verify(''), null);
});

test('surfaces IAP key-service failures', async () => {
  const verify = createIapAuthenticator({
    audience,
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(verify('signed-assertion'), /IAP public-key request failed with status 503/);
});
