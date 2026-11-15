const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readStarterDemographics } = require('./backend/starter-demographics');
const { createGoogleSheetsReader, sheetsForWorkspace } = require('./backend/google-sheets');

const execFileAsync = promisify(execFile);
const allowedOrigins = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);
const allowedHosts = new Set(['localhost:8791', '127.0.0.1:8791']);
const configPath = path.join(__dirname, 'secrets', 'local-starter-sheet.json');
const automationConfigPath = path.join(__dirname, 'secrets', 'local-sheets.json');

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method !== 'GET' || !allowedOrigins.has(origin) || !allowedHosts.has(request.headers.host)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (!['/birth-years', '/automation'].includes(request.url)) {
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
    const getAccessToken = async () => {
      const result = await execFileAsync('gcloud', [
        'auth', 'print-access-token', `--account=${config.account}`,
        `--impersonate-service-account=${config.serviceAccount}`,
        '--scopes=https://www.googleapis.com/auth/spreadsheets.readonly',
      ], { timeout: 30000, maxBuffer: 1024 * 1024 });
      return result.stdout.trim();
    };
    let result;
    if (request.url === '/birth-years') {
      result = { records: await readStarterDemographics({ spreadsheetId: config.spreadsheetId, getAccessToken }) };
    } else {
      const automationConfig = JSON.parse(await fs.readFile(automationConfigPath, 'utf8'));
      const readSheet = createGoogleSheetsReader({
        spreadsheetId: automationConfig.spreadsheetId,
        authClientProvider: async () => ({ getAccessToken }),
      });
      result = sheetsForWorkspace(await readSheet());
    }
    response.writeHead(200);
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error('Local Sheet refresh failed:', error.message);
    response.writeHead(503);
    response.end(JSON.stringify({ detail: 'Sheet refresh failed. Check the local reader and Sheet access.' }));
  }
});

server.listen(8791, '127.0.0.1', () => console.log('Local Sheet reader listening on 127.0.0.1:8791'));
