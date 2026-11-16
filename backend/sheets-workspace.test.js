const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspace, createSheetsWorkspaceRouter } = require('./sheets-workspace');
const { WorkspaceConflictError } = require('./sheets-workspace-store');
const { createJamesRouter } = require('./james-router');

const libraries = {
  robotPrograms: [{ programme_id: 'AIK1', programme_name: 'AIKIRO Lv1', Program: 'AIKIRO Lv1' }],
  curriculum: [{ Item: 'Lesson', Level: 1 }],
  robots: [{ 'Programme Name': 'AIKIRO Lv1', 'Programme ID': 'AIK1', 'Robot name': 'Robot Dancer', Sequence: 1, Level: 1 }],
  componentLibrary: [{ Component: 'Wheel', Kit: 'AIKIRO' }],
  inventory: [{ 'Component ID': 'C1', Component: 'Wheel', Kit: 'AIKIRO', 'Lv1 total': 2 }],
};
const sheetData = {
  students: [
    { values: { 'Student ID': 'A', Name: 'Student A', 'Course type': 'AIKIRO', 'Paid Status': 'Payment Due' } },
    { values: { 'Student ID': 'B', Name: 'Student B', 'Course type': 'Math', 'Paid Status': 'Inactive' } },
  ],
  progressLogs: [
    { sheet_name: 'Robot Progress Log', rows: [{ values: { 'Student ID': 'A', Date: '2026-01-02', 'Robot Name': 'Dancerbot', 'Progress Status': 'Finished' } }] },
    { sheet_name: 'Coding Progress Log', rows: [] },
    { sheet_name: 'Math Progress Log', rows: [] },
  ],
};
const path = { courseType: 'Robot', studentId: 'A', programme: 'AIKIRO Lv1', startedOn: null, history: [] };

function fixture() {
  let edits = { 'student-pathways': { value: [path], version: 1 } };
  const store = {
    async read() { return { libraries, edits: structuredClone(edits) }; },
    async update(key, value, version) {
      if ((edits[key]?.version || 0) !== version) throw new WorkspaceConflictError();
      edits[key] = { value: structuredClone(value), version: version + 1 };
      return { key, version: version + 1 };
    },
  };
  const router = createSheetsWorkspaceRouter({ store, readSpreadsheet: async () => sheetData });
  async function call(method, route, body) {
    let response;
    const handled = await router.handle(
      { method, authenticatedUser: { email: 'editor@example.test' } }, {},
      new URL(route, 'http://example.test'), async () => body,
      (_, status, value) => { response = { status, value }; },
    );
    return { handled, ...response };
  }
  return { router, call };
}

test('builds a Sheet-backed workspace with libraries, pathway and live progress', () => {
  const result = buildWorkspace(libraries, { 'student-pathways': { value: [path], version: 1 } }, sheetData);
  assert.equal(result.robotStudents.length, 1);
  assert.equal(result.mathStudents.length, 0);
  assert.equal(result.robotStudents[0].program, 'AIKIRO Lv1');
  assert.equal(result.robotProgress[0].Status, 'Done');
  assert.equal(result.componentItems[0].requiredQty, '2');
  assert.equal(result.inventory[0]['Total center qty'], '');
});

test('keeps earlier lessons out of a newly changed pathway', () => {
  const changed = { ...path, startedOn: '2026-01-03' };
  const result = buildWorkspace(libraries, { 'student-pathways': { value: [changed], version: 1 } }, sheetData);
  assert.equal(result.robotProgress[0].Status, 'Not started');
  assert.equal(result.robotLessons.length, 1);
});

test('marks progress unknown when no Sheet lesson confirms it', () => {
  const noLessons = structuredClone(sheetData);
  noLessons.progressLogs[0].rows = [];
  const result = buildWorkspace(libraries, { 'student-pathways': { value: [path], version: 1 } }, noLessons);
  assert.equal(result.robotProgress[0].Status, 'Unknown');
});

