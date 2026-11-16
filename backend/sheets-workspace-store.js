const { createGoogleAccessTokenProvider } = require('./google-access-token');

const STATE_KEYS = [
  'daily-lesson-drafts', 'daily-lesson-finalizations', 'robot-students', 'coding-students',
  'math-students', 'robot-progress', 'component-items', 'robot-lessons', 'coding-lessons',
  'math-lessons', 'starter-progress', 'progress-finish-dates', 'student-pathways',
  'inventory', 'borrowings', 'robot-progress-reviews',
];
const LIBRARY_KEYS = ['robotPrograms', 'curriculum', 'robots', 'componentLibrary', 'inventory'];
const DASHBOARD_SHEET_NAMES = ['Dashboard Library', 'Dashboard State'];
const [LIBRARY_SHEET, STATE_SHEET] = DASHBOARD_SHEET_NAMES;
const CHUNK_SIZE = 40000;
const CHUNK_COUNT = 16;
const MAX_BYTES = 512 * 1024;
const STATE_HEADER = ['Key', 'Version', 'Updated By', ...Array.from({ length: CHUNK_COUNT }, (_, index) => `Data ${index + 1}`)];
const LIBRARY_HEADER = ['Collection', 'Record'];

class WorkspaceConflictError extends Error {
  constructor() {
    super('This shared edit changed in another session. Reload and retry.');
    this.name = 'WorkspaceConflictError';
  }
}

function validValue(key, value) {
  return key === 'progress-finish-dates'
    ? Boolean(value && typeof value === 'object' && !Array.isArray(value))
    : Array.isArray(value);
}

