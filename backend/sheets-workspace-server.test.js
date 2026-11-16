const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sheets = require('./google-sheets');
const { WorkspaceConflictError } = require('./sheets-workspace-store');

test('protected Sheets-mode bootstrap and writes work without a database', async (t) => {
  const env = {
    PORT: '0', K_SERVICE: 'test-service', IAP_AUDIENCE: 'test-audience',
    WORKSPACE_STORAGE: 'sheets', DASHBOARD_SPREADSHEET_ID: 'dashboard',
    DASHBOARD_SINGLE_WRITER: 'true', SHEETS_READ_SOURCE: 'google',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'source', STARTER_SHEET_SPREADSHEET_ID: '',
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const libraries = {
    robotPrograms: [{ programme_id: 'P1', programme_name: 'AIKIRO Lv1' }],
    curriculum: [{ Item: 'Lesson' }],
    robots: [{ 'Programme ID': 'P1', 'Programme Name': 'AIKIRO Lv1', 'Robot name': 'Robot Dancer', Sequence: 1 }],
    componentLibrary: [{ Component: 'Wheel' }],
    inventory: [{ 'Component ID': 'C1', Component: 'Wheel', Kit: 'AIKIRO', 'Lv1 total': 1 }],
  };
  const data = {
    students: [{ values: { 'Student ID': 'A', Name: 'Student A', 'Course type': 'AIKIRO', 'Paid Status': 'Paid' } }],
    progressLogs: ['Robot', 'Coding', 'Math'].map((type) => ({ sheet_name: `${type} Progress Log`, rows: [] })),
  };
  let edits = {};
  const store = {
    async read() { return { libraries, edits: structuredClone(edits) }; },
    async update(key, value, version) {
      if ((edits[key]?.version || 0) !== version) throw new WorkspaceConflictError();
      edits[key] = { value: structuredClone(value), version: version + 1 };
      return { key, version: version + 1 };
    },
  };
  let databaseCalls = 0;
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.endsWith('/backend/server.js')) {
      if (request === './db') return { query: async () => { databaseCalls += 1; throw new Error('Database should not be used'); }, transaction: async () => { databaseCalls += 1; throw new Error('Database should not be used'); } };
      if (request === './iap-auth') return { createIapAuthenticator: () => async (assertion) => assertion === 'valid' ? { sub: 'test', email: 'editor@example.test' } : null };
      if (request === './google-sheets') return { ...sheets, createGoogleSheetsReader: () => async () => data };
      if (request === './sheets-workspace-store') return { createSheetsWorkspaceStore: () => store };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let server;
  try { server = require('./server'); } finally { Module._load = originalLoad; }
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const protectedHeaders = { 'x-goog-iap-jwt-assertion': 'valid' };
  assert.equal((await fetch(`${base}/workspace/bootstrap`)).status, 401);
  const initial = await fetch(`${base}/workspace/bootstrap`, { headers: protectedHeaders });
  assert.equal(initial.status, 200);
  const workspace = await initial.json();
  assert.equal(workspace.storageMode, 'sheets');
  assert.equal(workspace.robotStudents[0].studentId, 'A');
  const write = await fetch(`${base}/workspace/edits/daily-lesson-drafts`, {
    method: 'PUT', headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: 0, value: [{ note: 'example' }] }),
  });
  assert.equal(write.status, 200);
  const reload = await (await fetch(`${base}/workspace/bootstrap`, { headers: protectedHeaders })).json();
  assert.deepEqual(reload.sharedEdits['daily-lesson-drafts'].value, [{ note: 'example' }]);
  assert.equal(databaseCalls, 0);
});
