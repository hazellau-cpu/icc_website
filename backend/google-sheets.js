const crypto = require('node:crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS = [
  { name: 'Students', range: 'Students!A:I', required: ['Student ID', 'Name', 'Course type', 'Paid Status', 'Total Hours', 'Remaining Hours', 'Hours Completed', 'New Bill Start', 'Remarks'] },
  { name: 'Robot Progress Log', range: "'Robot Progress Log'!A:K", required: ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Robot Name', 'Progress Status', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'] },
  { name: 'Coding Progress Log', range: "'Coding Progress Log'!A:L", required: ['Date', 'Student ID', 'Tutor', 'Course Type', 'Starting Level', 'Ending Level', 'Comment', 'Progress', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'] },
  { name: 'Math Progress Log', range: "'Math Progress Log'!A:J", required: ['Date', 'Student ID', 'Tutor', 'Course Type', 'Comment', 'Topic', 'Remarks', 'Start Time', 'End Time', 'Attendance Status'] },
];

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function parseServiceAccount(serviceAccountJson) {
  if (!serviceAccountJson) throw new Error('Google Sheets source is not configured');
  let account;
  try {
    account = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('Google Sheets service account configuration is not valid JSON');
  }
  if (!account.client_email || !account.private_key) {
    throw new Error('Google Sheets service account configuration is incomplete');
  }
  return {
    clientEmail: String(account.client_email),
    privateKey: String(account.private_key).replace(/\\n/g, '\n'),
  };
}

function createGoogleSheetsReader({ spreadsheetId, serviceAccountJson, fetchImpl = globalThis.fetch }) {
  let cachedToken = '';
  let tokenExpiresAt = 0;

  async function accessToken() {
    if (cachedToken && tokenExpiresAt > Date.now() + 30_000) return cachedToken;
    if (!spreadsheetId) throw new Error('Google Sheets spreadsheet ID is not configured');
    const account = parseServiceAccount(serviceAccountJson);
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const payload = base64UrlJson({
      iss: account.clientEmail,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    });
    const unsignedAssertion = `${header}.${payload}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(unsignedAssertion), account.privateKey).toString('base64url');
    const assertion = `${unsignedAssertion}.${signature}`;
    const tokenResponse = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Google OAuth token request failed with status ${tokenResponse.status}`);
    const tokenBody = await tokenResponse.json();
    if (!tokenBody.access_token) throw new Error('Google OAuth token response did not include an access token');
    cachedToken = String(tokenBody.access_token);
    tokenExpiresAt = Date.now() + Math.max(0, Number(tokenBody.expires_in || 3600)) * 1000;
    return cachedToken;
  }

  return async function readSpreadsheet() {
    if (!spreadsheetId) throw new Error('Google Sheets spreadsheet ID is not configured');
    const token = await accessToken();
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
