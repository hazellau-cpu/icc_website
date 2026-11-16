const test = require('node:test');
const assert = require('node:assert/strict');
const pathways = require('../local-pathways');

function storage(initial = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_, next) => { value = next; },
  };
}

test('pathway changes preserve history and separate course types with the same student ID', () => {
  const store = storage();
  let records = pathways.read(store);
  records = pathways.update(records, { courseType: 'Robot', studentId: 'st01', programme: 'AIKIRO Lv2 original', previousProgramme: 'AIKIRO Lv1_original', date: '2026-11-13' });
  records = pathways.update(records, { courseType: 'Math', studentId: 'ST01', programme: 'Math Level 2', previousProgramme: 'Math', date: '2026-11-13' });
  pathways.write(store, records);
  records = pathways.read(store);
  const robot = pathways.find(records, 'Robot', 'ST01');
  assert.equal(robot.programme, 'AIKIRO Lv2 original');
  assert.equal(robot.startedOn, '2026-11-13');
  assert.deepEqual(robot.history, [{ programme: 'AIKIRO Lv1_original', endedOn: '2026-11-13' }]);
  assert.equal(pathways.find(records, 'Math', 'st01').programme, 'Math Level 2');
  assert.equal(pathways.afterPathwayChange('2026-11-13', robot), false);
  assert.equal(pathways.afterPathwayChange('2026-11-14', robot), true);
  assert.equal(pathways.afterPathwayChange('', robot), false);
});

test('confirming the current programme does not reset progress', () => {
  let records = pathways.update([], { courseType: 'Robot', studentId: 'ST1', programme: 'AIKIRO Lv1 original', previousProgramme: 'AIKIRO Lv1_original', date: '2026-11-13' });
  assert.equal(records[0].startedOn, null);
  records = pathways.update(records, { courseType: 'Robot', studentId: 'ST1', programme: 'AIKIRO Lv2 original', previousProgramme: '', date: '2026-11-14' });
  assert.equal(records[0].startedOn, '2026-11-14');
  assert.equal(records[0].history.length, 1);
});

test('invalid saved data and invalid updates fail instead of overwriting records', () => {
  assert.throws(() => pathways.read(storage('{')), SyntaxError);
  assert.throws(() => pathways.read(storage(JSON.stringify([{ courseType: 'Robot' }]))), /invalid/);
  assert.throws(() => pathways.update([], { courseType: 'Coding', studentId: '1', programme: 'CS1', date: '2026-02-30' }), /required/);
  assert.throws(() => pathways.update([], { courseType: 'Coding', studentId: '', programme: 'CS1', date: '2026-11-13' }), /required/);
});

test('maps explicitly specified CodeCombat levels to matching CS curricula without guessing', () => {
  for (let level = 1; level <= 5; level++) {
    assert.equal(pathways.codingCurriculumProgramme(`CodeCombat Lv${level}`), `CS${level}`);
    assert.equal(pathways.codingCurriculumProgramme(`Code Combat Level ${level}`), `CS${level}`);
  }
  assert.equal(pathways.codingCurriculumProgramme('CodeCombat'), 'CodeCombat');
  assert.equal(pathways.codingCurriculumProgramme('CodeMonkey P1'), 'CodeMonkey P1');
  assert.equal(pathways.codingCurriculumProgramme('CS2'), 'CS2');
});

test('confirming a CodeCombat level with its CS alias does not reset progress', () => {
  const records = pathways.update([], { courseType: 'Coding', studentId: 'ST1', programme: 'CS1', previousProgramme: 'CodeCombat Lv1', date: '2026-11-14' });
  assert.equal(records[0].startedOn, null);
  assert.deepEqual(records[0].history, []);
});

