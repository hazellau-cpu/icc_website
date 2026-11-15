const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleSheetsReader, sheetsForWorkspace } = require('./google-sheets');

const STUDENTS_HEADERS = ['Student ID', 'Name', 'Course type', 'Paid Status', 'Total Hours', 'Remaining Hours', 'Hours Completed', 'New Bill Start', 'Remarks'];
const ROBOT_HEADERS = ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Robot Name', 'Progress Status', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'];
const CODING_HEADERS = ['Date', 'Student ID', 'Tutor', 'Course Type', 'Starting Level', 'Ending Level', 'Comment', 'Progress', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'];
const MATH_HEADERS = ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Topic', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'];

test('reads only the template data tabs using a cached read-only service token', async () => {
  let credentialRequests = 0;
  let sheetsRequests = 0;
  const fetchImpl = async (url, options) => {
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
    authClientProvider: async () => {
      credentialRequests += 1;
      return { getAccessToken: async () => ({ token: 'test-access-token' }) };
    },
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
  assert.equal(credentialRequests, 1);
  assert.equal(sheetsRequests, 2);
});

test('rejects a template tab with missing required headers', async () => {
  const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        valueRanges: [
          { values: [['Student ID', 'Name']] },
          { values: [ROBOT_HEADERS] },
          { values: [CODING_HEADERS] },
          { values: [MATH_HEADERS] },
        ],
      }),
    });
  const readSpreadsheet = createGoogleSheetsReader({
    spreadsheetId: 'sheet-id',
    authClientProvider: async () => ({ getAccessToken: async () => ({ token: 'test-access-token' }) }),
    fetchImpl,
  });
  await assert.rejects(readSpreadsheet(), /Students.*missing required columns/);
});

test('preserves textual billing notes while converting Sheet date and time values', () => {
  const dateSerial = (Date.parse('2026-11-14T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000;
  const result = sheetsForWorkspace({
    students: [
      { values: { 'New Bill Start': 'not yet start' } },
      { values: { 'New Bill Start': dateSerial } },
    ],
    progressLogs: [{ sheet_name: 'Robot Progress Log', rows: [{ values: { Date: dateSerial, 'Start Time': 0.5, 'End Time': 0.625 } }] }],
  });
  assert.equal(result.Students[0]['New Bill Start'], 'not yet start');
  assert.equal(result.Students[1]['New Bill Start'], '2026-11-14');
  assert.deepEqual(result['Robot Progress Log'][0], { Date: '2026-11-14', 'Start Time': '12:00', 'End Time': '15:00' });
});
