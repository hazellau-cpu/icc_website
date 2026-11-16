const test = require('node:test');
const assert = require('node:assert/strict');
const { extractLibraries } = require('./export-libraries');

test('exports library fields without student records, notes or inventory counts', () => {
  const result = extractLibraries({
    robotPrograms: [{ programme_id: 'P1', student: 'Private' }],
    curriculum: [{ Item: 'Lesson', Notes: 'Private' }],
    robots: [{ 'Robot name': 'Robot', studentId: 'private' }],
    componentLibrary: [{ Component: 'Wheel', remarks: 'Private' }],
    inventory: [{ Component: 'Wheel', 'Lv1 total': 2, 'Total center qty': 3, Notes: 'Private' }],
    robotStudents: [{ name: 'Private' }],
  });
  assert.deepEqual(result, {
    robotPrograms: [{ programme_id: 'P1' }],
    curriculum: [{ Item: 'Lesson' }],
    robots: [{ 'Robot name': 'Robot' }],
    componentLibrary: [{ Component: 'Wheel' }],
    inventory: [{ Component: 'Wheel', 'Lv1 total': 2 }],
  });
});

test('rejects missing collections and nested library values', () => {
  assert.throws(() => extractLibraries({}), /Missing library collection/);
  assert.throws(() => extractLibraries({
    robotPrograms: [{ programme_id: { student: 'Private' } }],
    curriculum: [], robots: [], componentLibrary: [], inventory: [],
  }), /Invalid robotPrograms field programme_id/);
});
