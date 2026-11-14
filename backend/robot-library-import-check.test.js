const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertRobotLibraryCompatible } = require('./robot-library-import-check');

test('allows an empty database and an unchanged library', () => {
  const incoming = [{ robotId: 'R1', programmeId: 'P', sequence: 1, name: 'KartBot' }];
  assert.doesNotThrow(() => assertRobotLibraryCompatible([], incoming));
  assert.doesNotThrow(() => assertRobotLibraryCompatible([
    { robot_id: 'R1', programme_id: 'P', sequence_number: 1, robot_name: 'KartBot' },
  ], incoming));
});

test('rejects reordered, renamed, and removed existing robots', () => {
  const existing = [{ robot_id: 'R1', programme_id: 'P', sequence_number: 1, robot_name: 'KartBot' }];
  for (const incoming of [
    [{ robotId: 'R1', programmeId: 'P', sequence: 2, name: 'KartBot' }],
    [{ robotId: 'R1', programmeId: 'P', sequence: 1, name: 'CanBot' }],
    [{ robotId: 'R2', programmeId: 'P', sequence: 1, name: 'CanBot' }],
  ]) {
    assert.throws(() => assertRobotLibraryCompatible(existing, incoming), /history-preserving migration/);
  }
});

test('rejects duplicate IDs or programme positions before import', () => {
  const first = { robotId: 'R1', programmeId: 'P', sequence: 1, name: 'KartBot' };
  assert.throws(() => assertRobotLibraryCompatible([], [first, { ...first, sequence: 2 }]), /duplicate/);
  assert.throws(() => assertRobotLibraryCompatible([], [first, { ...first, robotId: 'R2' }]), /duplicate/);
});

test('preserves unrelated programmes and rejects IDs already used by them', () => {
  const existing = [{ robot_id: 'R1', programme_id: 'OTHER', sequence_number: 1, robot_name: 'Other' }];
  assert.doesNotThrow(() => assertRobotLibraryCompatible(existing, [
    { robotId: 'R2', programmeId: 'P', sequence: 1, name: 'KartBot' },
  ]));
  assert.throws(() => assertRobotLibraryCompatible(existing, [
    { robotId: 'R1', programmeId: 'P', sequence: 1, name: 'KartBot' },
  ]), /history-preserving migration/);
});
