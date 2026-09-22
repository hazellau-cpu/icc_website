const http = require('node:http');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || 8080);
const jwtSecret = process.env.JWT_SECRET || 'icc-local-development-secret';
const corsOrigin = process.env.CORS_ORIGIN || '*';

const sample = {
  programmes: [{ programme_id: 'AIKIRO', programme_name: 'AIKIRO Lv1', programme_type: 'Robot' }],
  curriculum: [],
  robots: [],
  components: [],
  inventory: [{ inventory_id: 'INV001', component: 'Motor', component_name: 'Motor', quantity: 5, location: 'Centre', replacement_cost: 156, Kit: 'AIKIRO', Component: 'Motor', 'Total center qty': '5' }],
  borrowings: [{ borrowing_id: 'BOR001', borrower: 'ST001', status: 'Still Borrowing' }],
};

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' });
  response.end(JSON.stringify(body));
}
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function createToken(subject) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: subject, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }));
  const signature = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
function isValidToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const expected = crypto.createHmac('sha256', jwtSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).exp > Math.floor(Date.now() / 1000); } catch { return false; }
}
function readJson(request) {
  return new Promise((resolve, reject) => { let data = ''; request.on('data', (chunk) => { data += chunk; }); request.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); } }); request.on('error', reject); });
}
function protectedRoute(request, response) {
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ') || !isValidToken(authorization.slice(7))) { send(response, 401, { detail: 'Unauthorized' }); return false; }
  return true;
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { status: 'ok', service: 'icc-backend' });
  if (request.method === 'POST' && url.pathname === '/auth/login') {
    try { const body = await readJson(request); if (!body.username || !body.password) return send(response, 400, { detail: 'username and password are required' }); return send(response, 200, { access_token: createToken(body.username), token_type: 'bearer' }); } catch { return send(response, 400, { detail: 'Invalid JSON body' }); }
  }
  if (!protectedRoute(request, response)) return undefined;
  if (request.method === 'GET' && url.pathname === '/programmes') return send(response, 200, sample.programmes);
  if (request.method === 'GET' && url.pathname === '/curriculum') return send(response, 200, sample.curriculum);
  if (request.method === 'GET' && url.pathname === '/robots') return send(response, 200, sample.robots);
  if (request.method === 'GET' && url.pathname === '/components') return send(response, 200, sample.components);
  if (request.method === 'GET' && url.pathname === '/centre-inventory') return send(response, 200, sample.inventory);
  if (request.method === 'GET' && url.pathname === '/borrowings') return send(response, 200, sample.borrowings);
  if (request.method === 'GET' && url.pathname.startsWith('/students/') && url.pathname.endsWith('/borrowings')) return send(response, 200, []);
  return send(response, 404, { detail: 'Not found' });
});

server.listen(port, '0.0.0.0', () => console.log(`icc-backend listening on ${port}`));
