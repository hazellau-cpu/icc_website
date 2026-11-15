const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { query, transaction } = require('./db');
const { createJamesRouter } = require('./james-router');
const { createSheetsReadRouter } = require('./sheets-read-router');
const { createGoogleSheetsReader, sheetsForWorkspace } = require('./google-sheets');
const { createGoogleAccessTokenProvider } = require('./google-access-token');
const { readStarterDemographics } = require('./starter-demographics');
const { createGoogleCalendarReader } = require('./google-calendar');
const { createIapAuthenticator } = require('./iap-auth');
const { merge: mergeLiveSheets, applyStarterBirthYears } = require('../local-live-sheets');
const { authenticatePassword } = require('./password-auth');

const port = Number(process.env.PORT || 8080);
const jwtSecret = process.env.JWT_SECRET || '';
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:8000';
const approvalTokenSecret = process.env.JAMES_APPROVAL_TOKEN_SECRET || jwtSecret;
const jamesRouter = createJamesRouter({ query, jwtSecret: approvalTokenSecret });
const iapAudience = process.env.IAP_AUDIENCE || '';
if (process.env.K_SERVICE && !iapAudience) {
  throw new Error('IAP_AUDIENCE must be configured for Cloud Run.');
}
const iapAuthenticator = iapAudience ? createIapAuthenticator({ audience: iapAudience }) : null;
const googleCalendarReader = createGoogleCalendarReader({
  calendarId: process.env.GOOGLE_CALENDAR_ID || '',
});
const sheetsAllowedOrigins = (() => {
  const configured = process.env.SHEETS_READ_ALLOWED_ORIGINS || '';
  try {
    const parsed = JSON.parse(configured);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return configured.split(',').map((origin) => origin.trim()).filter(Boolean);
  }
})();
const sheetsReadSource = process.env.SHEETS_READ_SOURCE || 'database';
if (!['database', 'google'].includes(sheetsReadSource)) {
  throw new Error('SHEETS_READ_SOURCE must be either "database" or "google"');
}
const googleSheetsReader = sheetsReadSource === 'google'
  ? createGoogleSheetsReader({
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '',
  })
  : null;
const starterSheetId = process.env.STARTER_SHEET_SPREADSHEET_ID || '';
const starterSheetToken = starterSheetId
  ? createGoogleAccessTokenProvider({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  : null;
const sheetsReadRouter = createSheetsReadRouter({
  query,
  jwtSecret: process.env.SHEETS_READ_JWT_SECRET || '',
  clientId: process.env.SHEETS_READ_CLIENT_ID || '',
  clientSecret: process.env.SHEETS_READ_CLIENT_SECRET || '',
  allowedOrigins: sheetsAllowedOrigins,
  readSpreadsheet: googleSheetsReader,
});

const sharedEditKeys = new Set([
  'daily-lesson-drafts',
  'daily-lesson-finalizations',
  'robot-students',
  'coding-students',
  'math-students',
  'robot-progress',
  'component-items',
  'robot-lessons',
  'coding-lessons',
  'math-lessons',
  'starter-progress',
  'progress-finish-dates',
]);

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' });
  response.end(JSON.stringify(body));
}
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function createToken(user) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: user.sub, email: user.email, name: user.name, tokenVersion: user.tokenVersion, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }));
  const signature = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
