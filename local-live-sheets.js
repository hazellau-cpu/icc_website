(function (root) {
  const id = (value) => String(value || '').trim().toUpperCase();
  const { typeForCourse: courseType } = typeof module !== 'undefined' && module.exports
    ? require('./local-calendar-mapping')
    : root.ICCLocalCalendar;
  const { robotNameKey } = typeof module !== 'undefined' && module.exports
    ? require('./local-pathways')
    : root.ICCLocalPathways;
  const personName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

  function preserveIncludedRobotStudents(roster, saved) {
    const included = roster.filter((student) => student.includeWhenUnpaid === true);
    if (included.some((student) => !id(student.studentId))
      || new Set(included.map((student) => id(student.studentId))).size !== included.length) {
      throw new Error('Local roster inclusions require unique student IDs.');
    }
    if (!saved.length) return roster;
    const result = saved.map((student) => {
      const { includeWhenUnpaid, ...rest } = student;
      return included.some((item) => id(item.studentId) === id(student.studentId))
        ? { ...rest, includeWhenUnpaid: true } : rest;
    });
    for (const student of included) {
      if (!result.some((item) => id(item.studentId) === id(student.studentId))) result.push(student);
    }
    return result;
  }

  function applyStarterBirthYears(students, records) {
    if (!Array.isArray(students) || !Array.isArray(records)) throw new Error('Invalid starter Sheet birth-year data.');
    const years = new Map();
    for (const record of records) {
      const studentId = id(record?.studentId);
      const year = String(record?.yearOfBirth ?? '').trim();
      if (!studentId || !/^\d{4}$/.test(year) || years.has(studentId)) {
        throw new Error('Invalid or duplicate starter Sheet birth-year record.');
      }
      years.set(studentId, year);
    }
    const matched = new Set();
    const result = students.map((student) => {
      const studentId = id(student.jamesStudentId);
      if (!years.has(studentId)) return student;
      if (matched.has(studentId)) throw new Error('Multiple Robot students have the same Sheet student ID.');
      matched.add(studentId);
      return { ...student, yob: years.get(studentId) };
    });
    return { students: result, unmatched: years.size - matched.size };
  }

  function filterRecordsFromDate(records, startDate, dateOf, { keepUndated = true } = {}) {
    const parsedStartDate = new Date(`${startDate}T00:00:00Z`);
    const validStartDate = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
      && !Number.isNaN(parsedStartDate.getTime())
      && parsedStartDate.toISOString().slice(0, 10) === startDate;
    if (!Array.isArray(records) || !validStartDate || typeof dateOf !== 'function' || typeof keepUndated !== 'boolean') {
      throw new Error('A record list, valid start date, and date selector are required.');
    }
    return records.filter((record) => {
      const date = String(dateOf(record) || '').trim();
      return date ? date >= startDate : keepUndated;
    });
  }

  function merge(state, sheets, { includeRobotProgressUpdate = () => true, robotProgrammeForStudent = (student) => student.program, lessonDate = (row) => row.Date, reviewMatchesCurrentRobot = () => false } = {}) {
    const lists = { Robot: 'robotStudents', Coding: 'codingStudents', Math: 'mathStudents' };
    const existing = Object.fromEntries(Object.entries(lists).map(([type, key]) => [type, state[key]]));
    const students = { Robot: [], Coding: [], Math: [] };
    const index = new Map();
    const legacyNames = new Map();
    const robotNameCounts = new Map();
    const sheetNames = new Map();
    for (const row of sheets.Students) {
      const studentId = id(row['Student ID']);
      const name = String(row.Name || '').trim();
      if (!studentId || !name) continue;
      if (!sheetNames.has(studentId)) sheetNames.set(studentId, new Set());
      sheetNames.get(studentId).add(name);
    }
    const knownName = (studentId) => {
      const names = sheetNames.get(id(studentId));
      return names?.size === 1 ? [...names][0] : '';
    };
    for (const student of existing.Robot) {
      const name = personName(student.name);
      if (name) robotNameCounts.set(name, (robotNameCounts.get(name) || 0) + 1);
    }
    let unmatchedStudents = 0;
    const warningDetails = { students: [], lessons: [], robots: [] };
    for (const row of sheets.Students) {
      const paid = String(row['Paid Status']).trim().toLowerCase() === 'paid';
      const studentId = id(row['Student ID']);
      const type = courseType(row['Course type']);
      if (!paid && (!studentId || type !== 'Robot'
        || !existing.Robot.some((student) => student.includeWhenUnpaid === true && id(student.jamesStudentId || student.studentId) === studentId))) continue;
      if (!studentId || !row.Name || !type) throw new Error('A paid student has a missing ID, name, or unsupported course.');
      const key = `${type}:${studentId}`;
      if (index.has(key)) throw new Error('The Sheet contains duplicate paid student IDs for the same course.');
      const matches = existing[type].filter((student) => id(student.jamesStudentId || student.studentId) === studentId);
      if (matches.length > 1) throw new Error('The local roster contains duplicate IDs for the same course.');
      const original = matches[0];
      if (!original) {
        unmatchedStudents += 1;
        warningDetails.students.push({ studentId: row['Student ID'], name: row.Name, course: row['Course type'] });
      }
      const student = {
        ...original,
        name: String(row.Name).trim(),
        studentId: original?.studentId || String(row['Student ID']).trim(),
        jamesStudentId: String(row['Student ID']).trim(),
        studentType: type,
        paidStatus: row['Paid Status'],
        ...(type === 'Robot' ? { program: original?.program || row['Course type'] } : { course: row['Course type'] }),
        jamesData: { ...row },
        sourceRow: { ...original?.sourceRow, ...row },
      };
      students[type].push(student);
      index.set(key, student);
      if (type === 'Robot' && original && robotNameCounts.get(personName(original.name)) === 1) {
        legacyNames.set(student, personName(original.name));
      }
    }
    let unmatchedLogs = 0;
    let unmatchedRobots = 0;
    const lessons = { Robot: [], Coding: [], Math: [] };
    const robotUpdates = [];
    for (const type of Object.keys(lists)) {
      for (const row of sheets[`${type} Progress Log`]) {
        if (!id(row['Student ID'])) continue;
        const student = index.get(`${type}:${id(row['Student ID'])}`);
        if (!student) {
          unmatchedLogs += 1;
          warningDetails.lessons.push({
            date: row.Date, studentId: row['Student ID'], name: knownName(row['Student ID']),
            course: type, robot: row['Robot Name'] || '', status: row['Progress Status'] || '',
            reason: `No paid ${type} student matches this ID.`,
          });
          continue;
        }
        const sourceRow = {
          ...row,
          'Lesson Date': row.Date,
          'Student ID': row['Student ID'],
          Student: student.name,
          'Tutor Name': row.Tutor,
          Progress: row.Progress || row.Topic || '',
          'Current Robot': row['Robot Name'] || '',
          'Robot Status': row['Progress Status'] || '',
          "Today's Starting Level": row['Starting Level'] ?? '',
          "Today's Finished Level": row['Ending Level'] ?? '',
        };
        const field = type === 'Robot' ? 'Student name' : `Student (${type})`;
        lessons[type].push({ studentId: student.studentId, [field]: student.name, 'Lesson time': row.Date, Tutor: row.Tutor, Remarks: row.Remarks, sourceRow });
        if (type === 'Robot' && row['Robot Name'] && row['Progress Status']) robotUpdates.push({ student, row });
      }
    }
    robotUpdates.sort((a, b) => `${a.row.Date} ${a.row['Start Time']}`.localeCompare(`${b.row.Date} ${b.row['Start Time']}`));
    const progress = state.robotProgress.map((row) => ({ ...row }));
    for (const { student, row } of robotUpdates) {
      if (!includeRobotProgressUpdate(student, row)) continue;
      const status = String(row['Progress Status']).trim().toLowerCase();
      const mappedStatus = /^(finished|done|completed)$/.test(status) ? 'Done' : /^(in progress|ongoing)$/.test(status) ? 'In progress' : /^(not started|unfinished)$/.test(status) ? 'Not started' : '';
      const matches = progress.filter((item) => {
        const progressId = id(item.studentId || item.sourceRow?.['Student ID']);
        const sameStudent = progressId
          ? progressId === id(student.studentId) || progressId === id(student.jamesStudentId)
          : legacyNames.has(student) && [item.Student, item['Student (linked)']].some((name) => personName(name) === legacyNames.get(student));
        const programme = robotProgrammeForStudent(student);
        return sameStudent && robotNameKey(item.Robot, programme) === robotNameKey(row['Robot Name'], programme);
      });
      if (mappedStatus && !matches.length) {
        const programme = robotProgrammeForStudent(student);
        const date = lessonDate(row);
        const parsedDate = new Date(`${date}T00:00:00Z`);
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsedDate.getTime())
          && parsedDate.toISOString().slice(0, 10) === date;
        const reviews = (state.robotProgressReviews || []).filter((review) => id(review.studentId) === id(student.studentId)
          && String(review.programme).replace(/_/g, ' ').trim().toLowerCase() === String(programme).replace(/_/g, ' ').trim().toLowerCase()
          && review.status !== 'Unknown' && validDate && review.reviewedOn >= date && reviewMatchesCurrentRobot(student, review)
          && [review.robot, review.displayRobot].some((name) => name && robotNameKey(name, programme) === robotNameKey(row['Robot Name'], programme)));
        if (reviews.length === 1) continue;
      }
      if (!mappedStatus || matches.length !== 1) {
        unmatchedRobots += 1;
        const reasons = [];
        if (!mappedStatus) reasons.push('Unrecognized progress status');
        if (!matches.length) reasons.push('No matching robot progress record');
        if (matches.length > 1) reasons.push('Multiple matching robot progress records');
        warningDetails.robots.push({
          date: row.Date, studentId: row['Student ID'], name: student.name,
          robot: row['Robot Name'], status: row['Progress Status'], reason: reasons.join('; '),
        });
        continue;
      }
      matches[0].Status = mappedStatus;
    }
    for (const student of students.Coding) {
      const latest = lessons.Coding.filter((lesson) => id(lesson.studentId) === id(student.studentId) && lesson.sourceRow["Today's Finished Level"] !== '')
        .sort((a, b) => `${b.sourceRow.Date} ${b.sourceRow['Start Time']}`.localeCompare(`${a.sourceRow.Date} ${a.sourceRow['Start Time']}`))[0];
      if (latest) student.sourceRow["Today's Finished Level"] = latest.sourceRow["Today's Finished Level"];
    }
    return {
      robotStudents: students.Robot, codingStudents: students.Coding, mathStudents: students.Math,
      robotLessons: lessons.Robot, codingLessons: lessons.Coding, mathLessons: lessons.Math,
      robotProgress: progress,
      warnings: { unmatchedStudents, unmatchedLogs, unmatchedRobots },
      warningDetails,
    };
  }
  const api = { merge, preserveIncludedRobotStudents, filterRecordsFromDate, applyStarterBirthYears };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICCLocalLiveSheets = api;
})(globalThis);
