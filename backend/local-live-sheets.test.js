const test = require('node:test');
const assert = require('node:assert/strict');
const { merge, preserveIncludedRobotStudents, filterRecordsFromDate } = require('../local-live-sheets');

function data() {
  return {
    Students: [
      { 'Student ID': 'A', Name: 'Student A', 'Course type': 'AIKIRO', 'Paid Status': 'Paid' },
      { 'Student ID': 'B', Name: 'Student B', 'Course type': 'CS1', 'Paid Status': 'Paid' },
      { 'Student ID': 'C', Name: 'Student C', 'Course type': 'Math', 'Paid Status': 'Unpaid' },
    ],
    'Robot Progress Log': [
      { 'Student ID': 'A', Date: '2026-01-01', 'Robot Name': 'Cannon Bot', 'Progress Status': 'finished' },
      { 'Student ID': 'C', Date: '2026-01-01', 'Robot Name': 'Other', 'Progress Status': 'finished' },
      { 'Student ID': 'A', Date: '2026-01-02', 'Robot Name': 'Unknown', 'Progress Status': 'finished' },
    ],
    'Coding Progress Log': [
      { 'Student ID': 'B', Date: '2026-01-01', 'Ending Level': 4 },
      { 'Student ID': 'B', Date: '2026-01-02', 'Ending Level': 7 },
    ],
    'Math Progress Log': [],
  };
}
function state() {
  return {
    robotStudents: [{ studentId: 'A', name: 'Student A', program: 'AIKIRO Lv1', sourceRow: {} }],
    codingStudents: [], mathStudents: [],
    robotProgress: [{ studentId: 'A', Robot: 'CannoBot', Status: 'Not started' }],
  };
}

test('filters dated history from an inclusive start date while preserving undated records', () => {
  const rows = [
    { date: '2026-11-10' },
    { date: '2026-11-11' },
    { sourceRow: { 'Lesson Date': '2026-11-12' } },
    { status: 'Done' },
  ];
  assert.deepEqual(filterRecordsFromDate(rows, '2026-11-11', (row) => row.date || row.sourceRow?.['Lesson Date']), rows.slice(1));
  assert.deepEqual(filterRecordsFromDate(rows, '2026-11-11', (row) => row.date || row.sourceRow?.['Lesson Date'], { keepUndated: false }), rows.slice(1, 3));
  assert.throws(() => filterRecordsFromDate(rows, '2026-02-30', (row) => row.date), /valid start date/);
});

test('merges paid roster and live lessons without mutating starter progress', () => {
  const baseline = state();
  const result = merge(baseline, data());
  assert.equal(result.robotStudents[0].program, 'AIKIRO Lv1');
  assert.equal(result.codingStudents[0].sourceRow["Today's Finished Level"], 7);
  assert.equal(result.robotProgress[0].Status, 'Done');
  assert.equal(baseline.robotProgress[0].Status, 'Not started');
  assert.equal(result.robotLessons.length, 2);
  assert.deepEqual(result.warnings, { unmatchedStudents: 1, unmatchedLogs: 1, unmatchedRobots: 1 });
  assert.deepEqual(result.warningDetails.students, [{ studentId: 'B', name: 'Student B', course: 'CS1' }]);
  assert.deepEqual(result.warningDetails.lessons, [{
    date: '2026-01-01', studentId: 'C', name: 'Student C', course: 'Robot',
    robot: 'Other', status: 'finished', reason: 'No paid Robot student matches this ID.',
  }]);
  assert.deepEqual(result.warningDetails.robots, [{
    date: '2026-01-02', studentId: 'A', name: 'Student A',
    robot: 'Unknown', status: 'finished', reason: 'No matching robot progress record',
  }]);
});

test('includes an explicitly retained unpaid robot student without changing payment status', () => {
  const baseline = state();
  baseline.robotStudents[0].includeWhenUnpaid = true;
  const sheets = data();
  sheets.Students[0]['Paid Status'] = 'Unpaid';
  const result = merge(baseline, sheets);
  assert.equal(result.robotStudents.length, 1);
  assert.equal(result.robotStudents[0].paidStatus, 'Unpaid');
  assert.equal(result.robotProgress[0].Status, 'Done');
  assert.equal(result.robotLessons.length, 2);
  assert.equal(result.robotStudents.some((student) => student.studentId === 'C'), false);

  baseline.robotStudents[0].includeWhenUnpaid = false;
  assert.equal(merge(baseline, sheets).robotStudents.length, 0);
});

