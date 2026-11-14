const test = require('node:test');
const assert = require('node:assert/strict');
const { createJamesRouter } = require('./james-router');

test('matches Cannon Bot to the canonical CannoBot without fuzzy ambiguity', async () => {
  const query = async (sql) => {
    if (sql.includes('FROM students')) return [{ student_id: 'ST001', student_name: 'Student', programme_id: 'ROB-L3' }];
    if (sql.includes('FROM robot_library_items')) return [
      { robot_id: 'R1', programme_id: 'ROB-L3', robot_name: 'CannoBot', sequence_number: 1 },
      { robot_id: 'R2', programme_id: 'ROB-L3', robot_name: 'CannonBotz', sequence_number: 2 },
    ];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const router = createJamesRouter({ query, jwtSecret: 'test-secret' });
  let result;
  const handled = await router.handle(
    { method: 'POST', headers: {} },
    {},
    new URL('http://localhost/robot-progress/preview'),
    async () => ({ student_id: 'ST001', robot_name: 'Cannon Bot', status: 'In progress' }),
    (_, status, body) => { result = { status, body }; },
  );
  assert.equal(handled, true);
  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, true);
  assert.equal(result.body.canonicalRobot, 'CannoBot');
  assert.equal(result.body.status, 'In progress');
});
