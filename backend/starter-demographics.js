const { DASHBOARD_SHEET_NAMES } = require('./sheets-workspace-store');

async function readStarterDemographics({ spreadsheetId, getAccessToken, fetchImpl = fetch }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(spreadsheetId || '')) throw new Error('Invalid starter Sheet configuration.');
  const token = await getAccessToken();
  if (!token) throw new Error('Starter Sheet reader did not obtain an access token.');
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const options = { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) };
  const metadataResponse = await fetchImpl(`${base}?fields=sheets.properties.title`, options);
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
  for (const range of values.valueRanges) {
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
  }
  return [...years].map(([studentId, yearOfBirth]) => ({ studentId, yearOfBirth }));
}

module.exports = { readStarterDemographics };