test('matches robot name variants without guessing between different names', () => {
  const programme = 'AIKIRO Lv1 additional';
  for (const variant of ['dancerbot', '  DANCER  BOT ', 'Robot Dancer', 'robotdancer', 'Robot Dancer Bot']) {
    assert.equal(pathways.robotNameKey(variant, programme), pathways.robotNameKey('Robot Dancer', programme));
  }
  assert.notEqual(pathways.robotNameKey('Robot Dancer', programme), pathways.robotNameKey('Dance Bot', programme));
  assert.notEqual(pathways.robotNameKey('Robot Fish', programme), pathways.robotNameKey('Robot Dog', programme));
  assert.notEqual(pathways.robotNameKey('Robot', programme), pathways.robotNameKey('', programme));
  assert.notEqual(pathways.robotNameKey('Robot', programme), pathways.robotNameKey('Ro', programme));
});

test('flags ambiguous curriculum name variants rather than assigning one progress record twice', () => {
  const programme = 'AIKIRO Lv1 original';
  const template = [{ 'Robot name': 'Robot Dancer' }, { 'Robot name': 'Dancer Bot' }];
  const progress = [{ Robot: 'dancerbot', Status: 'Done' }];
  const result = pathways.reconcileRobotProgress(programme, template, progress, { name: 'Student', studentId: 'S1' });
  assert.deepEqual(result.rows.map((row) => row.Status), ['Needs review', 'Needs review']);
  assert.deepEqual(result.conflicts, progress);
  const reviews = [{ programme, robot: 'Robot Dancer', status: 'Done', reviewedOn: '2026-11-14' }];
  assert.deepEqual(pathways.applyRobotReviews(result.rows, reviews, programme, []).map((row) => row.Status), ['Needs review', 'Needs review']);
});

test('reconciles the Lv3 sequence without transferring retired robot progress to FrogBot', () => {
  const template = ['InvertBot', 'FrogBot', 'GunBot'].map((name, index) => ({ 'Robot name': name, Sequence: String(index + 1), Level: '3' }));
  const progress = [
    { Robot: 'InvertBot', Status: 'Done' },
    { Robot: 'Rolling Bot', Status: 'Done' },
    { Robot: 'CannoBot', Status: 'In progress' },
    { Robot: 'FutureBot', Status: 'Not started' },
  ];
  const result = pathways.reconcileRobotProgress('ROBOKIT Lv3', template, progress, { name: 'Student', studentId: 'S1' });
  assert.deepEqual(result.rows.map((row) => [row.Robot, row.Status]), [
    ['InvertBot', 'Done'], ['FrogBot', 'Not started'], ['GunBot', 'In progress'],
  ]);
  assert.equal(result.rows[2].sourceProgress, progress[2]);
  assert.deepEqual(result.retired, [progress[1], progress[3]]);
  assert.equal(progress[2].Robot, 'CannoBot');
});

test('flags duplicate aliases for review instead of selecting a status', () => {
  const template = [{ 'Robot name': 'GunBot', Sequence: '1', Level: '3' }];
  const progress = [{ Robot: 'GunBot', Status: 'Done' }, { Robot: 'CannoBot', Status: 'In progress' }];
  const result = pathways.reconcileRobotProgress('ROBOKIT Lv3', template, progress, {});
  assert.equal(result.rows[0].Status, 'Needs review');
  assert.deepEqual(result.conflicts, progress);
  assert.notEqual(pathways.robotNameKey('GunBot', 'ROBOKIT Lv2'), pathways.robotNameKey('CannoBot', 'ROBOKIT Lv2'));
});

test('reconciles AIKIRO additional Fighter progress and reviews with Wrestler, but keeps Frog separate', () => {
  const programme = 'AIKIRO Lv1 additional';
  const template = ['Robot Wrestler', 'Flag Bot'].map((name, index) => ({ 'Robot name': name, Sequence: String(index + 1), Level: '1' }));
  const progress = [{ Robot: 'Robot Fighter', Status: 'In progress' }, { Robot: 'Frog Bot', Status: 'Done' }];
  const result = pathways.reconcileRobotProgress(programme, template, progress, { name: 'Student', studentId: 'S1' });
  assert.deepEqual(result.rows.map((row) => [row.Robot, row.Status]), [['Robot Wrestler', 'In progress'], ['Flag Bot', 'Not started']]);
  assert.deepEqual(result.retired, [progress[1]]);
  const reviews = [{ studentId: 'S1', programme, robot: 'Robot Fighter', status: 'Done', reviewedOn: '2026-11-14' }];
  const reviewed = pathways.applyRobotReviews(result.rows, reviews, programme, []);
  assert.equal(reviewed[0].Status, 'Done');
  const later = [{ robot: 'Robot Wrestler', status: 'In progress', date: '2026-11-15' }];
  assert.equal(pathways.applyRobotReviews(result.rows, reviews, programme, later)[0].Status, 'In progress');
  assert.notEqual(pathways.robotNameKey('Robot Fighter', 'AIKIRO Lv1 original'), pathways.robotNameKey('Robot Wrestler', 'AIKIRO Lv1 original'));
  assert.notEqual(pathways.robotNameKey('Frog Bot', programme), pathways.robotNameKey('Flag Bot', programme));
});

