const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readStarterDemographics } = require('./backend/starter-demographics');

const execFileAsync = promisify(execFile);
const allowedOrigins = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);
const allowedHosts = new Set(['localhost:8791', '127.0.0.1:8791']);
const configPath = path.join(__dirname, 'secrets', 'local-starter-sheet.json');

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method !== 'GET' || !allowedOrigins.has(origin) || !allowedHosts.has(request.headers.host)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (request.url !== '/birth-years') {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (!config.serviceAccount || !config.account) throw new Error('Starter Sheet reader configuration is incomplete.');
    const records = await readStarterDemographics({
      spreadsheetId: config.spreadsheetId,
      getAccessToken: async () => {
        const result = await execFileAsync('gcloud', [
          'auth', 'print-access-token', `--account=${config.account}`,
          `--impersonate-service-account=${config.serviceAccount}`,
          '--scopes=https://www.googleapis.com/auth/spreadsheets.readonly',
        ], { timeout: 30000, maxBuffer: 1024 * 1024 });
        return result.stdout.trim();
      },
    });
    response.writeHead(200);
    response.end(JSON.stringify({ records }));
  } catch (error) {
    console.error('Starter Sheet birth-year refresh failed:', error.message);
    response.writeHead(503);
    response.end(JSON.stringify({ detail: 'Starter Sheet birth-year refresh failed. Check the local reader and Sheet access.' }));
  }
});

server.listen(8791, '127.0.0.1', () => console.log('Local starter Sheet reader listening on 127.0.0.1:8791'));
