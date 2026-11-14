const { GoogleAuth } = require('google-auth-library');

function createGoogleAccessTokenProvider({ scopes, authClientProvider = null }) {
  let authClient;
  let pendingClient;

  return async function getAccessToken() {
    if (!authClient) {
      pendingClient ||= authClientProvider
        ? Promise.resolve(authClientProvider())
        : new GoogleAuth({ scopes }).getClient();
      try {
        authClient = await pendingClient;
      } finally {
        pendingClient = null;
      }
    }
    const result = await authClient.getAccessToken();
    const token = typeof result === 'string' ? result : result?.token;
    if (!token) throw new Error('Google credentials did not return an access token');
    return token;
  };
}

module.exports = { createGoogleAccessTokenProvider };
