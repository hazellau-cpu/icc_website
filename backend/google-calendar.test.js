const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleCalendarReader, hongKongDate } = require('./google-calendar');

test('reads Hong Kong calendar events with the attached service identity', async () => {
  let credentialRequests = 0;
  const requests = [];
  const calendar = createGoogleCalendarReader({
    calendarId: 'calendar@example.com',
    authClientProvider: async () => {
      credentialRequests += 1;
      return { getAccessToken: async () => ({ token: 'runtime-access-token' }) };
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return {
        ok: true,
        json: async () => ({
          items: [{
            id: 'event-1',
            summary: 'Lesson',
            description: 'Student ID: ST-R-003\nCourse type: ROBOKIT Lv3',
            start: { dateTime: '2026-11-14T09:00:00+08:00' },
            end: { dateTime: '2026-11-14T10:00:00+08:00' },
          }],
        }),
      };
    },
  });

  const result = await calendar.readToday(new Date('2026-11-14T02:00:00Z'));
  assert.equal(result.date, '2026-11-14');
  assert.equal(result.events[0].studentId, 'ST-R-003');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer runtime-access-token');
  assert.equal(requests[0].url.searchParams.get('timeZone'), 'Asia/Hong_Kong');
  assert.equal(credentialRequests, 1);
});

test('returns the next matching course event and validates query identifiers', async () => {
  const calendar = createGoogleCalendarReader({
    calendarId: 'calendar@example.com',
    authClientProvider: async () => ({ getAccessToken: async () => ({ token: 'runtime-access-token' }) }),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        items: [{
          id: 'event-2',
          summary: 'Lesson',
          description: 'Student ID: ST-C-001\nCourse type: Coding',
          start: { dateTime: '2026-11-15T09:00:00+08:00' },
          end: { dateTime: '2026-11-15T10:00:00+08:00' },
        }],
      }),
    }),
  });

  assert.deepEqual(await calendar.readNext({
    studentId: 'ST-C-001',
    courseType: 'Coding',
    now: new Date('2026-11-14T00:00:00Z'),
  }), {
    status: 'found',
    event: {
      id: 'event-2',
      title: 'Lesson',
      studentId: 'ST-C-001',
      course: 'Coding',
      start: '2026-11-15T09:00:00+08:00',
      end: '2026-11-15T10:00:00+08:00',
    },
  });
  await assert.rejects(calendar.readNext({ studentId: 'bad/id', courseType: 'Robot' }), /Invalid student ID/);
});

test('computes the calendar day in Hong Kong', () => {
  assert.equal(hongKongDate(new Date('2026-11-13T16:30:00Z')), '2026-11-14');
});