function verifySessionToken(token) {
  if (!token || !jwtSecret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', jwtSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const suppliedSignature = Buffer.from(parts[2]);
  const expectedSignature = Buffer.from(expected);
  if (suppliedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
  } catch { return null; }
}
function readJson(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { tooLarge = true; return; }
      data += chunk;
    });
    request.on('end', () => {
      if (tooLarge) { reject(new SyntaxError('Request body is too large.')); return; }
      try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}
async function protectedRoute(request, response) {
  if (iapAuthenticator) {
    let user;
    try {
      user = await iapAuthenticator(request.headers['x-goog-iap-jwt-assertion']);
    } catch (error) {
      console.error('IAP identity verification is unavailable:', error.message);
      send(response, 503, { detail: 'Identity verification is unavailable' });
      return false;
    }
    if (!user) {
      send(response, 401, { detail: 'IAP authentication required' });
      return false;
    }
    request.authenticatedUser = user;
    console.log(JSON.stringify({ event: 'api_request', actor_email: user.email, method: request.method, path: new URL(request.url, `http://${request.headers.host}`).pathname, timestamp: new Date().toISOString() }));
    return true;
  }

  const authorization = request.headers.authorization || '';
  const user = authorization.startsWith('Bearer ') ? verifySessionToken(authorization.slice(7)) : null;
  if (!user || !user.sub || !Number.isInteger(user.tokenVersion)) { send(response, 401, { detail: 'Unauthorized' }); return false; }
  const accounts = await query('SELECT token_version, enabled FROM password_accounts WHERE account_id = ? LIMIT 1', [user.sub]);
  if (!accounts.length || !accounts[0].enabled || accounts[0].token_version !== user.tokenVersion) {
    send(response, 401, { detail: 'Unauthorized' });
    return false;
  }
  request.authenticatedUser = user;
  console.log(JSON.stringify({ event: 'api_request', actor_email: user.email, method: request.method, path: new URL(request.url, `http://${request.headers.host}`).pathname, timestamp: new Date().toISOString() }));
  return true;
}

async function getSharedEdits() {
  const rows = await query('SELECT edit_key, edit_value, version FROM workspace_shared_edits');
  return Object.fromEntries(rows.map((row) => {
    const value = typeof row.edit_value === 'string' ? JSON.parse(row.edit_value) : row.edit_value;
    return [row.edit_key, { value, version: Number(row.version) }];
  }));
}

function identifier(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function databaseError(response, error) {
  console.error(error);
  const unavailable = /Database is not configured|ECONNREFUSED|ER_ACCESS_DENIED|PROTOCOL_CONNECTION/i.test(error.message);
  return send(response, unavailable ? 503 : 500, { detail: unavailable ? 'Database is unavailable' : 'Database request failed' });
}

const staticAssets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/icc-config.js', ['icc-config.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/services.js', ['services.js', 'text/javascript; charset=utf-8']],
  ['/local-calendar-mapping.js', ['local-calendar-mapping.js', 'text/javascript; charset=utf-8']],
  ['/local-pathways.js', ['local-pathways.js', 'text/javascript; charset=utf-8']],
  ['/local-live-sheets.js', ['local-live-sheets.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

async function serveStatic(request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  const asset = staticAssets.get(pathname);
  if (!asset) return false;
  const publicFile = path.join(__dirname, '..', 'public', asset[0]);
  const sourceFile = path.join(__dirname, '..', asset[0]);
  let contents;
  try {
    contents = await fs.readFile(publicFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    contents = await fs.readFile(sourceFile);
  }
  response.writeHead(200, {
    'Content-Type': asset[1],
    'Cache-Control': asset[0] === 'index.html' || asset[0] === 'icc-config.js' ? 'no-store' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : contents);
  return true;
}

function inventoryShape(row) {
  return {
    inventory_id: row.inventory_id,
    'Component ID': row.component_id,
    Component: row.Component,
    Kit: row.Kit,
    Tier: row.Tier,
    'Unit Price': row['Unit Price'],
    'Total center qty': row['Total center qty'],
    'Last counted': row['Last counted'],
    Notes: row.Notes,
  };
}

async function getInventory() {
  const rows = await query(`SELECT i.inventory_id, c.component_id, c.component_name AS Component, c.kit_id AS Kit,
      c.tier AS Tier, c.unit_price AS \`Unit Price\`, i.centre_quantity AS \`Total center qty\`,
      DATE_FORMAT(i.last_counted, '%Y-%m-%d') AS \`Last counted\`, i.notes AS Notes
    FROM inventory_items i JOIN components c ON c.component_id = i.component_id
    ORDER BY c.kit_id, c.component_name`);
  return rows.map(inventoryShape);
}

async function getWorkspaceBootstrap() {
  const [
    students,
    programmes,
    curriculum,
    robots,
    components,
    inventory,
    robotProgress,
    topicProgress,
    checklist,
    borrowings,
    robotLessons,
    codingLessons,
  ] = await Promise.all([
    query(`SELECT s.student_id, s.student_name, s.course_type, s.programme_id, p.programme_name,
        s.tutor_name, s.attendance_status, s.paid_status, s.current_robot, s.robot_status, s.progress,
        s.comment, s.total_hours, s.remaining_hours, s.hours_completed,
        DATE_FORMAT(s.new_bill_start, '%Y-%m-%d') AS new_bill_start, s.remarks, s.source_row_number
      FROM students s JOIN programmes p ON p.programme_id = s.programme_id ORDER BY s.student_name`),
    query('SELECT programme_id, programme_name, programme_type, kit_id, level_number, variant FROM programmes ORDER BY programme_type, kit_id, level_number, variant'),
    query(`SELECT c.curriculum_id AS item_id, c.programme_id, p.programme_name AS \`Program name\`,
        c.level_number AS Level, c.item_name AS Item, c.item_name AS Topic
      FROM curriculum_items c JOIN programmes p ON p.programme_id = c.programme_id ORDER BY c.programme_id, c.level_number`),
    query(`SELECT r.robot_id AS item_id, r.programme_id, p.programme_name AS \`Programme Name\`,
        p.kit_id AS \`Kit name\`, p.level_number AS Level, r.sequence_number AS Sequence,
        r.robot_name AS \`Robot name\`, p.variant AS Variant FROM robot_library_items r
      JOIN programmes p ON p.programme_id = r.programme_id ORDER BY r.programme_id, r.sequence_number`),
    query(`SELECT c.component_id AS \`Component ID\`, c.kit_id AS Kit, c.component_name AS Component,
        c.unit_price AS \`Unit Price\`, c.tier AS Tier,
        ${Array.from({ length: 8 }, (_, index) => `MAX(CASE WHEN r.level_number = ${index + 1} THEN r.level_quantity END) AS \`Lv${index + 1}\``).join(',\n        ')},
        ${Array.from({ length: 8 }, (_, index) => `MAX(CASE WHEN r.level_number = ${index + 1} THEN r.cumulative_quantity END) AS \`Lv${index + 1} total\``).join(',\n        ')}
      FROM components c LEFT JOIN component_level_requirements r ON r.component_id = c.component_id
      GROUP BY c.component_id, c.kit_id, c.component_name, c.unit_price, c.tier ORDER BY c.kit_id, c.component_name`),
    getInventory(),
    query(`SELECT p.student_id, s.student_name AS Student, p.programme_id, p.robot_name AS Robot,
        p.sequence_number AS Sequence, p.status AS Status, p.notes AS Notes FROM student_robot_progress p
      JOIN students s ON s.student_id = p.student_id ORDER BY s.student_name, p.sequence_number`),
    query(`SELECT p.student_id, s.student_name AS name, p.programme_id, p.level_number AS next,
        p.topic AS topics, p.status, p.notes AS project FROM student_topic_progress p
      JOIN students s ON s.student_id = p.student_id ORDER BY s.student_name, p.level_number`),
    query(`SELECT c.student_id, s.student_name AS student, c.component_id AS componentId,
        i.component_name AS item, c.required_quantity AS requiredQty, c.student_quantity AS studentQty,
        c.status AS quantityStatus, c.notes AS notes, c.generated_for_programme_id AS programme_id
      FROM student_checklist_items c JOIN students s ON s.student_id = c.student_id
      JOIN components i ON i.component_id = c.component_id ORDER BY s.student_name, i.component_name`),
    query(`SELECT b.borrowing_id, b.student_id, s.student_name AS borrower, c.component_name AS item,
        c.kit_id AS kit, b.quantity, b.status, DATE_FORMAT(b.borrowed_on, '%Y-%m-%d') AS borrowed_on,
        DATE_FORMAT(b.returned_on, '%Y-%m-%d') AS returned_on, b.notes
      FROM borrowing_logs b JOIN students s ON s.student_id = b.student_id
      JOIN components c ON c.component_id = b.component_id ORDER BY b.borrowed_on DESC`),
    query(`SELECT r.robot_lesson_id, r.student_id, s.student_name AS student, r.tutor_name AS Tutor,
        p.programme_name AS \`Programme Name\`, r.robot_name AS \`Robot Name\`,
        r.current_level AS \`Current Level\`, DATE_FORMAT(r.lesson_date, '%Y-%m-%d') AS \`Lesson Date\`,
        r.robot_status AS \`Robot Status\`, r.attendance AS Attendance, r.comment AS Comment, r.remarks AS Remarks
      FROM robot_lessons r JOIN students s ON s.student_id = r.student_id
      JOIN programmes p ON p.programme_id = r.programme_id ORDER BY r.lesson_date DESC`),
    query(`SELECT c.coding_lesson_id, c.student_id, s.student_name AS student, c.tutor_name AS Tutor,
        p.programme_name AS Programme, DATE_FORMAT(c.lesson_date, '%Y-%m-%d') AS \`Lesson Date\`,
        c.attendance AS Attendance, c.starting_level AS \`Starting Level\`, c.ending_level AS \`Ending Level\`,
        c.topic AS Topic, c.comment AS Comment, c.remarks AS Remarks
      FROM coding_lessons c JOIN students s ON s.student_id = c.student_id
      JOIN programmes p ON p.programme_id = c.programme_id ORDER BY c.lesson_date DESC`),
  ]);
  const rowForStudent = (row) => ({
    'Student ID': row.student_id,
    Name: row.student_name,
    'Course type': row.course_type,
    'Programme ID': row.programme_id,
    'Programme Name': row.programme_name,
    'Tutor Name': row.tutor_name || '',
    'Attendance Status': row.attendance_status || '',
    'Paid Status': row.paid_status || '',
    'Current Robot': row.current_robot || '',
    'Robot Status': row.robot_status || '',
    Progress: row.progress || '',
    Comment: row.comment || '',
    'Total Hours': row.total_hours ?? '',
    'Remaining Hours': row.remaining_hours ?? '',
    'Hours Completed': row.hours_completed ?? '',
    'New Bill Start': row.new_bill_start || '',
    Remarks: row.remarks || '',
    source_row_number: row.source_row_number || '',
  });
  const studentRecords = students.map((row) => {
    const sourceRow = rowForStudent(row);
    return {
      studentId: row.student_id,
      name: row.student_name,
      studentType: row.course_type,
      program: row.programme_name,
      course: row.programme_name,
      tutor: row.tutor_name || '',
      attendance: row.attendance_status || '',
      nextRobot: row.current_robot || '',
      progress: row.progress || '',
      comment: row.comment || '',
      sourceRow,
    };
  });
  const studentLists = {
    robotStudents: studentRecords.filter((row) => row.studentType === 'Robot'),
    codingStudents: studentRecords.filter((row) => row.studentType === 'Coding'),
    mathStudents: studentRecords.filter((row) => row.studentType === 'Math'),
  };
  const bootstrap = {
    ...studentLists,
    robotPrograms: programmes.map((row) => ({ ...row, Program: row.programme_name })),
    curriculum,
    robots,
    componentLibrary: components,
    inventory,
    centerInventory: inventory,
    robotProgress: robotProgress.map((row) => ({
      ...row,
      studentId: row.student_id,
      sourceRow: { 'Programme ID': row.programme_id },
    })),
    codingProgress: topicProgress.map((row) => ({ ...row, studentId: row.student_id, sourceId: row.student_id })),
    componentItems: checklist.map((row) => ({
      ...row,
      sourceRow: { 'Programme ID': row.programme_id, Notes: row.notes || '' },
    })),
    borrowings: borrowings.map((row) => ({
      ...row,
      sourceRow: {
        'Student ID': row.student_id,
        Student: row.borrower,
        Kit: row.kit,
        Quantity: row.quantity,
        Status: row.status,
        'Borrowed On': row.borrowed_on,
        'Returned On': row.returned_on,
        Notes: row.notes || '',
      },
    })),
    robotLessons: robotLessons.map((row) => ({ ...row, 'Lesson time': row['Lesson Date'], 'Student name': row.student })),
    codingLessons: codingLessons.map((row) => ({ ...row, 'Lesson time': row['Lesson Date'], 'Student (Coding)': row.student })),
    mathLessons: [],
    files: [],
    reminders: [],
    dailyLessonDrafts: [],
    dailyLessonFinalizations: [],
  };
  const sharedEdits = await getSharedEdits();
  if (!googleSheetsReader) return { ...bootstrap, sharedEdits };
  const sheets = await googleSheetsReader();
  const liveWorkspace = mergeLiveSheets(bootstrap, sheetsForWorkspace(sheets));
  if (starterSheetToken) {
    const records = await readStarterDemographics({ spreadsheetId: starterSheetId, getAccessToken: starterSheetToken });
    const result = applyStarterBirthYears(liveWorkspace.robotStudents, records);
    if (result.unmatched) console.warn(`Starter Sheet birth years: ${result.unmatched} student IDs not in the Robot roster.`);
    liveWorkspace.robotStudents = result.students;
  }
  return { ...bootstrap, ...liveWorkspace, sharedEdits };
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const url = new URL(requestUrl);
  if (url.pathname === '/api') url.pathname = '/';
  else if (url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice(4);
  const healthRequest = request.method === 'GET' && url.pathname === '/health';

  if (iapAuthenticator && !healthRequest && !await protectedRoute(request, response)) return undefined;

  if (request.method === 'OPTIONS') {
    if (requestUrl.pathname.startsWith('/api/sheets/')) return sheetsReadRouter.handleOptions(request, response);
    return send(response, 204, {});
  }
  if (!iapAuthenticator) {
    const sheetsHandled = await sheetsReadRouter.handle(request, response, requestUrl, readJson);
    if (sheetsHandled) return undefined;
  }
  if (healthRequest) return send(response, 200, { status: 'ok', service: 'icc-backend' });
  if (await serveStatic(request, response, url.pathname)) return undefined;
  if (iapAuthenticator) {
    const sheetsHandled = await sheetsReadRouter.handle(request, response, requestUrl, readJson);
    if (sheetsHandled) return undefined;
  }
  if (request.method === 'POST' && url.pathname === '/auth/password') {
    if (iapAuthenticator) return send(response, 404, { detail: 'Password sign-in is disabled when IAP is enabled.' });
    try {
      if (jwtSecret.length < 32) return send(response, 503, { detail: 'Sign-in is not configured.' });
      const length = request.headers['content-length'];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 4096)) return send(response, 400, { detail: 'Invalid sign-in request.' });
      const body = await readJson(request, 4096);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.email !== 'string' || typeof body.password !== 'string') {
        return send(response, 400, { detail: 'Invalid sign-in request.' });
      }
      const result = await authenticatePassword(transaction, body.email, body.password);
      if (result.status === 'limited') return send(response, 429, { detail: 'Too many attempts. Try again later.' });
      if (result.status !== 'ok') return send(response, 401, { detail: 'Invalid email or password.' });
      const user = result.user;
      console.log(JSON.stringify({ event: 'user_sign_in', actor_email: user.email, timestamp: new Date().toISOString() }));
      return send(response, 200, { access_token: createToken(user), token_type: 'bearer', user: { email: user.email, name: user.name } });
    } catch (error) {
      if (error instanceof SyntaxError) return send(response, 400, { detail: 'Invalid sign-in request.' });
      console.error('Password authentication failed:', error);
      return send(response, 503, { detail: 'Sign-in is unavailable. Try again later.' });
    }
  }
  try {
    if (!iapAuthenticator && !await protectedRoute(request, response)) return undefined;
    if (request.method === 'GET' && url.pathname === '/auth/session') {
      return send(response, 200, { user: request.authenticatedUser });
    }
    const jamesHandled = await jamesRouter.handle(request, response, url, readJson, send);
    if (jamesHandled) return jamesHandled;
    if (request.method === 'GET' && url.pathname === '/workspace/bootstrap') {
      return send(response, 200, await getWorkspaceBootstrap());
    }
    const sharedEditMatch = url.pathname.match(/^\/workspace\/edits\/([a-z0-9-]+)$/);
    if (request.method === 'PUT' && sharedEditMatch) {
      const key = decodeURIComponent(sharedEditMatch[1]);
      if (!sharedEditKeys.has(key)) return send(response, 404, { detail: 'Shared workspace edit not found' });
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0
        || !Object.hasOwn(body, 'value')) {
        return send(response, 400, { detail: 'Invalid shared workspace edit' });
      }
      const serialized = JSON.stringify(body.value);
      if (serialized === undefined || Buffer.byteLength(serialized) > 512 * 1024) {
        return send(response, 413, { detail: 'Shared workspace edit is too large' });
      }
      if (body.expected_version === 0) {
        try {
          await query('INSERT INTO workspace_shared_edits (edit_key, edit_value, version, updated_by) VALUES (?, ?, 1, ?)', [
            key, serialized, request.authenticatedUser.email,
          ]);
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY') return send(response, 409, { detail: 'This shared edit changed in another session. Reload and retry.' });
          throw error;
        }
      } else {
        const result = await query('UPDATE workspace_shared_edits SET edit_value = ?, version = version + 1, updated_by = ? WHERE edit_key = ? AND version = ?', [
          serialized, request.authenticatedUser.email, key, body.expected_version,
        ]);
        if (!result.affectedRows) return send(response, 409, { detail: 'This shared edit changed in another session. Reload and retry.' });
      }
      return send(response, 200, { key, version: body.expected_version + 1 });
    }
    if (request.method === 'GET' && url.pathname === '/calendar/today') {
      try {
        return send(response, 200, await googleCalendarReader.readToday());
      } catch (error) {
        console.error('Google Calendar read failed:', error.message);
        return send(response, 503, { detail: 'Google Calendar is unavailable' });
      }
    }
    if (request.method === 'GET' && url.pathname === '/calendar/next') {
      try {
        return send(response, 200, await googleCalendarReader.readNext({
          studentId: url.searchParams.get('studentId') || '',
          courseType: url.searchParams.get('courseType') || '',
        }));
      } catch (error) {
        console.error('Google Calendar read failed:', error.message);
        const invalid = /Invalid student ID or course type/.test(error.message);
        return send(response, invalid ? 400 : 503, { detail: invalid ? error.message : 'Google Calendar is unavailable' });
      }
    }
    if (request.method === 'GET' && url.pathname === '/students') {
      const rows = await query(`SELECT student_id AS \`Student ID\`, student_name AS Name, course_type AS \`Course type\`,
        programme_id AS \`Programme ID\`, tutor_name AS \`Tutor Name\`, attendance_status AS \`Attendance Status\`,
        current_robot AS \`Current Robot\`, robot_status AS \`Robot Status\` FROM students ORDER BY student_name`);
      return send(response, 200, { students: rows });
    }
    if (request.method === 'GET' && url.pathname === '/programmes') {
      const rows = await query('SELECT programme_id, programme_name, programme_type, kit_id, level_number AS level, variant FROM programmes ORDER BY programme_type, kit_id, level_number, variant');
      return send(response, 200, { programmes: rows });
    }
    if (request.method === 'GET' && url.pathname === '/curriculum') {
      const rows = await query(`SELECT curriculum_id AS item_id, programme_id, level_number AS level, item_name, item_name AS Item,
        item_name AS Topic FROM curriculum_items ORDER BY programme_id, level_number`);
      return send(response, 200, { curriculum: rows });
    }
    if (request.method === 'GET' && url.pathname === '/robots') {
      const rows = await query(`SELECT r.robot_id AS item_id, r.programme_id, p.programme_name, p.kit_id AS kit_id,
        p.level_number AS level, r.sequence_number AS sequence, r.robot_name AS item_name,
        r.robot_name AS \`Robot name\`, p.kit_id AS \`Kit name\`, p.level_number AS Level, r.sequence_number AS Sequence,
        p.variant AS Variant FROM robot_library_items r JOIN programmes p ON p.programme_id = r.programme_id
        ORDER BY r.programme_id, r.sequence_number`);
      return send(response, 200, { robots: rows });
    }
    if (request.method === 'GET' && url.pathname === '/components') {
      const rows = await query('SELECT component_id AS \`Component ID\`, kit_id AS Kit, component_name AS Component, unit_price AS \`Unit Price\`, tier AS Tier FROM components ORDER BY kit_id, component_name');
      return send(response, 200, { components: rows });
    }
    if (request.method === 'GET' && url.pathname === '/centre-inventory') return send(response, 200, { items: await getInventory() });
    if (request.method === 'POST' && url.pathname === '/centre-inventory') {
      const body = await readJson(request);
      const componentId = body.component_id || body['Component ID'];
      if (!componentId) return send(response, 400, { detail: 'component_id is required' });
      const inventoryId = body.inventory_id || identifier('INV');
      await query('INSERT INTO inventory_items (inventory_id, component_id, centre_quantity, last_counted, notes) VALUES (?, ?, ?, ?, ?)', [inventoryId, componentId, Number(body['Total center qty'] ?? body.centre_quantity ?? 0), body['Last counted'] || null, body.Notes || null]);
      return send(response, 201, (await getInventory()).find((item) => item.inventory_id === inventoryId));
    }
    const inventoryMatch = url.pathname.match(/^\/centre-inventory\/([^/]+)$/);
    if (request.method === 'PATCH' && inventoryMatch) {
      const body = await readJson(request);
      const assignments = [], values = [];
      if (body['Total center qty'] !== undefined || body.centre_quantity !== undefined) { assignments.push('centre_quantity = ?'); values.push(Number(body['Total center qty'] ?? body.centre_quantity)); }
      if (body['Last counted'] !== undefined) { assignments.push('last_counted = ?'); values.push(body['Last counted'] || null); }
      if (body.Notes !== undefined) { assignments.push('notes = ?'); values.push(body.Notes || null); }
      if (!assignments.length) return send(response, 400, { detail: 'No supported inventory fields provided' });
      values.push(decodeURIComponent(inventoryMatch[1]));
      const result = await query(`UPDATE inventory_items SET ${assignments.join(', ')} WHERE inventory_id = ?`, values);
      if (!result.affectedRows) return send(response, 404, { detail: 'Inventory item not found' });
      return send(response, 200, (await getInventory()).find((item) => item.inventory_id === decodeURIComponent(inventoryMatch[1])));
    }
    if (request.method === 'DELETE' && inventoryMatch) {
      const result = await query('DELETE FROM inventory_items WHERE inventory_id = ?', [decodeURIComponent(inventoryMatch[1])]);
      return send(response, result.affectedRows ? 204 : 404, result.affectedRows ? {} : { detail: 'Inventory item not found' });
    }
    if (request.method === 'GET' && url.pathname === '/borrowings') {
      const rows = await query(`SELECT b.borrowing_id, b.student_id, s.student_name AS borrower, c.component_name AS item, b.quantity,
        b.status, DATE_FORMAT(b.borrowed_on, '%Y-%m-%d') AS borrowed_on, DATE_FORMAT(b.returned_on, '%Y-%m-%d') AS returned_on
        FROM borrowing_logs b JOIN students s ON s.student_id = b.student_id JOIN components c ON c.component_id = b.component_id
        ORDER BY b.borrowed_on DESC`);
      return send(response, 200, { borrowings: rows });
    }
    if (request.method === 'GET' && url.pathname === '/robot-lessons') {
      const rows = await query(`SELECT r.robot_lesson_id, r.student_id, s.student_name AS student, r.tutor_name AS Tutor,
        p.programme_name AS \`Programme Name\`, r.robot_name AS \`Robot Name\`, r.current_level AS \`Current Level\`,
        DATE_FORMAT(r.lesson_date, '%Y-%m-%d') AS \`Lesson Date\`, r.robot_status AS \`Robot Status\`, r.attendance AS Attendance,
        r.comment AS Comment, r.remarks AS Remarks FROM robot_lessons r
        JOIN students s ON s.student_id = r.student_id JOIN programmes p ON p.programme_id = r.programme_id
        ORDER BY r.lesson_date DESC`);
      return send(response, 200, { lessons: rows });
    }
    if (request.method === 'GET' && url.pathname === '/coding-lessons') {
      const rows = await query(`SELECT c.coding_lesson_id, c.student_id, s.student_name AS student, c.tutor_name AS Tutor,
        p.programme_name AS Programme, DATE_FORMAT(c.lesson_date, '%Y-%m-%d') AS \`Lesson Date\`, c.attendance AS Attendance,
        c.starting_level AS \`Starting Level\`, c.ending_level AS \`Ending Level\`, c.topic AS Topic, c.comment AS Comment, c.remarks AS Remarks
        FROM coding_lessons c JOIN students s ON s.student_id = c.student_id JOIN programmes p ON p.programme_id = c.programme_id
        ORDER BY c.lesson_date DESC`);
      return send(response, 200, { lessons: rows });
    }
    const studentRobotProgressMatch = url.pathname.match(/^\/students\/([^/]+)\/robot-progress$/);
    if (request.method === 'GET' && studentRobotProgressMatch) {
      const rows = await query(`SELECT p.student_robot_progress_id, p.student_id, p.programme_id, p.robot_name, p.sequence_number,
        p.status, p.notes FROM student_robot_progress p WHERE p.student_id = ? ORDER BY p.sequence_number`, [decodeURIComponent(studentRobotProgressMatch[1])]);
      return send(response, 200, { progress: rows });
    }
    const studentTopicProgressMatch = url.pathname.match(/^\/students\/([^/]+)\/topic-progress$/);
    if (request.method === 'GET' && studentTopicProgressMatch) {
      const rows = await query(`SELECT p.student_topic_progress_id, p.student_id, p.programme_id, p.level_number, p.topic,
        p.status, p.notes FROM student_topic_progress p WHERE p.student_id = ? ORDER BY p.level_number`, [decodeURIComponent(studentTopicProgressMatch[1])]);
      return send(response, 200, { progress: rows });
    }
    const studentChecklistMatch = url.pathname.match(/^\/students\/([^/]+)\/checklist$/);
    if (request.method === 'GET' && studentChecklistMatch) {
      const rows = await query(`SELECT c.checklist_item_id, c.student_id, c.component_id, i.component_name AS Component,
        i.kit_id AS Kit, c.required_quantity AS requiredQty, c.student_quantity AS studentQty, c.status, c.notes,
        c.generated_for_programme_id FROM student_checklist_items c JOIN components i ON i.component_id = c.component_id
        WHERE c.student_id = ? ORDER BY i.kit_id, i.component_name`, [decodeURIComponent(studentChecklistMatch[1])]);
      return send(response, 200, { checklist: rows });
    }
    if (request.method === 'POST' && url.pathname === '/borrowings') {
      const body = await readJson(request);
      if (!body.student_id || !body.component_id) return send(response, 400, { detail: 'student_id and component_id are required' });
      const borrowingId = body.borrowing_id || identifier('BOR');
      await query('INSERT INTO borrowing_logs (borrowing_id, student_id, component_id, quantity, status, borrowed_on, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [borrowingId, body.student_id, body.component_id, Number(body.quantity || 1), body.status || 'Still borrowing', body.borrowed_on || new Date().toISOString().slice(0, 10), body.notes || null]);
      return send(response, 201, { borrowing_id: borrowingId });
    }
    const returnMatch = url.pathname.match(/^\/borrowings\/([^/]+)\/return$/);
    if (request.method === 'POST' && returnMatch) {
      const result = await query("UPDATE borrowing_logs SET status = 'Returned', returned_on = CURRENT_DATE WHERE borrowing_id = ?", [decodeURIComponent(returnMatch[1])]);
      return send(response, result.affectedRows ? 200 : 404, result.affectedRows ? { borrowing_id: decodeURIComponent(returnMatch[1]), status: 'Returned' } : { detail: 'Borrowing record not found' });
    }
    const historyMatch = url.pathname.match(/^\/students\/([^/]+)\/borrowings$/);
    if (request.method === 'GET' && historyMatch) {
      const rows = await query('SELECT borrowing_id, student_id, component_id, quantity, status, borrowed_on, returned_on FROM borrowing_logs WHERE student_id = ? ORDER BY borrowed_on DESC', [decodeURIComponent(historyMatch[1])]);
      return send(response, 200, { borrowings: rows });
    }
    return send(response, 404, { detail: 'Not found' });
  } catch (error) { return databaseError(response, error); }
});

server.listen(port, '0.0.0.0', () => console.log(`icc-backend listening on ${port}`));
module.exports = server;
