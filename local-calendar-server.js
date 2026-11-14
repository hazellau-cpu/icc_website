const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readToday, readNext } = require('./local-calendar');

const allowedOrigins = new Set(['http://localhost:8000', 'http://127.0.0.1:8000']);
const allowedHosts = new Set(['localhost:8787', '127.0.0.1:8787']);
const configPath = path.join(__dirname, 'secrets', 'local-calendar.json');

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method !== 'GET' || !allowedOrigins.has(origin) || !allowedHosts.has(request.headers.host)) {
    response.writeHead(403);
    response.end();
    return;
  }
  const url = new URL(request.url, 'http://localhost');
  if (!['/today', '/next'].includes(url.pathname)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const studentId = url.searchParams.get('studentId') || '';
  const courseType = url.searchParams.get('courseType') || '';
  if (url.pathname === '/next' && (!/^[a-z0-9_-]{1,64}$/i.test(studentId) || !['Robot', 'Coding', 'Math'].includes(courseType))) {
    response.writeHead(400, { 'Access-Control-Allow-Origin': origin });
    response.end();
    return;
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const result = url.pathname === '/today' ? await readToday(config) : await readNext({ ...config, studentId, courseType });
    response.writeHead(200);
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error('Calendar refresh failed:', error.message);
    response.writeHead(503);
    response.end(JSON.stringify({ detail: 'Calendar refresh failed. Check the local calendar reader and its access.' }));
  }
});

server.listen(8787, '127.0.0.1', () => console.log('Local calendar reader listening on 127.0.0.1:8787'));
