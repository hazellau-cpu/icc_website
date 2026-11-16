const { DASHBOARD_SHEET_NAMES } = require('./sheets-workspace-store');

async function readStarterSheet({ spreadsheetId, getAccessToken, fetchImpl = fetch, includeProgress = true }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId || '')) throw new Error('Invalid starter Sheet configuration.');
  const token = await getAccessToken();
  if (!token) throw new Error('Starter Sheet reader did not obtain an access token.');
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const options = { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) };
  const metadataResponse = await fetchImpl(`${base}?fields=sheets(properties(title),merges)`, options);
  if (!metadataResponse.ok) throw new Error(`Starter Sheet metadata returned HTTP ${metadataResponse.status}.`);
  const metadata = await metadataResponse.json();
  if (!Array.isArray(metadata.sheets) || !metadata.sheets.length
    || metadata.sheets.some((sheet) => typeof sheet.properties?.title !== 'string' || !sheet.properties.title)) {
    throw new Error('Starter Sheet tab list is invalid.');
  }
  const starterSheets = metadata.sheets.filter((sheet) => !DASHBOARD_SHEET_NAMES.includes(sheet.properties.title));
  if (!starterSheets.length) throw new Error('Starter Sheet has no student tabs.');
  const url = new URL(`${base}/values:batchGet`);
  for (const sheet of starterSheets) {
    url.searchParams.append('ranges', `'${sheet.properties.title.replace(/'/g, "''")}'!A3:E`);
  }
  const valuesResponse = await fetchImpl(url, options);
  if (!valuesResponse.ok) throw new Error(`Starter Sheet data returned HTTP ${valuesResponse.status}.`);
  const values = await valuesResponse.json();
  if (!Array.isArray(values.valueRanges) || values.valueRanges.length !== starterSheets.length) {
    throw new Error('Starter Sheet data is incomplete.');
  }
  const years = new Map();
  const robotHistory = [];
  for (const [tabIndex, range] of values.valueRanges.entries()) {
    const rows = range.values;
    if (!Array.isArray(rows) || rows[0]?.[0] !== 'Student ID (James)' || rows[0]?.[4] !== 'Year of Birth') {
      throw new Error('A starter Sheet tab is missing its student ID or year of birth header.');
    }
    for (const row of rows.slice(1)) {
      const year = String(row[4] ?? '').trim();
      if (!year) continue;
      const studentId = String(row[0] ?? '').trim().toUpperCase();
      if (!studentId || !/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > new Date().getFullYear()) {
        throw new Error('A starter Sheet birth year has an invalid student ID or year.');
      }
      if (years.has(studentId) && years.get(studentId) !== year) {
        throw new Error('A student has conflicting birth years in the starter Sheet.');
      }
      years.set(studentId, year);
    }
    if (!includeProgress) continue;
    if (JSON.stringify(rows[0].slice(0, 5)) !== JSON.stringify(['Student ID (James)', 'Student Name', 'Robot', 'Status', 'Year of Birth'])) {
      throw new Error('A starter Sheet tab has invalid robot progress headers.');
    }
    const sheet = starterSheets[tabIndex];
    const groups = (sheet.merges || []).filter((merge) => merge.startColumnIndex === 0
      && merge.endColumnIndex === 1 && merge.startRowIndex >= 3);
    for (const [index, row] of rows.entries()) {
      if (index === 0) continue;
      const robot = String(row[2] ?? '').trim();
      const status = String(row[3] ?? '').trim();
      if (!robot && !status) continue;
      if (!robot || !status) throw new Error('A starter Sheet robot progress row is incomplete.');
      const sheetRow = index + 2;
      const matches = groups.filter((group) => sheetRow >= group.startRowIndex && sheetRow < group.endRowIndex);
      if (matches.length > 1) throw new Error('A starter Sheet robot progress row has overlapping student ID ranges.');
      const anchor = matches.length ? rows[matches[0].startRowIndex - 2] : row;
      const studentId = String(anchor?.[0] ?? '').trim().toUpperCase();
      const rowId = String(row[0] ?? '').trim().toUpperCase();
      if (!studentId || (rowId && rowId !== studentId)) {
        throw new Error('A starter Sheet robot progress row has a missing or conflicting student ID.');
      }
      robotHistory.push({ studentId, programme: sheet.properties.title, robot, status });
    }
  }
  return {
    demographics: [...years].map(([studentId, yearOfBirth]) => ({ studentId, yearOfBirth })),
    robotHistory,
  };
}

async function readStarterDemographics(options) {
  return (await readStarterSheet({ ...options, includeProgress: false })).demographics;
}

module.exports = { readStarterDemographics, readStarterSheet };