test('restores explicitly included students omitted by a saved browser roster', () => {
  const included = { studentId: 'local-A', name: 'Student A', includeWhenUnpaid: true };
  const roster = [included, { studentId: 'B', name: 'Student B' }];
  assert.deepEqual(preserveIncludedRobotStudents(roster, [{ studentId: 'B', name: 'Edited B' }]), [
    { studentId: 'B', name: 'Edited B' }, included,
  ]);
  assert.deepEqual(preserveIncludedRobotStudents(roster, [{ studentId: 'local-A', name: 'Edited A' }]), [
    { studentId: 'local-A', name: 'Edited A', includeWhenUnpaid: true },
  ]);
  assert.throws(() => preserveIncludedRobotStudents([included, { ...included }], []), /unique student IDs/);
});

test('preserves older robot progress when later lessons belong to a new pathway', () => {
  const sheets = data();
  sheets['Robot Progress Log'] = [
    { 'Student ID': 'A', Date: '2026-01-01', 'Robot Name': 'Cannon Bot', 'Progress Status': 'in progress' },
    { 'Student ID': 'A', Date: '2026-01-02', 'Robot Name': 'Cannon Bot', 'Progress Status': 'finished' },
  ];
  const result = merge(state(), sheets, {
    includeRobotProgressUpdate: (_, row) => row.Date <= '2026-01-01',
  });
  assert.equal(result.robotProgress[0].Status, 'In progress');
  assert.equal(result.robotLessons.length, 2);
});

test('rejects duplicate paid IDs within a course', () => {
  const sheets = data();
  sheets.Students.push({ ...sheets.Students[0] });
  assert.throws(() => merge(state(), sheets), /duplicate paid student IDs/);
});

test('merges CodeCombat students and coding lessons without changing their programme', () => {
  const sheets = data();
  sheets.Students[1]['Course type'] = 'CodeCombat';
  const result = merge(state(), sheets);
  assert.equal(result.codingStudents[0].course, 'CodeCombat');
  assert.equal(result.codingStudents[0].studentType, 'Coding');
  assert.equal(result.codingStudents[0].sourceRow["Today's Finished Level"], 7);
  assert.equal(result.codingLessons.length, 2);
  sheets.Students[1]['Course type'] = 'Code Combat';
  assert.equal(merge(state(), sheets).codingStudents[0].course, 'Code Combat');
  sheets.Students[1]['Course type'] = 'Unknown course';
  assert.throws(() => merge(state(), sheets), /unsupported course/);
});

test('merges Code Academy students and coding lessons as Coding', () => {
  const sheets = data();
  sheets.Students[1]['Course type'] = 'Code Academy';
  sheets['Coding Progress Log'][0]['Course Type'] = 'Code Academy';
  const result = merge(state(), sheets);
  assert.equal(result.codingStudents[0].course, 'Code Academy');
  assert.equal(result.codingStudents[0].studentType, 'Coding');
  assert.equal(result.codingLessons.length, 2);
});

test('preserves local progress links when James IDs differ from original IDs', () => {
  const baseline = state();
  baseline.robotStudents[0].studentId = 'local-A';
  baseline.robotStudents[0].jamesStudentId = 'A';
  baseline.robotProgress[0].studentId = 'local-A';
  const result = merge(baseline, data());
  assert.equal(result.robotStudents[0].studentId, 'local-A');
  assert.equal(result.robotStudents[0].jamesStudentId, 'A');
  assert.equal(result.robotProgress[0].Status, 'Done');
});

test('matches robot names across capitalization and spacing without guessing between duplicates', () => {
  const baseline = state();
  baseline.robotProgress = [{ studentId: 'A', Robot: 'Soccer Bot', Status: 'Not started' }];
  const sheets = data();
  sheets['Robot Progress Log'] = [{ 'Student ID': 'A', Date: '2026-01-01', 'Robot Name': 'Soccerbot', 'Progress Status': 'finished' }];
  const result = merge(baseline, sheets);
  assert.equal(result.robotProgress[0].Status, 'Done');
  assert.equal(result.warnings.unmatchedRobots, 0);

  baseline.robotProgress.push({ studentId: 'A', Robot: 'SoccerBot', Status: 'Not started' });
  const ambiguous = merge(baseline, sheets);
  assert.equal(ambiguous.warnings.unmatchedRobots, 1);
  assert.equal(ambiguous.warningDetails.robots[0].reason, 'Multiple matching robot progress records');
  assert.deepEqual(ambiguous.robotProgress.map((row) => row.Status), ['Not started', 'Not started']);
});

test('matches GunBot and CannoBot only for ROBOKIT Lv3', () => {
  const baseline = state();
  baseline.robotStudents[0].program = 'ROBOKIT Lv3';
  baseline.robotProgress = [{ studentId: 'A', Robot: 'CannoBot', Status: 'Not started' }];
  const sheets = data();
  sheets['Robot Progress Log'] = [{ 'Student ID': 'A', Date: '2026-01-01', 'Robot Name': 'GunBot', 'Progress Status': 'in progress' }];
  const matched = merge(baseline, sheets);
  assert.equal(matched.robotProgress[0].Status, 'In progress');
  baseline.robotStudents[0].program = 'ROBOKIT Lv2';
  const otherProgramme = merge(baseline, sheets);
  assert.equal(otherProgramme.robotProgress[0].Status, 'Not started');
  assert.equal(otherProgramme.warnings.unmatchedRobots, 1);
});