function splitText(value) {
  const chunks = [];
  let chunk = '';
  for (const character of value) {
    if (chunk.length + character.length > CHUNK_SIZE) {
      chunks.push(chunk);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > CHUNK_COUNT) throw new Error('Shared workspace edit is too large');
  return [...chunks, ...Array(CHUNK_COUNT - chunks.length).fill('')];
}

function stateRows(values) {
  if (!Array.isArray(values) || JSON.stringify(values[0]) !== JSON.stringify(STATE_HEADER)) {
    throw new Error('Dashboard State sheet has an invalid header');
  }
  if (values.length > STATE_KEYS.length + 1) throw new Error('Dashboard State sheet has unexpected rows');
  const edits = {};
  STATE_KEYS.forEach((key, index) => {
    const row = values[index + 1];
    const version = Array.isArray(row) && (typeof row[1] === 'number' || (typeof row[1] === 'string' && /^\d+$/.test(row[1])))
      ? Number(row[1]) : NaN;
    if (!Array.isArray(row) || row[0] !== key || !Number.isSafeInteger(version) || version < 0) {
      throw new Error(`Dashboard State sheet has an invalid row for ${key}`);
    }
    const chunks = row.slice(3);
    if (chunks.some((chunk, position) => typeof chunk !== 'string'
      || (chunk === '' && chunks.slice(position + 1).some(Boolean)))) {
      throw new Error(`Dashboard State sheet has invalid data chunks for ${key}`);
    }
    const data = chunks.join('');
    if (!version && data) throw new Error(`Dashboard State sheet has unexpected data for ${key}`);
    if (version) {
      if (!data || !row[2]) throw new Error(`Dashboard State sheet is missing data for ${key}`);
      let value;
      try { value = JSON.parse(data); } catch { throw new Error(`Dashboard State sheet has invalid JSON for ${key}`); }
      if (!validValue(key, value)) throw new Error(`Dashboard State sheet has an invalid value for ${key}`);
      edits[key] = { value, version };
    }
  });
  return edits;
}

function libraryRows(values) {
  if (!Array.isArray(values) || JSON.stringify(values[0]) !== JSON.stringify(LIBRARY_HEADER)) {
    throw new Error('Dashboard Library sheet has an invalid header');
  }
  const result = Object.fromEntries(LIBRARY_KEYS.map((key) => [key, []]));
  for (const row of values.slice(1)) {
    if (!Array.isArray(row) || !LIBRARY_KEYS.includes(row[0]) || typeof row[1] !== 'string') {
      throw new Error('Dashboard Library sheet has an invalid row');
    }
    let record;
    try { record = JSON.parse(row[1]); } catch { throw new Error('Dashboard Library sheet contains invalid JSON'); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Dashboard Library sheet contains an invalid record');
    }
    result[row[0]].push(record);
  }
  for (const key of LIBRARY_KEYS) {
    if (!result[key].length) throw new Error(`Dashboard Library sheet is missing ${key}`);
  }
  return result;
}

function createSheetsWorkspaceStore({ spreadsheetId, authClientProvider = null, fetchImpl = globalThis.fetch }) {
  const token = createGoogleAccessTokenProvider({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    authClientProvider,
  });
  let queue = Promise.resolve();
  const locked = (operation) => {
    const current = queue.then(operation);
    queue = current.catch(() => {});
    return current;
  };
  async function request(url, options = {}) {
    if (!spreadsheetId) throw new Error('Dashboard spreadsheet ID is not configured');
    const response = await fetchImpl(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${await token()}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Dashboard spreadsheet request failed with status ${response.status}`);
    return response.json();
  }
  const baseUrl = () => `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  async function readRanges(ranges) {
    const url = new URL(`${baseUrl()}/values:batchGet`);
    ranges.forEach((range) => url.searchParams.append('ranges', range));
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    const result = await request(url);
    if (!Array.isArray(result.valueRanges) || result.valueRanges.length !== ranges.length) {
      throw new Error('Dashboard spreadsheet response is incomplete');
    }
    return result.valueRanges.map((range) => range.values || []);
  }
  async function read() {
    const [library, state] = await readRanges([`'${LIBRARY_SHEET}'!A:B`, `'${STATE_SHEET}'!A:S`]);
    return { libraries: libraryRows(library), edits: stateRows(state) };
  }
  async function initialize(libraries) {
    return locked(async () => {
      const [existingLibraries, existingState] = await readRanges([`'${LIBRARY_SHEET}'`, `'${STATE_SHEET}'`]);
      if (existingLibraries.length || existingState.length) throw new Error('Dashboard sheets must both be empty');
      const rows = [LIBRARY_HEADER];
      for (const key of LIBRARY_KEYS) {
        if (!Array.isArray(libraries[key]) || !libraries[key].length) throw new Error(`Missing library collection: ${key}`);
        for (const item of libraries[key]) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid library record: ${key}`);
          const serialized = JSON.stringify(item);
          if (serialized.length > CHUNK_SIZE) throw new Error(`Library record is too large: ${key}`);
          rows.push([key, serialized]);
        }
      }
      await request(`${baseUrl()}/values:batchUpdate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: [
            { range: `'${LIBRARY_SHEET}'!A:B`, values: rows },
            { range: `'${STATE_SHEET}'!A:S`, values: [STATE_HEADER, ...STATE_KEYS.map((key) => [key, 0])] },
          ],
        }),
      });
    });
  }
  async function update(key, value, expectedVersion, actor) {
    return locked(async () => {
      const index = STATE_KEYS.indexOf(key);
      if (index < 0 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
        || typeof actor !== 'string' || !actor || !validValue(key, value)) {
        throw new Error('Invalid shared workspace edit');
      }
      const serialized = JSON.stringify(value);
      if (serialized === undefined || Buffer.byteLength(serialized) > MAX_BYTES) {
        throw new Error('Shared workspace edit is too large');
      }
      const [rows] = await readRanges([`'${STATE_SHEET}'!A:S`]);
      const edits = stateRows(rows);
      if ((edits[key]?.version || 0) !== expectedVersion) throw new WorkspaceConflictError();
      const row = [key, expectedVersion + 1, actor, ...splitText(serialized)];
      const range = `'${STATE_SHEET}'!A${index + 2}:S${index + 2}`;
      await request(`${baseUrl()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range, majorDimension: 'ROWS', values: [row] }),
      });
      return { key, version: expectedVersion + 1 };
    });
  }
  return { read, update, initialize };
}

module.exports = { createSheetsWorkspaceStore, STATE_KEYS, STATE_HEADER, LIBRARY_KEYS, LIBRARY_HEADER, DASHBOARD_SHEET_NAMES, WorkspaceConflictError };