test('reviewed pathway preserves matching browser history and permits later pathway changes', () => {
  const review = { studentId: 'S1', programme: 'AIKIRO Lv1 additional', reviewedOn: '2026-11-14' };
  const old = { programme: 'AIKIRO Lv1 original', startedOn: '2026-11-13', history: [] };
  assert.equal(pathways.reviewedRobotPathway(old, review).programme, review.programme);
  const matching = { ...old, programme: 'AIKIRO Lv1_additional' };
  assert.equal(pathways.reviewedRobotPathway(matching, review), matching);
  assert.deepEqual(pathways.reviewedRobotPathway({ ...matching, startedOn: null }, review), { ...matching, startedOn: review.reviewedOn, reviewed: true });
  const later = { ...old, programme: 'AIKIRO Lv2 original', startedOn: '2026-11-15' };
  assert.equal(pathways.reviewedRobotPathway(later, review), later);
});

test('reviewed progress is programme-specific and later lessons supersede it', () => {
  const rows = [{ Robot: 'DiceBot', Status: 'In progress' }, { Robot: 'Other', Status: 'Done' }];
  const reviews = [{ studentId: 'S1', programme: 'ROBOKIT Lv4', robot: 'DiceBot', displayRobot: 'DiveBot', status: 'Done', reviewedOn: '2026-11-14' }];
  pathways.validateRobotReviews([], reviews);
  const oldLesson = [{ date: '2026-11-13', robot: 'DiveBot', status: 'In progress' }];
  const result = pathways.applyRobotReviews(rows, reviews, 'ROBOKIT Lv4', oldLesson);
  assert.equal(result[0].Robot, 'DiveBot');
  assert.equal(result[0].Status, 'Done');
  assert.equal(rows[0].Robot, 'DiceBot');
  assert.equal(result[1], rows[1]);
  assert.equal(pathways.applyRobotReviews(rows, reviews, 'ROBOKIT Lv3', oldLesson)[0], rows[0]);
  const later = [...oldLesson, { date: '2026-11-15', robot: 'DiveBot', status: 'In progress' }];
  assert.equal(pathways.applyRobotReviews(rows, reviews, 'ROBOKIT Lv4', later)[0].Status, 'In progress');
  assert.throws(() => pathways.validateRobotReviews([], [...reviews, reviews[0]]), /duplicate/);
  assert.throws(() => pathways.validateRobotReviews([], [{ ...reviews[0], reviewedOn: '2026-02-30' }]), /invalid/);
});

test('unknown reviewed progress stays unknown until a later lesson confirms a status', () => {
  const rows = [{ Robot: 'FrogBot', Status: 'Not started' }];
  const reviews = [{ studentId: 'S1', programme: 'ROBOKIT Lv3', robot: 'FrogBot', status: 'Unknown', reviewedOn: '2026-11-14' }];
  pathways.validateRobotReviews([], reviews);
  assert.equal(pathways.applyRobotReviews(rows, reviews, 'ROBOKIT Lv3', [])[0].Status, 'Unknown');
  assert.equal(pathways.applyRobotReviews(rows, reviews, 'ROBOKIT Lv3', [{ date: '2026-11-15', robot: 'FrogBot', status: 'Done' }])[0].Status, 'Done');
});

