(function (root) {
  const normalizeId = (value) => String(value || '').trim().toUpperCase();
  const typeForCourse = (value) => {
    const course = String(value || '').trim();
    if (/^(aikiro|robokit|uaro|robot)/i.test(course)) return 'Robot';
    if (/^(cs\d|coding|codemonkey|code\s*combat)/i.test(course)) return 'Coding';
    if (/^math/i.test(course)) return 'Math';
    return '';
  };
  function timeLabel(event) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(event.start) && /^\d{4}-\d{2}-\d{2}$/.test(event.end)) return 'All day';
    const start = new Date(event.start);
    const end = new Date(event.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 'Time unavailable';
    const format = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false });
    return `${format.format(start)} - ${format.format(end)}`;
  }
  function matchEvents(events, state) {
    const lists = { Robot: state.robotStudents, Coding: state.codingStudents, Math: state.mathStudents };
    const matched = [];
    const unmatched = [];
    for (const event of events) {
      const type = typeForCourse(event.course);
      const studentId = normalizeId(event.studentId);
      const students = type && studentId ? lists[type].filter((student) => normalizeId(student.jamesStudentId || student.studentId) === studentId) : [];
      const nameIsAmbiguous = students.length === 1 && lists[type].filter((student) => String(student.name || '').trim().toLowerCase() === String(students[0].name || '').trim().toLowerCase()).length !== 1;
      if (!event.id || !type || !studentId || students.length !== 1 || nameIsAmbiguous) {
        unmatched.push({ ...event, reason: !event.id ? 'Missing event ID' : !studentId ? 'Missing student ID' : !type ? 'Unknown course' : students.length !== 1 ? students.length ? 'Ambiguous student ID' : 'Student not in paid roster' : 'Ambiguous student name' });
        continue;
      }
      matched.push({ event, type, student: students[0], lessonTime: timeLabel(event) });
    }
    return { matched, unmatched };
  }
  const api = { timeLabel, matchEvents, typeForCourse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICCLocalCalendar = api;
})(globalThis);
