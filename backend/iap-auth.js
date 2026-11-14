const { OAuth2Client } = require('google-auth-library');

const IAP_ISSUER = 'https://cloud.google.com/iap';
const IAP_PUBLIC_KEY_URL = 'https://www.gstatic.com/iap/verify/public_key';
const DEFAULT_KEY_CACHE_MS = 5 * 60 * 1000;

function cacheDuration(cacheControl) {
  const maxAge = String(cacheControl || '').match(/(?:^|,)\s*max-age=(\d+)/i);
  return maxAge ? Math.max(60_000, Number(maxAge[1]) * 1000) : DEFAULT_KEY_CACHE_MS;
}

function createIapAuthenticator({ audience, fetchImpl = globalThis.fetch, verifier = new OAuth2Client() }) {
  if (!audience) throw new Error('IAP audience is not configured');

  let publicKeys;
  let expiresAt = 0;
  let pendingKeys;

  async function getPublicKeys() {
    if (publicKeys && expiresAt > Date.now()) return publicKeys;
    if (pendingKeys) return pendingKeys;
    pendingKeys = (async () => {
      const response = await fetchImpl(IAP_PUBLIC_KEY_URL, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`IAP public-key request failed with status ${response.status}`);
      const keys = await response.json();
      if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.keys(keys).length) {
        throw new Error('IAP public-key response is invalid');
      }
      publicKeys = keys;
      expiresAt = Date.now() + cacheDuration(response.headers?.get?.('cache-control'));
      return publicKeys;
    })();
    try {
      return await pendingKeys;
    } finally {
      pendingKeys = null;
    }
  }

  return async function verifyIapAssertion(assertion) {
    if (typeof assertion !== 'string' || !assertion) return null;
    const keys = await getPublicKeys();
    let ticket;
    try {
      ticket = await verifier.verifySignedJwtWithCertsAsync(assertion, keys, audience, [IAP_ISSUER]);
    } catch {
      return null;
    }
    const claims = ticket.getPayload();
    if (!claims?.sub || !claims.email || (claims.email_verified === false)) return null;
    const email = String(claims.email).replace(/^accounts\.google\.com:/i, '').trim().toLowerCase();
    if (!email) return null;
    return {
      sub: String(claims.sub),
      email,
      name: String(claims.name || email),
    };
  };
}

module.exports = { createIapAuthenticator };
