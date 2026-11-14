const { typeForCourse } = require('../local-calendar-mapping');
const { createGoogleAccessTokenProvider } = require('./google-access-token');

const CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3/calendars';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

function hongKongDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function normalizeEvent(event) {
  const description = String(event.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
  const studentId = description.match(/Student\s*ID\s*:\s*([a-z0-9_-]+)/i)?.[1] || '';
  const course = description.match(/Course\s*type\s*:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
  return {
    id: String(event.id || ''),
    title: String(event.summary || ''),
    studentId,
    course,
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
  };
}

function createGoogleCalendarReader({ calendarId, authClientProvider = null, fetchImpl = globalThis.fetch }) {
  const getAccessToken = createGoogleAccessTokenProvider({
    scopes: [CALENDAR_SCOPE],
    authClientProvider,
  });

  async function listEvents(params) {
    if (!calendarId) throw new Error('Google Calendar ID is not configured');
    const token = await getAccessToken();
    const events = [];
    let pageToken = '';
    for (let page = 0; page < 20; page += 1) {
      const url = new URL(`${CALENDAR_API_URL}/${encodeURIComponent(calendarId)}/events`);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, value);
      }
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'false');
      url.searchParams.set('maxResults', '250');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Google Calendar request failed with status ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('Google Calendar response is missing event data');
      events.push(...data.items.filter((event) => event.status !== 'cancelled'));
      if (!data.nextPageToken) return events;
      pageToken = data.nextPageToken;
    }
    throw new Error('Google Calendar returned too many event pages');
  }

  async function readToday(now = new Date()) {
    const date = hongKongDate(now);
    const start = new Date(`${date}T00:00:00+08:00`);
    const end = new Date(start.getTime() + 86400000);
    const events = await listEvents({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: 'Asia/Hong_Kong',
    });
    return { date, events: events.map(normalizeEvent) };
  }

  async function readNext({ studentId, courseType, now = new Date() }) {
    if (!/^[a-z0-9_-]{1,64}$/i.test(studentId || '') || !['Robot', 'Coding', 'Math'].includes(courseType)) {
      throw new Error('Invalid student ID or course type');
    }
    const events = await listEvents({
      timeMin: now.toISOString(),
      timeZone: 'Asia/Hong_Kong',
      orderBy: 'startTime',
      q: studentId,
    });
    for (const raw of events) {
      const event = normalizeEvent(raw);
      if (event.studentId.toUpperCase() !== studentId.toUpperCase()) continue;
      const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(event.start) ? `${event.start}T00:00:00+08:00` : event.start);
      if (!Number.isFinite(start.getTime())) throw new Error('A matching calendar event has an invalid start time');
      if (start < now) continue;
      const eventType = typeForCourse(event.course);
      if (!eventType) return { status: 'review' };
      if (eventType === courseType) return { status: 'found', event };
    }
    return { status: 'none' };
  }

  return { readToday, readNext };
}

module.exports = { createGoogleCalendarReader, hongKongDate, normalizeEvent };
