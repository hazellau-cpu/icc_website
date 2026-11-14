(function (root) {
  const key = 'icc-student-pathways-v1';
  const types = new Set(['Robot', 'Coding', 'Math']);
  const identity = (value) => String(value || '').trim().toUpperCase();
  const isDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const normaliseProgramme = (value) => String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  function codingCurriculumProgramme(value) {
    const programme = String(value || '').trim();
    const match = programme.match(/^code\s*combat\s*(?:lv\.?|level|cs)?\s*(\d+)$/i);
    return match ? `CS${Number(match[1])}` : programme;
  }
  function robotNameKey(value, programme) {
    const name = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
    if (/^robokit\s*lv\s*3\b/i.test(String(programme || '').trim()) && ['gunbot', 'cannobot', 'cannonbot'].includes(name)) return 'gunbot';
    if (normaliseProgramme(programme) === 'aikiro lv1 additional' && ['robotfighter', 'robotwrestler'].includes(name)) return 'robotwrestler';
    return name.replace('cannonbot', 'cannobot');
  }

  function reconcileRobotProgress(programme, template, progress, student) {
    const used = new Set();
    const rows = template.map((item) => {
      const matches = progress.filter((row) => robotNameKey(row.Robot, programme) === robotNameKey(item['Robot name'], programme));
      matches.forEach((row) => used.add(row));
      const source = matches.length === 1 ? matches[0] : null;
      return {
        ...(source || { Student: student.name, studentId: student.studentId, Status: 'Not started' }),
        Robot: item['Robot name'], Sequence: item.Sequence, Level: item.Level,
        sourceProgress: source,
        conflict: matches.length > 1,
        ...(matches.length > 1 ? { Status: 'Needs review' } : {}),
      };
    });
    return { rows, retired: progress.filter((row) => !used.has(row)), conflicts: progress.filter((row) => used.has(row) && rows.some((item) => item.conflict && robotNameKey(item.Robot, programme) === robotNameKey(row.Robot, programme))) };
  }

  function reviewedRobotPathway(saved, review) {
    if (!review) return saved;
    if (saved && normaliseProgramme(saved.programme) === normaliseProgramme(review.programme)) {
      return saved.startedOn ? saved : { ...saved, startedOn: review.reviewedOn, reviewed: true };
    }
    if (saved?.startedOn && saved.startedOn >= review.reviewedOn) return saved;
    return { courseType: 'Robot', studentId: review.studentId, programme: review.programme, startedOn: review.reviewedOn, history: saved?.history || [], reviewed: true };
  }

  function reviewedRobotSequence(template, pathway, review) {
    if (!review?.robotSequence || !pathway?.startedOn || pathway.startedOn > review.reviewedOn
      || normaliseProgramme(pathway.programme) !== normaliseProgramme(review.programme)) return template;
    return review.robotSequence.map((name, index) => ({
      'Programme Name': review.programme, 'Robot name': name, Sequence: String(index + 1), Level: template[0]?.Level,
    }));
  }

  function validateRobotReviews(pathways, progress) {
    const validBase = (item) => item && typeof item.studentId === 'string' && item.studentId.trim()
      && typeof item.programme === 'string' && item.programme.trim() && isDate(item.reviewedOn);
    if (!Array.isArray(pathways) || !Array.isArray(progress) || pathways.some((item) => !validBase(item)
      || (item.hidePreviousTrackerProgress !== undefined && typeof item.hidePreviousTrackerProgress !== 'boolean')
      || (item.robotSequence !== undefined && (!Array.isArray(item.robotSequence) || !item.robotSequence.length
        || item.robotSequence.some((name) => typeof name !== 'string' || !name.trim())
        || new Set(item.robotSequence.map((name) => robotNameKey(name, item.programme))).size !== item.robotSequence.length)))
      || progress.some((item) => !validBase(item) || typeof item.robot !== 'string' || !item.robot.trim()
        || !['Done', 'In progress', 'Not started', 'Unknown'].includes(item.status)
        || (item.displayRobot !== undefined && (typeof item.displayRobot !== 'string' || !item.displayRobot.trim())))) {
      throw new Error('Reviewed robot data is invalid.');
    }
    const pathwayKeys = pathways.map((item) => identity(item.studentId));
    const progressKeys = progress.map((item) => `${identity(item.studentId)}:${normaliseProgramme(item.programme)}:${robotNameKey(item.robot, item.programme)}`);
    if (new Set(pathwayKeys).size !== pathwayKeys.length || new Set(progressKeys).size !== progressKeys.length) {
      throw new Error('Reviewed robot data contains duplicate entries.');
    }
  }

  function applyRobotReviews(rows, reviews, programme, lessons) {
    return rows.map((row) => {
      const matches = reviews.filter((review) => normaliseProgramme(review.programme) === normaliseProgramme(programme)
        && robotNameKey(review.robot, programme) === robotNameKey(row.Robot, programme));
      if (matches.length > 1) throw new Error('Duplicate reviewed robot progress.');
      if (!matches.length) return row;
      const review = matches[0];
      const names = [review.robot, review.displayRobot || review.robot].map((name) => robotNameKey(name, programme));
      const later = lessons.filter((lesson) => isDate(lesson.date) && lesson.date > review.reviewedOn
        && names.includes(robotNameKey(lesson.robot, programme)) && ['Done', 'In progress', 'Not started'].includes(lesson.status))
        .sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`)).at(-1);
      return { ...row, sourceProgress: row.sourceProgress || row, Robot: review.displayRobot || row.Robot, Status: later?.status || review.status, reviewedProgress: !later };
    });
  }

  function applyRobotProgressRemovals(rows, removals, storage) {
    const validLegacy = (legacy) => legacy === undefined || (legacy && typeof legacy.studentName === 'string'
      && legacy.studentName.trim() && typeof legacy.level === 'string' && legacy.level.trim()
      && Array.isArray(legacy.robots) && legacy.robots.length > 0
      && legacy.robots.every((robot) => typeof robot === 'string' && robot.trim()));
    if (!Array.isArray(rows) || !Array.isArray(removals) || removals.some((item) =>
      !item || typeof item.studentId !== 'string' || !item.studentId.trim()
      || typeof item.programmeId !== 'string' || !item.programmeId.trim()
      || typeof item.version !== 'string' || !/^[a-zA-Z0-9-]+$/.test(item.version)
      || !validLegacy(item.legacy))
      || new Set(removals.map((item) => item.version)).size !== removals.length) {
      throw new Error('Robot progress removal data is invalid.');
    }
    let result = rows;
    for (const removal of removals) {
      const marker = `icc-robot-progress-removal-${removal.version}`;
      if (storage.getItem(marker) === 'done') continue;
      const keep = (row) => {
        const ids = [row.studentId, row.sourceRow?.['Student ID']].filter((value) => identity(value));
        const sameStudent = ids.length > 0 && ids.every((value) => identity(value) === identity(removal.studentId));
        const programmeId = row.sourceRow?.['Programme ID'] || row['Programme ID'] || row.programme_id;
        if (programmeId) return !sameStudent || identity(programmeId) !== identity(removal.programmeId);
        const legacy = removal.legacy;
        if (!legacy) return true;
        const names = [row.Student, row['Student (linked)']].filter((value) => identity(value));
        const sameName = names.length > 0 && names.every((value) => identity(value) === identity(legacy.studentName));
        const sameLevel = identity(row.Level).replace(/^LV\s*/, '') === identity(legacy.level).replace(/^LV\s*/, '');
        const sameRobot = legacy.robots.some((robot) => robotNameKey(robot, '') === robotNameKey(row.Robot, ''));
        return !(sameName && ids.every((value) => identity(value) === identity(removal.studentId)) && sameLevel && sameRobot);
      };
      const raw = storage.getItem('icc-robot-progress');
      if (raw !== null) {
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved)) throw new Error('Saved robot progress is invalid.');
        const filtered = saved.filter(keep);
        if (filtered.length !== saved.length) storage.setItem('icc-robot-progress', JSON.stringify(filtered));
      }
      result = result.filter(keep);
      storage.setItem(marker, 'done');
    }
    return result;
  }

  function read(storage) {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    const records = JSON.parse(raw);
    if (!Array.isArray(records) || records.some((record) =>
      !record || !types.has(record.courseType) || typeof record.studentId !== 'string' || !record.studentId.trim()
      || typeof record.programme !== 'string' || !record.programme.trim()
      || (record.startedOn !== null && !isDate(record.startedOn))
      || !Array.isArray(record.history)
      || record.history.some((entry) => !entry || typeof entry.programme !== 'string' || !entry.programme.trim() || !isDate(entry.endedOn)))) {
      throw new Error('Saved pathway data is invalid.');
    }
    const identities = records.map((record) => `${record.courseType}:${identity(record.studentId)}`);
    if (new Set(identities).size !== identities.length) throw new Error('Saved pathway data contains duplicate students.');
    return records;
  }

  function find(records, courseType, studentId) {
    return records.find((record) => record.courseType === courseType && identity(record.studentId) === identity(studentId));
  }

  function update(records, { courseType, studentId, programme, previousProgramme, date }) {
    const cleanId = String(studentId || '').trim();
    const cleanProgramme = String(programme || '').trim();
    if (!types.has(courseType) || !cleanId || !cleanProgramme || cleanProgramme.length > 100 || !isDate(date)) {
      throw new Error('A student ID, valid programme, and date are required.');
    }
    const current = find(records, courseType, cleanId);
    const previous = current?.programme || String(previousProgramme || '').trim();
    const comparable = (value) => normaliseProgramme(courseType === 'Coding' ? codingCurriculumProgramme(value) : value);
    if (current && comparable(previous) === comparable(cleanProgramme)) return records;
    const changed = Boolean(previous && comparable(previous) !== comparable(cleanProgramme));
    const history = [...(current?.history || [])];
    if (changed) history.push({ programme: previous, endedOn: date });
    const record = {
      courseType, studentId: cleanId, programme: cleanProgramme,
      startedOn: changed ? date : current?.startedOn || null, history,
    };
    return [...records.filter((item) => item !== current), record];
  }

  function afterPathwayChange(date, pathway) {
    return Boolean(pathway?.startedOn && isDate(date) && date > pathway.startedOn);
  }

  function write(storage, records) {
    storage.setItem(key, JSON.stringify(records));
  }

  const api = { read, find, update, afterPathwayChange, codingCurriculumProgramme, robotNameKey, reconcileRobotProgress, reviewedRobotPathway, reviewedRobotSequence, validateRobotReviews, applyRobotReviews, applyRobotProgressRemovals, write };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ICCLocalPathways = api;
})(globalThis);