test('a reviewed student-specific sequence applies only to its reviewed pathway', () => {
  const template = [{ 'Robot name': 'FrogBot', Level: '3', Sequence: '1' }];
  const review = { studentId: 'S1', programme: 'ROBOKIT Lv3', reviewedOn: '2026-11-14', robotSequence: ['Rolling Bot', 'CannoBot', 'FutureBot'] };
  pathways.validateRobotReviews([review], []);
  const current = { programme: 'ROBOKIT Lv3', startedOn: '2026-11-14' };
  const rows = pathways.reviewedRobotSequence(template, current, review);
  assert.deepEqual(rows.map((row) => [row['Robot name'], row.Sequence]), [['Rolling Bot', '1'], ['CannoBot', '2'], ['FutureBot', '3']]);
  assert.equal(pathways.reviewedRobotSequence(template, { ...current, startedOn: '2026-11-15' }, review), template);
  assert.equal(pathways.reviewedRobotSequence(template, { ...current, programme: 'ROBOKIT Lv4' }, review), template);
  assert.equal(pathways.reviewedRobotSequence(template, current, null), template);
  assert.throws(() => pathways.validateRobotReviews([{ ...review, robotSequence: ['GunBot', 'CannoBot'] }], []), /invalid/);
  assert.doesNotThrow(() => pathways.validateRobotReviews([{ ...review, hidePreviousTrackerProgress: true }], []));
  assert.throws(() => pathways.validateRobotReviews([{ ...review, hidePreviousTrackerProgress: 'true' }], []), /invalid/);
});

test('removes only approved saved student and programme progress once per browser', () => {
  const rows = [
    { studentId: 'S1', Robot: 'Old', sourceRow: { 'Programme ID': 'AIK-L1-O' } },
    { studentId: 'S1', Robot: 'New', sourceRow: { 'Programme ID': 'AIK-L1-A' } },
    { studentId: 'S2', Robot: 'Other', sourceRow: { 'Programme ID': 'AIK-L1-O' } },
    { studentId: 'S1', Robot: 'Unspecified', sourceRow: {} },
  ];
  const values = new Map([['icc-robot-progress', JSON.stringify(rows)]]);
  const store = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const removals = [{ studentId: 'S1', programmeId: 'AIK-L1-O', version: 'test-1' }];
  assert.deepEqual(pathways.applyRobotProgressRemovals(rows, removals, store), rows.slice(1));
  assert.deepEqual(JSON.parse(values.get('icc-robot-progress')), rows.slice(1));
  assert.deepEqual(pathways.applyRobotProgressRemovals(rows, removals, store), rows);
  assert.throws(() => pathways.applyRobotProgressRemovals(rows, [removals[0], removals[0]], store), /invalid/);
});

test('removes explicitly identified legacy generated progress without touching ambiguous records', () => {
  const rows = [
    { Student: 'Student One', 'Student (linked)': 'Student One', Level: 'Lv2', Robot: 'Old Bot' },
    { Student: 'Student One', Level: 'Lv3', Robot: 'Old Bot' },
    { Student: 'Student Two', Level: 'Lv2', Robot: 'Old Bot' },
    { Student: 'Student One', studentId: 'S2', Level: 'Lv2', Robot: 'Old Bot' },
    { Student: 'Student One', Level: 'Lv2', Robot: 'Other Bot' },
    { Student: 'Student One', Level: 'Lv2', Robot: 'Robot Old' },
    { Student: 'Student One', Level: 'Lv2', Robot: 'Old Bot', sourceRow: { 'Programme ID': 'OTHER' } },
  ];
  const values = new Map([['icc-robot-progress', JSON.stringify(rows)]]);
  const store = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const removal = { studentId: 'S1', programmeId: 'UAR-L2', version: 'legacy-1', legacy: { studentName: 'Student One', level: 'Lv2', robots: ['Old Bot'] } };
  assert.deepEqual(pathways.applyRobotProgressRemovals(rows, [removal], store), rows.slice(1));
  assert.deepEqual(JSON.parse(values.get('icc-robot-progress')), rows.slice(1));
  assert.throws(() => pathways.applyRobotProgressRemovals(rows, [{ ...removal, legacy: { ...removal.legacy, robots: [] } }], store), /invalid/);
});
