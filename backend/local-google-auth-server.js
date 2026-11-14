const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { OAuth2Client } = require('google-auth-library');
const { isGoogleEmailAllowed } = require('./google-auth');

const configPath = path.join(__dirname, '..', 'secrets', 'local-google-auth.json');
const origins = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);
const hosts = new Set(['localhost:8788', '127.0.0.1:8788']);
const google = new OAuth2Client();

async function loadConfig() {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (!/^[0-9]+-[a-zA-Z0-9]+\.apps\.googleusercontent\.com$/.test(config.clientId)
      || !Array.isArray(config.emails) || !config.emails.length
      || config.emails.some((email) => typeof email !== 'string' || !email.trim())) {
    throw new Error('Invalid local Google sign-in configuration.');
  }
  return { clientId: config.clientId, emails: new Set(config.emails.map((email) => email.trim().toLowerCase())) };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 16384) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > 16384) return reject(new Error('Request too large'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON')); }
    });
    request.on('error', reject);
  });
}

function createServer({ getConfig = loadConfig, verify = (token, audience) => google.verifyIdToken({ idToken: token, audience }) } = {}) {
  return http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!origins.has(origin) || !hosts.has(request.headers.host)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'OPTIONS' && url.pathname === '/verify') {
      response.setHeader('Access-Control-Allow-Methods', 'POST');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return send(204, null);
    }
    if (!((request.method === 'GET' && url.pathname === '/config') || (request.method === 'POST' && url.pathname === '/verify'))) {
      return send(404, { detail: 'Not found.' });
    }
    let config;
    try { config = await getConfig(); }
    catch (error) {
      console.error('Local Google sign-in configuration unavailable:', error.message);
      return send(503, { detail: 'Google sign-in is not configured.' });
    }
    if (request.method === 'GET') return send(200, { clientId: config.clientId });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return send(400, { detail: 'Invalid sign-in request.' });
    let body;
    try { body = await readBody(request); }
    catch { return send(400, { detail: 'Invalid sign-in request.' }); }
    if (!body || typeof body.credential !== 'string' || !body.credential || body.credential.length > 12000) {
      return send(400, { detail: 'Invalid sign-in request.' });
    }
    let claims;
    try { claims = (await verify(body.credential, config.clientId)).getPayload(); }
    catch {
      console.error('Google sign-in credential verification failed.');
      return send(401, { detail: 'Google sign-in could not be verified. Please try again.' });
    }
    const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (claims?.email_verified !== true || !isGoogleEmailAllowed(email, config.emails, '')) {
      return send(403, { detail: 'This Google account is not approved for the local trial.' });
    }
    return send(200, { email });
  });
}

if (require.main === module) {
  createServer().listen(8788, '127.0.0.1', () => console.log('Local Google sign-in trial listening on 127.0.0.1:8788'));
}
module.exports = { createServer };
