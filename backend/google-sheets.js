const { createGoogleAccessTokenProvider } = require('./google-access-token');

const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS = [
  { name: 'Students', range: 'Students!A:I', required: ['Student ID', 'Name', 'Course type', 'Paid Status', 'Total Hours', 'Remaining Hours', 'Hours Completed', 'New Bill Start', 'Remarks'] },
  { name: 'Robot Progress Log', range: "'Robot Progress Log'!A:K", required: ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Robot Name', 'Progress Status', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'] },
  { name: 'Coding Progress Log', range: "'Coding Progress Log'!A:L", required: ['Date', 'Student ID', 'Tutor', 'Course Type', 'Starting Level', 'Ending Level', 'Comment', 'Progress', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'] },
  { name: 'Math Progress Log', range: "'Math Progress Log'!A:J", required: ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Topic', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'] },
];

function createGoogleSheetsReader({ spreadsheetId, authClientProvider = null, fetchImpl = globalThis.fetch }) {
  const getAccessToken = createGoogleAccessTokenProvider({
    scopes: [SHEETS_SCOPE],
    authClientProvider,
  });

  return async function readSpreadsheet() {
    if (!spreadsheetId) throw new Error('Google Sheets spreadsheet ID is not configured');
    const token = await getAccessToken();
    const url = new URL(`${SHEETS_API_URL}/${encodeURIComponent(spreadsheetId)}/values:batchGet`);
    for (const sheet of SHEETS) url.searchParams.append('ranges', sheet.range);
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    url.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER');
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Google Sheets read failed with status ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.valueRanges) || body.valueRanges.length !== SHEETS.length) {
      throw new Error('Google Sheets response did not include all configured tabs');
    }

    const result = {};
    for (const [index, sheet] of SHEETS.entries()) {
      const values = body.valueRanges[index].values || [];
      const headers = (values[0] || []).map((value) => String(value ?? '').trim());
      const missingHeaders = sheet.required.filter((header) => !headers.includes(header));
      if (missingHeaders.length) {
        throw new Error(`Google Sheets tab "${sheet.name}" is missing required columns: ${missingHeaders.join(', ')}`);
      }
      const rows = values.slice(1).flatMap((valuesRow, rowIndex) => {
        if (!valuesRow.some((value) => value !== null && value !== '')) return [];
        return [{
          row_number: rowIndex + 2,
          values: Object.fromEntries(headers.map((header, columnIndex) => [header, valuesRow[columnIndex] ?? ''])),
        }];
      });
      if (sheet.name === 'Students') result.students = rows;
      else (result.progressLogs ||= []).push({ sheet_name: sheet.name, rows });
    }
    return result;
  };
}

module.exports = { createGoogleSheetsReader };
