const crypto = require('node:crypto');

const STUDENT_COLUMNS = ['Student ID', 'Name', 'Course type', 'Paid Status', 'Total Hours', 'Remaining Hours', 'Hours Completed', 'New Bill Start', 'Remarks'];
const PROGRESS_COLUMNS = ['Date', 'Student ID', 'Student', 'Programme ID', 'Programme Name', 'Tutor ID', 'Tutor', 'Course Type', 'Attendance Status', 'Comment', 'Progress', 'Remarks', 'Lesson Time', 'Current Robot', 'Robot Status', "Today's Starting Level", "Today's Finished Level", 'Progress Percent'];

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function issueReadToken(clientId, secret, expiresMinutes = 60, now = Math.floor(Date.now() / 1000)) {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: 'icc',
    aud: 'icc-sheets-read',
    sub: clientId,
    scope: 'sheets:read',
    iat: now,
    exp: now + expiresMinutes * 60,
  }));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyReadToken(token, secret, now = Math.floor(Date.now() / 1000)) {
  if (!token || !secret || secret.length < 32) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const supplied = Buffer.from(parts[2]);
  const expectedBytes = Buffer.from(expected);
  if (supplied.length !== expectedBytes.length || !crypto.timingSafeEqual(supplied, expectedBytes)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (header.alg !== 'HS256' || claims.iss !== 'icc' || claims.aud !== 'icc-sheets-read') return null;
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) return null;
    if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > now + 60 || claims.exp <= now || claims.exp <= claims.iat) return null;
    return claims;
  } catch {
    return null;
  }
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function stringValue(value) {
  return value == null ? '' : String(value);
}

function paginationFrom(url) {
  const read = (name, fallback) => {
    const value = url.searchParams.get(name);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  };
  const limit = read('limit', 100);
  const offset = read('offset', 0);
  if (limit === null || offset === null || limit < 1 || limit > 500 || offset < 0) return null;
  return { limit, offset };
}

function spreadsheetDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    if (!Number.isFinite(date.getTime())) throw new Error('Google Sheets date value is invalid');
    return date.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  const asIsoDate = (year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
      throw new Error('Google Sheets date value is invalid');
    }
    return date.toISOString().slice(0, 10);
  };
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return asIsoDate(...iso.slice(1));
  const yearFirst = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (yearFirst) return asIsoDate(...yearFirst.slice(1));
  const separated = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (separated) {
    const first = Number(separated[1]);
    const second = Number(separated[2]);
    if (first > 12 && second <= 12) return asIsoDate(separated[3], second, first);
    if (second > 12 && first <= 12) return asIsoDate(separated[3], first, second);
  }
  throw new Error('Google Sheets dates must be real date cells, ISO dates, or unambiguous day/month dates');
}

function spreadsheetStudentDate(value) {
  return typeof value === 'number' ? spreadsheetDate(value) : String(value ?? '').trim();
}

