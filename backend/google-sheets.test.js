const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGoogleSheetsReader } = require('./google-sheets');

const STUDENTS_HEADERS = ['Student ID', 'Name', 'Course type', 'Paid Status', 'Total Hours', 'Remaining Hours', 'Hours Completed', 'New Bill Start', 'Remarks'];
const ROBOT_HEADERS = ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Robot Name', 'Progress Status', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'];
const CODING_HEADERS = ['Date', 'Student ID', 'Tutor', 'Course Type', 'Starting Level', 'Ending Level', 'Comment', 'Progress', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'];
const MATH_HEADERS = ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Topic', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'];

test('reads only the template data tabs using a cached read-only service token', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serviceAccountJson = JSON.stringify({
    client_email: 'sheets-reader@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  let tokenRequests = 0;
  let sheetsRequests = 0;
  const fetchImpl = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenRequests += 1;
      const form = new URLSearchParams(options.body);
      const assertion = form.get('assertion');
      const [header, payload, signature] = assertion.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url').toString()).scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
      assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
      return { ok: true, json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) };
    }

    sheetsRequests += 1;
    const requestUrl = new URL(url);
    assert.equal(requestUrl.pathname, '/v4/spreadsheets/sheet-id/values:batchGet');
    assert.deepEqual(requestUrl.searchParams.getAll('ranges'), [
      'Students!A:I',
      "'Robot Progress Log'!A:K",
      "'Coding Progress Log'!A:L",
      "'Math Progress Log'!A:J",
    ]);
    assert.equal(requestUrl.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    assert.equal(requestUrl.searchParams.get('dateTimeRenderOption'), 'SERIAL_NUMBER');
    assert.equal(options.headers.Authorization, 'Bearer test-access-token');
    return {
      ok: true,
      json: async () => ({
        valueRanges: [STUDENTS_HEADERS, ROBOT_HEADERS, CODING_HEADERS, MATH_HEADERS].map((headers) => ({ values: [headers] })),
      }),
    };
  };
  const readSpreadsheet = createGoogleSheetsReader({
    spreadsheetId: 'sheet-id',
    serviceAccountJson,
    fetchImpl,
  });

  const firstRead = await readSpreadsheet();
  const secondRead = await readSpreadsheet();
  assert.deepEqual(firstRead, { students: [], progressLogs: [
    { sheet_name: 'Robot Progress Log', rows: [] },
    { sheet_name: 'Coding Progress Log', rows: [] },
    { sheet_name: 'Math Progress Log', rows: [] },
  ] });
  assert.deepEqual(secondRead, firstRead);
  assert.equal(tokenRequests, 1);
  assert.equal(sheetsRequests, 2);
});

test('rejects a template tab with missing required headers', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fetchImpl = async (url) => url === 'https://oauth2.googleapis.com/token'
    ? { ok: true, json: async () => ({ access_token: 'test-access-token', expires_in: 3600 }) }
    : {
      ok: true,
      json: async () => ({
        valueRanges: [
          { values: [['Student ID', 'Name']] },
          { values: [ROBOT_HEADERS] },
          { values: [CODING_HEADERS] },
          { values: [MATH_HEADERS] },
        ],
      }),
    };
  const readSpreadsheet = createGoogleSheetsReader({
    spreadsheetId: 'sheet-id',
    serviceAccountJson: JSON.stringify({
      client_email: 'reader@example.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }),
    fetchImpl,
  });
  await assert.rejects(readSpreadsheet(), /Students.*missing required columns/);
});
