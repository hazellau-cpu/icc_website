const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSheetsReadRouter, verifyReadToken } = require('./sheets-read-router');

const jwtSecret = 'j'.repeat(32);
const clientSecret = 'c'.repeat(32);

function makeResponse() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body ? JSON.parse(body) : null; },
  };
}

function makeRouter(query, readSpreadsheet = null) {
  return createSheetsReadRouter({
    query,
    jwtSecret,
    clientId: 'partner',
    clientSecret,
    allowedOrigins: ['https://partner.example'],
    readSpreadsheet,
  });
}

function signClaims(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function issueToken(router) {
  const response = makeResponse();
  await router.handle({ method: 'POST', headers: {} }, response, new URL('http://local/api/sheets/token'), async () => ({
    client_id: 'partner',
    client_secret: clientSecret,
  }));
  return { response, token: response.body.access_token };
}

test('issues a scoped, short-lived partner token and rejects tampering', async () => {
  const router = makeRouter(async () => []);
  const { response, token } = await issueToken(router);
  assert.equal(response.status, 200);
  assert.deepEqual(verifyReadToken(token, jwtSecret).scope, 'sheets:read');
  assert.equal(verifyReadToken(`${token}x`, jwtSecret), null);
});

test('returns the Students contract with string values and exact-origin CORS', async () => {
  const router = makeRouter(async () => [{
    student_id: 'ST001', student_name: 'Demo Student', course_type: 'Robot', paid_status: 'Paid',
    total_hours: 10, remaining_hours: 6, hours_completed: 4, new_bill_start: null, remarks: '', source_row_number: 2,
  }]);
  const { token } = await issueToken(router);
  const response = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}`, origin: 'https://partner.example' } }, response,
    new URL('http://local/api/sheets/students?student_id=ST001&student_name=Demo%20Student'), async () => ({}));
  assert.equal(response.status, 200);
  assert.equal(response.body.sheet_name, 'Students');
  assert.deepEqual(response.body.rows[0].values, ['ST001', 'Demo Student', 'Robot', 'Paid', '10', '6', '4', '', '']);
  assert.equal(response.body.pagination.total, 1);
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://partner.example');
});

test('returns the latest progress contract and preserves the source percentage', async () => {
  const router = makeRouter(async (sql) => sql.includes('FROM students WHERE')
    ? [{ student_id: 'ST001', student_name: 'Demo Student' }]
    : [{ row_number: 8, record_date: '2026-09-26', student_id: 'ST001', student_name: 'Demo Student', course_type: 'Robot', progress_percent: '60%' }]);
  const { token } = await issueToken(router);
  const response = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, response,
    new URL('http://local/api/sheets/progress/latest?student_id=ST001&student_name=Demo%20Student'), async () => ({}));
  assert.equal(response.status, 200);
  assert.equal(response.body.sheet_name, 'Progress_Log');
  assert.equal(response.body.rows[0].values.at(-1), '60%');
});

test('rejects bad credentials, invalid parameters, and mismatched students', async () => {
  const router = makeRouter(async () => []);
  const authResponse = makeResponse();
  await router.handle({ method: 'POST', headers: {} }, authResponse, new URL('http://local/api/sheets/token'), async () => ({ client_id: 'partner', client_secret: 'wrong' }));
  assert.equal(authResponse.status, 401);
  const { token } = await issueToken(router);
  const invalidResponse = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, invalidResponse,
    new URL('http://local/api/sheets/students?student_id=ST001&student_name=Wrong&limit=501'), async () => ({}));
  assert.equal(invalidResponse.status, 422);
  const missingResponse = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, missingResponse,
    new URL('http://local/api/sheets/students?student_id=ST001&student_name=Demo'), async () => ({}));
  assert.equal(missingResponse.status, 404);
});

test('denies valid tokens without sheets scope and rejects unapproved origins', async () => {
  let databaseCalled = false;
  const router = makeRouter(async () => { databaseCalled = true; return []; });
  const now = Math.floor(Date.now() / 1000);
  const token = signClaims({ iss: 'icc', aud: 'icc-sheets-read', sub: 'partner', scope: 'other:read', iat: now, exp: now + 60 });
  const response = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, response,
    new URL('http://local/api/sheets/students?student_id=ST001&student_name=Demo'), async () => ({}));
  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
  const optionsResponse = makeResponse();
  router.handleOptions({ headers: { origin: 'https://unapproved.example' } }, optionsResponse);
  assert.equal(optionsResponse.status, 403);
});

test('reads student and latest progress rows from the live template tabs', async () => {
  const dateSerial = (date) => (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
  const sheets = {
    students: [{
      row_number: 8,
      values: {
        'Student ID': 'ST001',
        Name: 'Demo Student',
        'Course type': 'ROBOKIT Lv1',
        'Paid Status': 'Paid',
        'Total Hours': 10,
        'Remaining Hours': 6,
        'Hours Completed': 4,
        'New Bill Start': dateSerial('2026-09-01'),
        Remarks: '',
      },
    }],
    progressLogs: [
      {
        sheet_name: 'Robot Progress Log',
        rows: [
          { row_number: 5, values: { Date: '2026-10-10', 'Student ID': 'ST001', Tutor: 'Hazel', 'Course Type': '', Comment: 'Earlier row', 'Robot Name': 'Caterpillar', 'Progress Status': 'In progress', Remarks: '', 'Start Time': '14:00', 'End Time': '16:00', 'Attendance Status': 'Present' } },
          { row_number: 6, values: { Date: '2026-10-10', 'Student ID': 'ST001', Tutor: 'James', 'Course Type': '', Comment: 'Latest robot row', 'Robot Name': 'Shooter', 'Progress Status': 'Finished', Remarks: 'Done', 'Start Time': '14:00', 'End Time': '16:00', 'Attendance Status': 'Present' } },
          { row_number: 7, values: { Date: '2026-10-10', 'Student ID': 'ST001', Tutor: 'Hazel', 'Course Type': '', Comment: 'Later lesson', 'Robot Name': 'Rover', 'Progress Status': 'In progress', Remarks: '', 'Start Time': '15:00', 'End Time': '16:00', 'Attendance Status': 'Present' } },
        ],
      },
      {
        sheet_name: 'Coding Progress Log',
        rows: [{ row_number: 3, values: { Date: '2026-11-01', 'Student ID': 'ST001', Tutor: 'Nigel', 'Course Type': '', 'Starting Level': 1, 'Ending Level': 2, Comment: 'Coding lesson', Progress: 'Loops', Remarks: '', 'Start Time': '2:00 PM', 'End Time': '4:00 PM', 'Attendance Status': 'Present' } }],
      },
      {
        sheet_name: 'Math Progress Log',
        rows: [{ row_number: 4, values: { Date: dateSerial('2026-11-01'), 'Student ID': 'ST001', Tutor: 'Hazel', 'Course Type': 'Math', Comment: 'Math lesson', Topic: 'Fractions', Remarks: '', 'Start Time': 0.5, 'End Time': 0.625, 'Attendance Status': 'Present' } }],
      },
    ],
  };
  const router = makeRouter(async () => { throw new Error('Database should not be queried for the live Sheets source'); }, async () => sheets);
  const { token } = await issueToken(router);

  const studentResponse = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, studentResponse,
    new URL('http://local/api/sheets/students?student_id=ST001&student_name=Demo%20Student'), async () => ({}));
  assert.equal(studentResponse.status, 200);
  assert.equal(studentResponse.body.rows[0].row_number, 8);
  assert.deepEqual(studentResponse.body.rows[0].values, ['ST001', 'Demo Student', 'ROBOKIT Lv1', 'Paid', '10', '6', '4', '2026-09-01', '']);

  sheets.students[0].values['New Bill Start'] = 'not yet start';
  const noteResponse = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, noteResponse,
    new URL('http://local/api/sheets/students?student_id=ST001&student_name=Demo%20Student'), async () => ({}));
  assert.equal(noteResponse.status, 200);
  assert.equal(noteResponse.body.rows[0].values[7], 'not yet start');

  const progressResponse = makeResponse();
  await router.handle({ method: 'GET', headers: { authorization: `Bearer ${token}` } }, progressResponse,
    new URL('http://local/api/sheets/progress/latest?student_id=ST001&student_name=Demo%20Student'), async () => ({}));
  assert.equal(progressResponse.status, 200);
  assert.equal(progressResponse.body.pagination.total, 3);
  const coding = progressResponse.body.rows.find((row) => row.values[7] === 'Coding');
  const math = progressResponse.body.rows.find((row) => row.values[7] === 'Math');
  const robot = progressResponse.body.rows.find((row) => row.values[7] === 'Robot');
  assert.equal(coding.values[10], 'Loops');
  assert.equal(coding.values[15], '1');
  assert.equal(coding.values[16], '2');
  assert.equal(math.values[10], 'Fractions');
  assert.equal(math.values[12], '12:00-15:00');
  assert.equal(robot.row_number, 7);
  assert.equal(robot.values[9], 'Later lesson');
  assert.equal(robot.values[13], 'Rover');
  assert.equal(robot.values[14], 'In progress');
  assert.equal(robot.values[17], '');
});