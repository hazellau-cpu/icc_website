const crypto = require('node:crypto');
const { merge: mergeLiveSheets } = require('../local-live-sheets');
const pathways = require('../local-pathways');
const { sheetsForWorkspace } = require('./google-sheets');
const { STATE_KEYS, WorkspaceConflictError } = require('./sheets-workspace-store');

const normalize = (value) => String(value || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const studentId = (value) => String(value || '').trim().toUpperCase();
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const arrayValue = (edits, key, fallback = []) => {
  const value = Object.hasOwn(edits, key) ? edits[key].value : fallback;
  if (!Array.isArray(value)) throw new Error(`Saved ${key} data must be an array`);
  return value;
};
const inventoryFor = (libraries, edits) => arrayValue(edits, 'inventory', libraries.inventory.map((component) => ({
  ...component, inventory_id: `INV-${component['Component ID']}`, 'Total center qty': '', 'Last counted': '', Notes: '',
})));

function buildWorkspace(libraries, edits, sheetData) {
  const savedPathways = Object.hasOwn(edits, 'student-pathways') ? edits['student-pathways'].value : [];
  const validatedPathways = pathways.read({ getItem: () => JSON.stringify(savedPathways) });
  const empty = { robotStudents: [], codingStudents: [], mathStudents: [], robotProgress: [] };
  const sheets = sheetsForWorkspace(sheetData);
  const roster = mergeLiveSheets(empty, sheets);
  for (const [type, key] of [['Robot', 'robotStudents'], ['Coding', 'codingStudents'], ['Math', 'mathStudents']]) {
    roster[key] = roster[key].map((student) => {
      const pathway = pathways.find(validatedPathways, type, student.studentId);
      return pathway ? { ...student, ...(type === 'Robot' ? { program: pathway.programme } : { course: pathway.programme }) } : student;
    });
  }
  const inventory = inventoryFor(libraries, edits);
  const robotProgress = [];
  const componentItems = [];
  for (const student of roster.robotStudents) {
    const programme = student.program;
    const pathway = pathways.find(validatedPathways, 'Robot', student.studentId);
    const template = libraries.robots.filter((row) => normalize(row['Programme Name']) === normalize(programme));
    for (const row of template) {
      robotProgress.push({
        studentId: student.studentId, Student: student.name, Robot: row['Robot name'],
        Sequence: row.Sequence, Level: row.Level, Status: pathway?.startedOn ? 'Not started' : 'Unknown',
        sourceRow: { 'Student ID': student.studentId, 'Programme ID': row['Programme ID'] },
      });
    }
    const match = String(programme || '').match(/^(AIKIRO|UARO|ROBOKIT)\s+Lv(\d+)/i);
    if (!match) continue;
    const kit = match[1].toUpperCase();
    const level = Number(match[2]);
    for (const component of libraries.inventory) {
      const componentKit = String(component.Kit || '').toUpperCase().replace(/^URAO$/, 'UARO');
      const required = Number(component[`Lv${level} total`]);
      if (componentKit !== kit || !Number.isFinite(required) || required <= 0) continue;
      componentItems.push({
        studentId: student.studentId, student: student.name, item: component.Component,
        componentId: component['Component ID'], kit, tier: component.Tier || '', level: `Lv${level}`,
        requiredQty: String(required), studentQty: '', quantityStatus: 'Missing',
        sourceRow: { 'Student ID': student.studentId, 'Component ID': component['Component ID'], Notes: '' },
      });
    }
  }
  const base = { ...empty, ...roster, robotProgress };
  const live = mergeLiveSheets(base, sheets, {
    includeRobotProgressUpdate: (student, row) => {
      const pathway = pathways.find(validatedPathways, 'Robot', student.studentId);
      return !pathway?.startedOn || pathways.afterPathwayChange(row.Date, pathway);
    },
  });
  const acceptedReviews = arrayValue(edits, 'robot-progress-reviews');
  if (acceptedReviews.some((review) => !review || typeof review.studentId !== 'string' || typeof review.programme !== 'string'
    || typeof review.robot !== 'string' || !['Done', 'In progress'].includes(review.status)
    || !validDate(review.reviewedOn) || !Number.isFinite(Date.parse(review.acceptedAt)))) {
    throw new Error('Saved robot progress reviews are invalid');
  }
  const currentReviews = [];
  for (const student of live.robotStudents) {
    const pathway = pathways.find(validatedPathways, 'Robot', student.studentId);
    const latest = new Map();
    for (const review of acceptedReviews.filter((item) => studentId(item.studentId) === studentId(student.studentId)
      && normalize(item.programme) === normalize(student.program)
      && (!pathway?.startedOn || item.reviewedOn > pathway.startedOn))) {
      const key = pathways.robotNameKey(review.robot, review.programme);
      if (!latest.has(key) || String(review.acceptedAt) > String(latest.get(key).acceptedAt)) latest.set(key, review);
    }
    if (!latest.size) continue;
    currentReviews.push(...latest.values());
    const lessons = live.robotLessons.filter((lesson) => studentId(lesson.studentId) === studentId(student.studentId))
      .map((lesson) => ({
        date: lesson.sourceRow.Date, time: lesson.sourceRow['Start Time'], robot: lesson.sourceRow['Robot Name'],
        status: /^(finished|done|completed)$/i.test(String(lesson.sourceRow['Progress Status'])) ? 'Done'
          : /^(in progress|ongoing)$/i.test(String(lesson.sourceRow['Progress Status'])) ? 'In progress'
            : /^(not started|unfinished)$/i.test(String(lesson.sourceRow['Progress Status'])) ? 'Not started' : '',
      }));
    const rows = live.robotProgress.filter((row) => studentId(row.studentId) === studentId(student.studentId));
    const updated = pathways.applyRobotReviews(rows, [...latest.values()], student.program, lessons);
    let index = 0;
    live.robotProgress = live.robotProgress.map((row) => studentId(row.studentId) === studentId(student.studentId) ? updated[index++] : row);
  }
  return {
    ...live,
    storageMode: 'sheets',
    robotPrograms: libraries.robotPrograms,
    curriculum: libraries.curriculum,
    robots: libraries.robots,
    componentLibrary: libraries.componentLibrary,
    robotProgressReviews: currentReviews,
    inventory, centerInventory: inventory,
    componentItems,
    borrowings: arrayValue(edits, 'borrowings'),
    codingProgress: [], files: [], reminders: [],
    dailyLessonDrafts: [], dailyLessonFinalizations: [],
    sharedEdits: edits,
  };
}

function createSheetsWorkspaceRouter({ store, readSpreadsheet, applyDemographics = async (workspace) => workspace }) {
  async function bootstrap() {
    const [{ libraries, edits }, sheets] = await Promise.all([store.read(), readSpreadsheet()]);
    return applyDemographics(buildWorkspace(libraries, edits, sheets));
  }
  async function updateCollection(key, change, actor) {
    const { edits, libraries } = await store.read();
    const existing = key === 'inventory' ? inventoryFor(libraries, edits) : arrayValue(edits, key);
    const result = change(existing, libraries);
    await store.update(key, result.rows, edits[key]?.version || 0, actor);
    return result.value;
  }
  const fail = (status, detail) => { const error = new Error(detail); error.statusCode = status; throw error; };
  const jamesStorage = {
    async getStudent(id) {
      const workspace = await bootstrap();
      const matches = workspace.robotStudents.filter((student) => studentId(student.studentId) === studentId(id));
      if (matches.length !== 1) return null;
      const student = matches[0];
      const programme = workspace.robotPrograms.find((row) => normalize(row.programme_name || row.Program) === normalize(student.program));
      return { student_id: student.studentId, student_name: student.name, programme_id: programme?.programme_id || '', programme_name: student.program };
    },
    async getRobots(programmeId) {
      const { libraries } = await store.read();
      return libraries.robots.filter((row) => row['Programme ID'] === programmeId).map((row) => ({
        robot_id: row.item_id || `${programmeId}:${row.Sequence}`, programme_id: programmeId,
        robot_name: row['Robot name'], sequence_number: row.Sequence,
      }));
    },
    async recordReview(approval, checked, request, body) {
      const acceptedAt = new Date().toISOString();
      const reviewedOn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
      const review = {
        studentId: approval.studentId, programme: checked.student.programme_name, robot: checked.canonicalRobot,
        status: approval.status === 'Finished' ? 'Done' : approval.status, notes: approval.notes,
        reviewedOn, acceptedAt, reviewedBy: request.authenticatedUser.email, source: String(body.source || 'james-api').slice(0, 100),
      };
      await updateCollection('robot-progress-reviews', (rows) => ({ rows: [...rows, review], value: review }), request.authenticatedUser.email);
    },
  };

  async function handle(request, response, url, readJson, send) {
    const method = request.method;
    const path = url.pathname;
    const actor = request.authenticatedUser.email;
    if (method === 'GET' && path === '/workspace/bootstrap') {
      send(response, 200, await bootstrap());
      return true;
    }
    const edit = path.match(/^\/workspace\/edits\/([a-z0-9-]+)$/);
    if (method === 'PUT' && edit) {
      const key = edit[1];
      if (!STATE_KEYS.includes(key) || ['inventory', 'borrowings', 'robot-progress-reviews'].includes(key)) {
        send(response, 404, { detail: 'Shared workspace edit not found' });
        return true;
      }
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0 || !Object.hasOwn(body, 'value')
        || (key === 'progress-finish-dates' ? !body.value || typeof body.value !== 'object' || Array.isArray(body.value) : !Array.isArray(body.value))) {
        send(response, 400, { detail: 'Invalid shared workspace edit' });
        return true;
      }
      if (key === 'student-pathways') {
        try { pathways.read({ getItem: () => JSON.stringify(body.value) }); }
        catch { fail(400, 'Invalid student pathways'); }
      }
      if (Buffer.byteLength(JSON.stringify(body.value)) > 512 * 1024) {
        send(response, 413, { detail: 'Shared workspace edit is too large' });
        return true;
      }
      send(response, 200, await store.update(key, body.value, body.expected_version, actor));
      return true;
    }
    const staticRoutes = {
      '/programmes': ['programmes', 'robotPrograms'],
      '/curriculum': ['curriculum', 'curriculum'],
      '/robots': ['robots', 'robots'],
      '/components': ['components', 'componentLibrary'],
    };
    if (method === 'GET' && staticRoutes[path]) {
      const { libraries } = await store.read();
      const [responseKey, dataKey] = staticRoutes[path];
      send(response, 200, { [responseKey]: libraries[dataKey] });
      return true;
    }
    if (method === 'GET' && ['/centre-inventory', '/borrowings'].includes(path)) {
      const { libraries, edits } = await store.read();
      send(response, 200, path === '/centre-inventory'
        ? { items: inventoryFor(libraries, edits) } : { borrowings: arrayValue(edits, 'borrowings') });
      return true;
    }
    const simple = {
      '/robot-lessons': ['lessons', 'robotLessons'],
      '/coding-lessons': ['lessons', 'codingLessons'],
    };
    if (method === 'GET' && simple[path]) {
      const workspace = await bootstrap();
      const [responseKey, dataKey] = simple[path];
      send(response, 200, { [responseKey]: workspace[dataKey] });
      return true;
    }
    if (method === 'GET' && path === '/students') {
      const workspace = await bootstrap();
      send(response, 200, { students: [...workspace.robotStudents, ...workspace.codingStudents, ...workspace.mathStudents].map((student) => student.sourceRow) });
      return true;
    }
    const inventoryMatch = path.match(/^\/centre-inventory\/([^/]+)$/);
    if (method === 'POST' && path === '/centre-inventory') {
      const body = await readJson(request);
      const componentId = body?.component_id || body?.['Component ID'];
      if (!componentId) fail(400, 'component_id is required');
      const created = await updateCollection('inventory', (rows, library) => {
        const component = library.inventory.find((item) => item['Component ID'] === componentId);
        if (!component) fail(400, 'Unknown component');
        if (rows.some((item) => item['Component ID'] === componentId)) fail(409, 'Inventory item already exists');
        const quantity = Number(body['Total center qty'] ?? body.centre_quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity < 0) fail(400, 'Invalid inventory quantity');
        const value = { ...component, inventory_id: `INV-${crypto.randomUUID()}`, 'Total center qty': quantity, 'Last counted': '', Notes: '' };
        return { rows: [...rows, value], value };
      }, actor);
      send(response, 201, created);
      return true;
    }
    if (method === 'PATCH' && inventoryMatch) {
      const id = decodeURIComponent(inventoryMatch[1]);
      const body = await readJson(request);
      const allowed = ['Total center qty', 'Last counted', 'Notes'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || !allowed.some((field) => Object.hasOwn(body, field))
        || Object.keys(body).some((field) => !allowed.includes(field))
        || (Object.hasOwn(body, 'Total center qty') && body['Total center qty'] !== ''
          && (!Number.isFinite(Number(body['Total center qty'])) || Number(body['Total center qty']) < 0))
        || (Object.hasOwn(body, 'Last counted') && body['Last counted'] !== '' && !validDate(body['Last counted']))
        || (Object.hasOwn(body, 'Notes') && typeof body.Notes !== 'string')) {
        fail(400, 'Invalid inventory update');
      }
      const item = await updateCollection('inventory', (rows) => {
        const index = rows.findIndex((row) => row.inventory_id === id);
        if (index < 0) fail(404, 'Inventory item not found');
        const updated = { ...rows[index], ...body };
        return { rows: rows.map((row, i) => i === index ? updated : row), value: updated };
      }, actor);
      send(response, 200, item);
      return true;
    }
    if (method === 'DELETE' && inventoryMatch) {
      const id = decodeURIComponent(inventoryMatch[1]);
      await updateCollection('inventory', (rows) => {
        if (!rows.some((item) => item.inventory_id === id)) fail(404, 'Inventory item not found');
        return { rows: rows.filter((item) => item.inventory_id !== id), value: null };
      }, actor);
      send(response, 204, {});
      return true;
    }
    if (method === 'POST' && path === '/borrowings') {
      const body = await readJson(request);
      const workspace = await bootstrap();
      const matches = workspace.robotStudents.filter((student) => student.name === body?.borrower);
      const components = workspace.inventory.filter((item) => item.Component === body?.item
        && normalize(item.Kit).replace(/^urao$/, 'uaro') === normalize(body?.sourceRow?.Kit).replace(/^urao$/, 'uaro'));
      const quantity = Number(body?.sourceRow?.Quantity ?? body?.quantity);
      if (matches.length !== 1 || components.length !== 1 || !Number.isSafeInteger(quantity) || quantity <= 0) {
        fail(400, 'Select one student, component and positive quantity');
      }
      const student = matches[0], component = components[0];
      const id = `BOR-${crypto.randomUUID()}`;
      const date = body.sourceRow?.['Borrowed on'];
      if (!validDate(date)) fail(400, 'A valid borrowing date is required');
      const row = {
        borrowing_id: id, studentId: student.studentId, componentId: component['Component ID'],
        borrower: student.name, item: component.Component, quantity, status: 'Still borrowing',
        sourceRow: { 'Student ID': student.studentId, Student: student.name, Component: component.Component,
          Quantity: quantity, Kit: component.Kit, Status: 'Still borrowing', 'Borrowed on': date, 'Returned on': '' },
      };
      await updateCollection('borrowings', (rows) => ({ rows: [...rows, row], value: row }), actor);
      send(response, 201, row);
      return true;
    }
    const returned = path.match(/^\/borrowings\/([^/]+)\/return$/);
    if (method === 'POST' && returned) {
      const id = decodeURIComponent(returned[1]);
      const body = await readJson(request);
      const date = body.returned_on || new Date().toISOString().slice(0, 10);
      if (!validDate(date)) fail(400, 'Invalid return date');
      const updated = await updateCollection('borrowings', (rows) => {
        const row = rows.find((item) => item.borrowing_id === id);
        if (!row) fail(404, 'Borrowing record not found');
        const value = { ...row, status: 'Returned', sourceRow: { ...row.sourceRow, Status: 'Returned', 'Returned on': date } };
        return { rows: rows.map((item) => item === row ? value : item), value };
      }, actor);
      send(response, 200, updated);
      return true;
    }
    const studentRoute = path.match(/^\/students\/([^/]+)\/(robot-progress|topic-progress|checklist|borrowings)$/);
    if (method === 'GET' && studentRoute) {
      const workspace = await bootstrap();
      const id = studentId(decodeURIComponent(studentRoute[1]));
      const [responseKey, dataKey] = {
        'robot-progress': ['progress', 'robotProgress'], 'topic-progress': ['progress', 'codingProgress'],
        checklist: ['checklist', 'componentItems'], borrowings: ['borrowings', 'borrowings'],
      }[studentRoute[2]];
      send(response, 200, { [responseKey]: workspace[dataKey].filter((row) => studentId(row.studentId) === id) });
      return true;
    }
    return false;
  }
  return { handle, bootstrap, jamesStorage };
}

module.exports = { buildWorkspace, createSheetsWorkspaceRouter, WorkspaceConflictError };
