const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const sheets = require('./google-sheets');
const { WorkspaceConflictError } = require('./sheets-workspace-store');

for (const configured of [true, false]) test(`protected Sheets-mode bootstrap works ${configured ? 'with' : 'without'} a starter Sheet`, async (t) => {
  const env = {
    PORT: '0', K_SERVICE: 'test-service', IAP_AUDIENCE: 'test-audience',
    WORKSPACE_STORAGE: 'sheets', DASHBOARD_SPREADSHEET_ID: 'dashboard',
    DASHBOARD_SINGLE_WRITER: 'true', SHEETS_READ_SOURCE: 'google',
    GOOGLE_SHEETS_SPREADSHEET_ID: 'source', STARTER_SHEET_SPREADSHEET_ID: configured ? 'starter' : '',
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
      if (request === './starter-demographics') return { readStarterSheet: async () => ({
        demographics: [{ studentId: 'A', yearOfBirth: '2020' }],
        robotHistory: [{ studentId: 'A', programme: 'AIKIRO Lv1', robot: 'Robot Dancer', status: 'Finished' }],
      }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let server;
  try { server = require('./server'); } finally { Module._load = originalLoad; }
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[require.resolve('./server')];
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
  if (configured) {
    assert.equal(workspace.robotStudents[0].yob, '2020');
    assert.deepEqual(workspace.starterRobotHistory, [{ studentId: 'A', programme: 'AIKIRO Lv1', robot: 'Robot Dancer', status: 'Finished' }]);
    assert.equal(workspace.robotStudents[0].program, 'AIKIRO Lv1');
    assert.equal(workspace.robotProgress[0].Status, 'Done');
    const review = await fetch(`${base}/robot-progress/preview`, {
      method: 'POST', headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 'A', robot_name: 'Robot Dancer', status: 'Finished' }),
    });
    assert.equal(review.status, 409);
    const pathwayEdit = await fetch(`${base}/workspace/edits/student-pathways`, {
      method: 'PUT', headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_version: 0, value: [{ courseType: 'Robot', studentId: 'A', programme: 'AIKIRO Lv2', startedOn: null, history: [] }] }),
    });
    assert.equal(pathwayEdit.status, 409);
    const codingPathway = await fetch(`${base}/workspace/edits/student-pathways`, {
      method: 'PUT', headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_version: 0, value: [{ courseType: 'Coding', studentId: 'A', programme: 'CS1', startedOn: null, history: [] }] }),
    });
    assert.equal(codingPathway.status, 200);
  } else {
    assert.equal(workspace.starterRobotHistory, undefined);
  }
  const write = await fetch(`${base}/workspace/edits/daily-lesson-drafts`, {
    method: 'PUT', headers: { ...protectedHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_version: 0, value: [{ note: 'example' }] }),
  });
  assert.equal(write.status, 200);
  const reload = await (await fetch(`${base}/workspace/bootstrap`, { headers: protectedHeaders })).json();
  assert.deepEqual(reload.sharedEdits['daily-lesson-drafts'].value, [{ note: 'example' }]);
  assert.equal(databaseCalls, 0);
});
