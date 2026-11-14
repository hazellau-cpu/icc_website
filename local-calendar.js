const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { typeForCourse } = require('./local-calendar-mapping');

const execFileAsync = promisify(execFile);
const scope = 'https://www.googleapis.com/auth/calendar.events.readonly';

function hongKongDate(now = new Date()) {
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

async function accessToken(serviceAccount, tokenProvider) {
  const getToken = tokenProvider || (async () => {
    const result = await execFileAsync('gcloud', [
      'auth', 'print-access-token', `--impersonate-service-account=${serviceAccount}`, `--scopes=${scope}`,
    ], { timeout: 30000, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  });
  const token = await getToken();
  if (!token) throw new Error('Calendar reader did not obtain an access token.');
  return token;
}

async function readToday({ calendarId, serviceAccount, fetchImpl = fetch, tokenProvider, now = new Date() }) {
  if (!calendarId || !serviceAccount) throw new Error('Calendar reader configuration is incomplete.');
  const token = await accessToken(serviceAccount, tokenProvider);
  const date = hongKongDate(now);
  const start = new Date(`${date}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 86400000);
  const events = [];
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('timeMin', start.toISOString());
    url.searchParams.set('timeMax', end.toISOString());
    url.searchParams.set('timeZone', 'Asia/Hong_Kong');
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('showDeleted', 'false');
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Calendar request failed with HTTP ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('Calendar response is missing event data.');
    events.push(...data.items.filter((event) => event.status !== 'cancelled').map(normalizeEvent));
    if (!data.nextPageToken) return { date, events };
    pageToken = data.nextPageToken;
  }
  throw new Error('Calendar returned too many event pages.');
}

async function readNext({ calendarId, serviceAccount, studentId, courseType, fetchImpl = fetch, tokenProvider, now = new Date() }) {
  if (!calendarId || !serviceAccount) throw new Error('Calendar reader configuration is incomplete.');
  if (!/^[a-z0-9_-]{1,64}$/i.test(studentId || '') || !['Robot', 'Coding', 'Math'].includes(courseType)) {
    throw new Error('Invalid student ID or course type.');
  }
  const token = await accessToken(serviceAccount, tokenProvider);
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('timeMin', now.toISOString());
    url.searchParams.set('timeZone', 'Asia/Hong_Kong');
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('showDeleted', 'false');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('q', studentId);
    url.searchParams.set('maxResults', '250');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Calendar request failed with HTTP ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('Calendar response is missing event data.');
    for (const raw of data.items) {
      if (raw.status === 'cancelled') continue;
      const event = normalizeEvent(raw);
      if (event.studentId.toUpperCase() !== studentId.toUpperCase()) continue;
      const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(event.start) ? `${event.start}T00:00:00+08:00` : event.start);
      if (!Number.isFinite(start.getTime())) throw new Error('A matching calendar event has an invalid start time.');
      if (start < now) continue;
      const eventType = typeForCourse(event.course);
      if (!eventType) return { status: 'review' };
      if (eventType === courseType) return { status: 'found', event };
    }
    if (!data.nextPageToken) return { status: 'none' };
    pageToken = data.nextPageToken;
  }
  throw new Error('Calendar returned too many event pages.');
}

module.exports = { hongKongDate, normalizeEvent, readToday, readNext };
