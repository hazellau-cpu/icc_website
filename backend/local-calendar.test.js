const test = require('node:test');
const assert = require('node:assert/strict');
const { hongKongDate, normalizeEvent, readToday, readNext } = require('../local-calendar');
const { matchEvents, timeLabel } = require('../local-calendar-mapping');

test('reads all calendar pages for the Hong Kong day with a read-only token', async () => {
  const calls = [];
  const result = await readToday({
    calendarId: 'private-calendar', serviceAccount: 'reader@example.test',
    now: new Date('2026-11-12T16:30:00Z'), tokenProvider: async () => 'test-token',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => calls.length === 1
          ? { items: [{ id: 'one', summary: 'Lesson', description: 'Student ID: ST009<br>Course type: Math', start: { dateTime: '2026-11-13T11:00:00+08:00' }, end: { dateTime: '2026-11-13T12:00:00+08:00' } }], nextPageToken: 'next' }
          : { items: [{ id: 'cancelled', status: 'cancelled' }] },
      };
    },
  });
  assert.equal(hongKongDate(new Date('2026-11-12T16:30:00Z')), '2026-11-13');
  assert.equal(result.date, '2026-11-13');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].studentId, 'ST009');
  assert.equal(result.events[0].course, 'Math');
  assert.equal(calls[0].url.searchParams.get('timeMin'), '2026-11-12T16:00:00.000Z');
  assert.equal(calls[0].url.searchParams.get('timeMax'), '2026-11-13T16:00:00.000Z');
  assert.equal(calls[0].url.searchParams.get('singleEvents'), 'true');
  assert.equal(calls[1].url.searchParams.get('pageToken'), 'next');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
});

test('matches only student ID and course; keeps missing and ambiguous records for review', () => {
  const state = {
    robotStudents: [{ studentId: 'old', jamesStudentId: 'ST1', name: 'Student' }],
    codingStudents: [{ studentId: 'ST1', name: 'Student' }],
    mathStudents: [],
  };
  const events = [
    { id: '1', studentId: 'st1', course: 'Code Combat Lv1', start: '2026-11-13T11:00:00+08:00', end: '2026-11-13T12:00:00+08:00' },
    { id: '2', studentId: 'ST1', course: 'AIKIRO', start: '2026-11-13', end: '2026-11-14' },
    { id: '3', studentId: 'missing', course: 'Math' },
    { id: '4', studentId: '', course: 'Math' },
  ];
  const result = matchEvents(events, state);
  assert.deepEqual(result.matched.map((row) => row.type), ['Coding', 'Robot']);
  assert.equal(result.matched[0].lessonTime, '11:00 - 12:00');
  assert.equal(result.matched[1].lessonTime, 'All day');
  assert.deepEqual(result.unmatched.map((row) => row.reason), ['Student not in active roster', 'Missing student ID']);
  state.codingStudents.push({ studentId: 'ST1', name: 'Another student' });
  assert.equal(matchEvents([events[0]], state).unmatched[0].reason, 'Ambiguous student ID');
  state.codingStudents[1] = { studentId: 'ST2', name: 'Student' };
  assert.equal(matchEvents([events[0]], state).unmatched[0].reason, 'Ambiguous student name');
});

test('does not silently hide calendar failures or invalid event times', async () => {
  await assert.rejects(readToday({
    calendarId: 'calendar', serviceAccount: 'reader', tokenProvider: async () => 'token',
    fetchImpl: async () => ({ ok: false, status: 403 }),
  }), /HTTP 403/);
  assert.equal(timeLabel({ start: 'invalid', end: 'invalid' }), 'Time unavailable');
  assert.equal(normalizeEvent({ description: '' }).studentId, '');
});

test('finds the next future lesson for the exact student and course across calendar pages', async () => {
  const calls = [];
  const event = (id, course, start, status) => ({
    id, status, description: `Student ID: ST009\nCourse type: ${course}`,
    start: { dateTime: start }, end: { dateTime: '2026-11-13T16:00:00+08:00' },
  });
  const result = await readNext({
    calendarId: 'private-calendar', serviceAccount: 'reader', studentId: 'ST009', courseType: 'Math',
    now: new Date('2026-11-13T04:00:00Z'), tokenProvider: async () => 'token',
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => calls.length === 1
        ? { items: [
          { ...event('other-student', 'Math', '2026-11-13T10:00:00+08:00'), description: 'Student ID: ST0099\nCourse type: Math' },
          event('ongoing', 'Math', '2026-11-13T11:00:00+08:00'),
          event('coding', 'CS1', '2026-11-13T13:00:00+08:00'),
          event('cancelled', 'Math', '2026-11-13T14:00:00+08:00', 'cancelled'),
        ], nextPageToken: 'next' }
        : { items: [event('next', 'Math', '2026-11-13T15:00:00+08:00')] } };
    },
  });
  assert.equal(result.status, 'found');
  assert.equal(result.event.id, 'next');
  assert.equal(calls[0].searchParams.get('q'), 'ST009');
  assert.equal(calls[0].searchParams.get('orderBy'), 'startTime');
  assert.equal(calls[0].searchParams.has('timeMax'), false);
  assert.equal(calls[1].searchParams.get('pageToken'), 'next');
});

test('distinguishes no matching events, unclassified events, and calendar failures', async () => {
  const options = { calendarId: 'calendar', serviceAccount: 'reader', studentId: 'ST1', courseType: 'Robot', tokenProvider: async () => 'token' };
  assert.equal((await readNext({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ items: [] }) }) })).status, 'none');
  const event = { id: 'one', description: 'Student ID: ST1', start: { dateTime: '2099-01-01T10:00:00+08:00' } };
  assert.equal((await readNext({ ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ items: [event] }) }) })).status, 'review');
  await assert.rejects(readNext({ ...options, fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  await assert.rejects(readNext({ ...options, studentId: '../invalid' }), /Invalid student ID/);
});
