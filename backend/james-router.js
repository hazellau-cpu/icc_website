const crypto = require('node:crypto');

function normalizeRobotText(value) {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalized === 'cannonbot' ? 'cannobot' : normalized;
}

function editDistance(left, right) {
  const matrix = Array.from({ length: left.length + 1 }, (_, row) => [row]);
  for (let column = 1; column <= right.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return matrix[left.length][right.length];
}

function createJamesRouter({ query, jwtSecret, storage = null }) {
  const persistence = storage || {
    async getStudent(studentId) {
      const students = await query(`SELECT s.student_id, s.student_name, s.programme_id, p.programme_name
        FROM students s JOIN programmes p ON p.programme_id = s.programme_id WHERE s.student_id = ? LIMIT 1`, [studentId]);
      return students[0] || null;
    },
    getRobots(programmeId) {
      return query(`SELECT robot_id, programme_id, robot_name, sequence_number
        FROM robot_library_items WHERE programme_id = ? ORDER BY sequence_number`, [programmeId]);
    },
    async recordReview(approval, checked, request, body) {
      await query(`INSERT INTO student_robot_progress (student_id, programme_id, robot_name, sequence_number, status, notes)
        VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE sequence_number = VALUES(sequence_number), status = VALUES(status), notes = VALUES(notes)`, [approval.studentId, checked.student.programme_id, checked.canonicalRobot, checked.robot.sequence_number, approval.status, approval.notes || null]);
      await query(`INSERT INTO robot_progress_reviews (student_id, programme_id, robot_id, submitted_name, canonical_name, status, decision, reviewed_by, source)
        VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`, [approval.studentId, checked.student.programme_id, checked.robot.robot_id, checked.inputName, checked.canonicalRobot, approval.status, request.headers['x-user-id'] || 'authenticated-user', body.source || 'james-api']);
    },
  };
  const signApproval = (payload) => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', jwtSecret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  };

  const verifyApproval = (token) => {
    if (!token) return null;
    const [encoded, supplied] = String(token).split('.');
    if (!encoded || !supplied) return null;
    const expected = crypto.createHmac('sha256', jwtSecret).update(encoded).digest('base64url');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
    } catch { return null; }
  };

  async function validateRobotProgress(body) {
    const studentId = String(body.student_id || body.studentId || '').trim();
    const inputName = String(body.robot_name || body.robot || body['Robot Name'] || '').trim();
    const rawStatus = String(body.status || body.Status || '').trim().toLowerCase();
    const notes = String(body.notes || '').trim().slice(0, 2000);
    const status = rawStatus === 'finished' ? 'Finished' : rawStatus === 'in progress' || rawStatus === 'in_progress' ? 'In progress' : '';
    if (!studentId || !inputName || !status) return { accepted: false, reasons: ['student_id, robot_name, and status are required; status must be Finished or In progress.'] };
    const student = await persistence.getStudent(studentId);
    if (!student) return { accepted: false, reasons: ['Student was not found.'] };
    const robots = await persistence.getRobots(student.programme_id);
    if (!robots.length) return { accepted: false, reasons: ['The student programme has no Robot Library template.'], student };
    const normalizedInput = normalizeRobotText(inputName);
    const exact = robots.filter((robot) => normalizeRobotText(robot.robot_name) === normalizedInput);
    let matches = exact;
    if (!matches.length) {
      const scored = robots.map((robot) => ({ robot, distance: editDistance(normalizedInput, normalizeRobotText(robot.robot_name)) })).sort((left, right) => left.distance - right.distance);
      const best = scored[0];
      const limit = Math.max(1, Math.floor(normalizedInput.length * 0.2));
      if (best && best.distance <= limit) matches = scored.filter((entry) => entry.distance === best.distance).map((entry) => entry.robot);
    }
    if (matches.length !== 1) return { accepted: false, reasons: [matches.length ? 'Robot name is ambiguous.' : 'Robot name did not match the student programme.'], student, inputName, suggestions: robots.map((robot) => robot.robot_name).slice(0, 10) };
    const robot = matches[0];
    const payload = { studentId, robotId: robot.robot_id, robotName: robot.robot_name, status, notes, issuedAt: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 };
    return { accepted: true, student, inputName, canonicalRobot: robot.robot_name, robot, status, notes, approval_token: signApproval(payload) };
  }

  return {
    async handle(request, response, url, readJson, send) {
      if (request.method === 'POST' && url.pathname === '/robot-progress/preview') {
        send(response, 200, await validateRobotProgress(await readJson(request)));
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/robot-progress/accept') {
        const body = await readJson(request);
        const approval = verifyApproval(body.approval_token);
        if (!approval) { send(response, 401, { detail: 'Invalid or expired approval token' }); return true; }
        const checked = await validateRobotProgress({ student_id: approval.studentId, robot_name: approval.robotName, status: approval.status, notes: approval.notes });
        if (!checked.accepted || checked.robot.robot_id !== approval.robotId) { send(response, 409, { detail: 'The approved Robot Library record is no longer current. Preview again.' }); return true; }
        await persistence.recordReview(approval, checked, request, body);
        send(response, 200, { accepted: true, student_id: approval.studentId, programme_id: checked.student.programme_id, robot_name: checked.canonicalRobot, sequence: checked.robot.sequence_number, status: approval.status });
        return true;
      }
      return false;
    },
  };
}

module.exports = { createJamesRouter };