test('matches Wrestler lessons to Fighter progress only for AIKIRO Lv1 additional', () => {
  const baseline = state();
  baseline.robotStudents[0].program = 'AIKIRO Lv1 additional';
  baseline.robotProgress = [{ studentId: 'A', Robot: 'Robot Fighter', Status: 'Not started' }];
  const sheets = data();
  sheets['Robot Progress Log'] = [{ 'Student ID': 'A', Date: '2026-01-01', 'Robot Name': 'Robot Wrestler', 'Progress Status': 'finished' }];
  assert.equal(merge(baseline, sheets).robotProgress[0].Status, 'Done');
  baseline.robotStudents[0].program = 'AIKIRO Lv1 original';
  const otherProgramme = merge(baseline, sheets);
  assert.equal(otherProgramme.robotProgress[0].Status, 'Not started');
  assert.equal(otherProgramme.warnings.unmatchedRobots, 1);
});

test('accounts for older lessons covered by a student-specific robot review', () => {
  const baseline = state();
  baseline.robotStudents[0].program = 'ROBOKIT Lv4';
  baseline.robotProgress = [];
  baseline.robotProgressReviews = [{
    studentId: 'A', programme: 'ROBOKIT Lv4', robot: 'DiceBot', displayRobot: 'DiveBot',
    status: 'Done', reviewedOn: '2026-01-02',
  }];
  const sheets = data();
  sheets['Robot Progress Log'] = [{ 'Student ID': 'A', Date: '2026-01-01', 'Robot Name': 'Dive Bot', 'Progress Status': 'finished' }];
  const options = { reviewMatchesCurrentRobot: () => true };
  const result = merge(baseline, sheets, options);
  assert.equal(result.warnings.unmatchedRobots, 0);
  assert.equal(result.robotLessons.length, 1);
  assert.deepEqual(result.robotProgress, []);
  assert.equal(merge(baseline, sheets).warnings.unmatchedRobots, 1);

  sheets['Robot Progress Log'][0].Date = '2026-01-03';
  assert.equal(merge(baseline, sheets, options).warnings.unmatchedRobots, 1);
  sheets['Robot Progress Log'][0].Date = '2026-01-01';
  sheets['Robot Progress Log'][0]['Progress Status'] = 'unknown';
  assert.equal(merge(baseline, sheets, options).warnings.unmatchedRobots, 1);
  sheets['Robot Progress Log'][0]['Progress Status'] = 'finished';
  baseline.robotProgressReviews[0].status = 'Unknown';
  assert.equal(merge(baseline, sheets, options).warnings.unmatchedRobots, 1);
  baseline.robotProgressReviews[0].status = 'Done';
  baseline.robotProgressReviews[0].studentId = 'other';
  assert.equal(merge(baseline, sheets, options).warnings.unmatchedRobots, 1);
  baseline.robotProgressReviews[0].studentId = 'A';
  baseline.robotProgressReviews[0].programme = 'ROBOKIT Lv3';
  assert.equal(merge(baseline, sheets, options).warnings.unmatchedRobots, 1);
});

test('reports unrecognized robot statuses and avoids guessing ambiguous student names', () => {
  const sheets = data();
  sheets.Students.push({ ...sheets.Students[2], Name: 'Another Student C' });
  sheets['Robot Progress Log'].push({ 'Student ID': 'A', Date: '2026-01-03', 'Robot Name': 'Cannon Bot', 'Progress Status': 'maybe' });
  const result = merge(state(), sheets);
  assert.equal(result.warningDetails.lessons[0].name, '');
  assert.equal(result.warningDetails.robots.at(-1).reason, 'Unrecognized progress status');
});

test('links older progress without IDs only through an unambiguous existing student name', () => {
  const baseline = state();
  baseline.robotStudents[0].studentId = 'local-A';
  baseline.robotStudents[0].jamesStudentId = 'A';
  baseline.robotProgress[0] = { Student: 'Student A', Robot: 'CannoBot', Status: 'Not started' };
  assert.equal(merge(baseline, data()).robotProgress[0].Status, 'Done');
  baseline.robotStudents.push({ studentId: 'other', name: 'Student A' });
  const result = merge(baseline, data());
  assert.equal(result.robotProgress[0].Status, 'Not started');
  assert.equal(result.warnings.unmatchedRobots, 2);
});