function spreadsheetTime(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const minutes = Math.floor((((value % 1) + 1) % 1) * 1440 + 0.5) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return raw;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 23 || (!match[3] && hours > 23)) return raw;
  if (match[3]) {
    if (hours < 1 || hours > 12) return raw;
    hours = (hours % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function timeMinutes(value) {
  const normalized = spreadsheetTime(value);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function latestForCourseType(rows) {
  const latest = new Map();
  for (const row of rows) {
    const current = latest.get(row.course_type);
    const rowTime = row.start_time_minutes;
    const currentTime = current?.start_time_minutes;
    const isLater = !current
      || row.record_date > current.record_date
      || (row.record_date === current.record_date && rowTime !== null && (currentTime === null || rowTime > currentTime))
      || (row.record_date === current.record_date && rowTime === currentTime && row.row_number > current.row_number);
    if (isLater) latest.set(row.course_type, row);
  }
  return [...latest.values()].sort((left, right) => left.course_type.localeCompare(right.course_type));
}

function createSheetsReadRouter({ query, jwtSecret, clientId, clientSecret, allowedOrigins = [], readSpreadsheet = null }) {
  const origins = new Set(allowedOrigins);

  function send(response, status, body, request) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Vary': 'Origin' };
    const origin = request.headers.origin;
    if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    response.writeHead(status, headers);
    response.end(JSON.stringify(body));
  }

  function handleOptions(request, response) {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) {
      send(response, 403, { detail: 'Origin is not allowed' }, request);
      return true;
    }
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Vary': 'Origin',
    };
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    response.writeHead(204, headers);
    response.end();
    return true;
  }

  function readClaims(request, response) {
    const authorization = request.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const claims = verifyReadToken(token, jwtSecret);
    if (!claims) {
      send(response, 401, { detail: 'Missing, invalid, or expired token' }, request);
      return null;
    }
    if (!String(claims.scope || '').split(/\s+/).includes('sheets:read')) {
      send(response, 403, { detail: 'Token does not grant sheets:read' }, request);
      return null;
    }
    return claims;
  }

  async function findStudent(studentId, studentName) {
    const rows = await query(`SELECT student_id, student_name, course_type, paid_status, total_hours,
        remaining_hours, hours_completed, DATE_FORMAT(new_bill_start, '%Y-%m-%d') AS new_bill_start,
        remarks, source_row_number
      FROM students WHERE student_id = ? AND student_name = ? LIMIT 1`, [studentId, studentName]);
    return rows[0] || null;
  }

  function page(rows, columns, limit, offset) {
    const total = rows.length;
    const selected = rows.slice(offset, offset + limit);
    return {
      columns,
      rows: selected,
      pagination: { limit, offset, total, next_offset: offset + selected.length < total ? offset + selected.length : null },
    };
  }

  return {
    handleOptions,
    async handle(request, response, url, readJson) {
      if (!url.pathname.startsWith('/api/sheets/')) return false;
      if (request.method === 'POST' && url.pathname === '/api/sheets/token') {
        if (jwtSecret.length < 32 || !clientId || !clientSecret || clientSecret.length < 32) {
          send(response, 503, { detail: 'Sheets token issuance is not configured' }, request);
          return true;
        }
        let body;
        try { body = await readJson(request); } catch {
          send(response, 422, { detail: 'Request body must be valid JSON' }, request);
          return true;
        }
        if (!safeEqual(body.client_id || '', clientId) || !safeEqual(body.client_secret || '', clientSecret)) {
          send(response, 401, { detail: 'Invalid client credentials' }, request);
          return true;
        }
        const expiresMinutes = body.expires_minutes === undefined ? 60 : Number(body.expires_minutes);
        if (!Number.isInteger(expiresMinutes) || expiresMinutes < 1 || expiresMinutes > 60) {
          send(response, 422, { detail: 'expires_minutes must be between 1 and 60' }, request);
          return true;
        }
        send(response, 200, {
          access_token: issueReadToken(clientId, jwtSecret, expiresMinutes),
          token_type: 'bearer',
          expires_in: expiresMinutes * 60,
        }, request);
        return true;
      }

      if (request.method !== 'GET' || !['/api/sheets/students', '/api/sheets/progress/latest'].includes(url.pathname)) {
        send(response, 404, { detail: 'Not found' }, request);
        return true;
      }
      if (!readClaims(request, response)) return true;

      const studentId = String(url.searchParams.get('student_id') || '').trim();
      const studentName = String(url.searchParams.get('student_name') || '').trim();
      const pagination = paginationFrom(url);
      if (!studentId || !studentName || !pagination) {
        send(response, 422, { detail: 'student_id and student_name are required; limit must be 1-500 and offset a non-negative integer' }, request);
        return true;
      }

      try {
        if (readSpreadsheet) {
          const sheets = await readSpreadsheet();
          const students = sheets.students || [];
          const matchingStudents = students.filter((row) =>
            stringValue(row.values['Student ID']).trim() === studentId
            && stringValue(row.values.Name).trim() === studentName);
          if (!matchingStudents.length) {
            send(response, 404, { detail: 'Student ID and name do not match a student' }, request);
            return true;
          }
          if (matchingStudents.length > 1) {
            send(response, 409, { detail: 'Student ID and name match multiple spreadsheet rows' }, request);
            return true;
          }

          const student = matchingStudents[0];
          if (url.pathname === '/api/sheets/students') {
            const row = {
              row_number: Number(student.row_number) || 2,
              values: STUDENT_COLUMNS.map((column) => column === 'New Bill Start'
                ? spreadsheetStudentDate(student.values[column])
                : stringValue(student.values[column])),
            };
            send(response, 200, { sheet_name: 'Students', ...page([row], STUDENT_COLUMNS, pagination.limit, pagination.offset) }, request);
            return true;
          }

          const typeBySheet = {
            'Robot Progress Log': 'Robot',
            'Coding Progress Log': 'Coding',
            'Math Progress Log': 'Math',
          };
          const progressRows = [];
          for (const sheet of sheets.progressLogs || []) {
            const fallbackCourseType = typeBySheet[sheet.sheet_name];
            for (const source of sheet.rows || []) {
              const values = source.values;
              if (stringValue(values['Student ID']).trim() !== studentId) continue;
              const recordDate = spreadsheetDate(values.Date);
              if (!recordDate) continue;
              const startTime = spreadsheetTime(values['Start Time']);
              const endTime = spreadsheetTime(values['End Time']);
              const lessonTime = startTime || endTime ? `${startTime}-${endTime}` : '';
              const courseType = stringValue(values['Course Type']).trim() || fallbackCourseType;
              if (!courseType) throw new Error(`Unsupported progress tab: ${sheet.sheet_name}`);
              progressRows.push({
                row_number: Number(source.row_number) || 0,
                record_date: recordDate,
                start_time_minutes: timeMinutes(values['Start Time']),
                course_type: courseType,
                values: [
                  recordDate,
                  studentId,
                  studentName,
                  '',
                  stringValue(student.values['Course type']),
                  '',
                  stringValue(values.Tutor),
                  courseType,
                  stringValue(values['Attendance Status']),
                  stringValue(values.Comment),
                  sheet.sheet_name === 'Coding Progress Log' ? stringValue(values.Progress)
                    : sheet.sheet_name === 'Math Progress Log' ? stringValue(values.Topic) : '',
                  stringValue(values.Remarks),
                  lessonTime,
                  sheet.sheet_name === 'Robot Progress Log' ? stringValue(values['Robot Name']) : '',
                  sheet.sheet_name === 'Robot Progress Log' ? stringValue(values['Progress Status']) : '',
                  sheet.sheet_name === 'Coding Progress Log' ? stringValue(values['Starting Level']) : '',
                  sheet.sheet_name === 'Coding Progress Log' ? stringValue(values['Ending Level']) : '',
                  '',
                ],
              });
            }
          }
          const rows = latestForCourseType(progressRows).map((entry) => ({
            row_number: entry.row_number,
            values: entry.values,
          }));
          send(response, 200, { sheet_name: 'Progress_Log', ...page(rows, PROGRESS_COLUMNS, pagination.limit, pagination.offset) }, request);
          return true;
        }

        const student = await findStudent(studentId, studentName);
        if (!student) {
          send(response, 404, { detail: 'Student ID and name do not match a student' }, request);
          return true;
        }
        if (url.pathname === '/api/sheets/students') {
          const row = {
            row_number: Number(student.source_row_number) || 2,
            values: [student.student_id, student.student_name, student.course_type, student.paid_status,
              student.total_hours, student.remaining_hours, student.hours_completed, student.new_bill_start, student.remarks].map(stringValue),
          };
          send(response, 200, {
            sheet_name: 'Students',
            ...page([row], STUDENT_COLUMNS, pagination.limit, pagination.offset),
          }, request);
          return true;
        }

        const progressRows = await query(`SELECT row_number, record_date, student_id, student_name, programme_id,
            programme_name, tutor_id, tutor_name, course_type, attendance_status, comment, progress, remarks,
            lesson_time, current_robot, robot_status, starting_level, finished_level, progress_percent
          FROM (
            SELECT e.row_number, e.record_date, e.student_id, s.student_name, e.programme_id, e.programme_name,
              e.tutor_id, e.tutor_name, e.course_type, e.attendance_status, e.comment, e.progress, e.remarks,
              e.lesson_time, e.current_robot, e.robot_status, e.starting_level, e.finished_level, e.progress_percent,
              ROW_NUMBER() OVER (PARTITION BY e.course_type ORDER BY e.record_date DESC, e.start_time DESC, e.row_number DESC) AS course_rank
            FROM progress_log_entries e JOIN students s ON s.student_id = e.student_id
            WHERE e.student_id = ?
          ) ranked WHERE course_rank = 1 ORDER BY course_type`, [studentId]);
        const rows = progressRows.map((entry) => ({
          row_number: Number(entry.row_number),
          values: [entry.record_date, entry.student_id, entry.student_name, entry.programme_id, entry.programme_name,
            entry.tutor_id, entry.tutor_name, entry.course_type, entry.attendance_status, entry.comment, entry.progress,
            entry.remarks, entry.lesson_time, entry.current_robot, entry.robot_status, entry.starting_level,
            entry.finished_level, entry.progress_percent].map(stringValue),
        }));
        send(response, 200, {
          sheet_name: 'Progress_Log',
          ...page(rows, PROGRESS_COLUMNS, pagination.limit, pagination.offset),
        }, request);
      } catch (error) {
        console.error(error);
        send(response, 503, { detail: 'Sheets data is unavailable' }, request);
      }
      return true;
    },
  };
}

module.exports = {
  createSheetsReadRouter,
  issueReadToken,
  verifyReadToken,
  spreadsheetDate,
  spreadsheetStudentDate,
  spreadsheetTime,
  STUDENT_COLUMNS,
  PROGRESS_COLUMNS,
};