test('persists shared edits, inventory and borrowing returns', async () => {
  const { call, router } = fixture();
  assert.equal((await call('PUT', '/workspace/edits/daily-lesson-drafts', { expected_version: 0, value: [{ note: 'test' }] })).status, 200);
  assert.equal((await call('PATCH', '/centre-inventory/INV-C1', { 'Total center qty': 3 })).value['Total center qty'], 3);
  const created = await call('POST', '/borrowings', {
    borrower: 'Student A', item: 'Wheel', sourceRow: { Kit: 'AIKIRO', Quantity: '1', 'Borrowed on': '2026-01-01' },
  });
  assert.equal(created.status, 201);
  const returned = await call('POST', `/borrowings/${created.value.borrowing_id}/return`, { returned_on: '2026-01-05' });
  assert.equal(returned.value.sourceRow['Returned on'], '2026-01-05');
  const workspace = await router.bootstrap();
  assert.equal(workspace.inventory[0]['Total center qty'], 3);
  assert.equal(workspace.borrowings[0].status, 'Returned');
  assert.equal(workspace.sharedEdits['daily-lesson-drafts'].value[0].note, 'test');
});

test('rejects invalid borrowing and stale workspace edits', async () => {
  const { call } = fixture();
  await assert.rejects(call('POST', '/borrowings', { borrower: 'Student A', item: 'Wheel', sourceRow: { Kit: 'AIKIRO', Quantity: '0' } }), /positive quantity/);
  await assert.rejects(call('PUT', '/workspace/edits/student-pathways', { expected_version: 0, value: [path] }), WorkspaceConflictError);
});

test('preserves accepted robot reviews and lets later lessons take precedence', () => {
  const review = { studentId: 'A', programme: 'AIKIRO Lv1', robot: 'Robot Dancer', status: 'In progress',
    reviewedOn: '2026-01-03', acceptedAt: '2026-01-03T01:00:00Z' };
  const edits = { 'student-pathways': { value: [path], version: 1 }, 'robot-progress-reviews': { value: [review], version: 1 } };
  assert.equal(buildWorkspace(libraries, edits, sheetData).robotProgress[0].Status, 'In progress');
  const later = structuredClone(sheetData);
  later.progressLogs[0].rows[0].values.Date = '2026-01-04';
  assert.equal(buildWorkspace(libraries, edits, later).robotProgress[0].Status, 'Done');
});

test('does not apply an old review to a restarted pathway', () => {
  const review = { studentId: 'A', programme: 'AIKIRO Lv1', robot: 'Robot Dancer', status: 'Done',
    reviewedOn: '2026-01-03', acceptedAt: '2026-01-03T01:00:00Z' };
  const edits = { 'student-pathways': { value: [{ ...path, startedOn: '2026-01-04' }], version: 1 },
    'robot-progress-reviews': { value: [review], version: 1 } };
  const result = buildWorkspace(libraries, edits, sheetData);
  assert.equal(result.robotProgress[0].Status, 'Not started');
  assert.deepEqual(result.robotProgressReviews, []);
});

test('James review stores an accepted result in Sheets workspace', async () => {
  const { router } = fixture();
  const james = createJamesRouter({ storage: router.jamesStorage, jwtSecret: 'a'.repeat(32) });
  let response;
  const send = (_, status, value) => { response = { status, value }; };
  const request = { method: 'POST', headers: {}, authenticatedUser: { email: 'editor@example.test' } };
  await james.handle(request, {}, new URL('/robot-progress/preview', 'http://example.test'),
    async () => ({ student_id: 'A', robot_name: 'Robot Dancer', status: 'In progress' }), send);
  assert.equal(response.value.accepted, true);
  const token = response.value.approval_token;
  await james.handle(request, {}, new URL('/robot-progress/accept', 'http://example.test'),
    async () => ({ approval_token: token }), send);
  assert.equal(response.value.accepted, true);
  const workspace = await router.bootstrap();
  assert.equal(workspace.robotProgress[0].Status, 'In progress');
});
