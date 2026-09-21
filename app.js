const groups = [
  { name: "Today's Students", icon: '◔' },
  { name: 'Robot Students', icon: '◎' },
  { name: 'Coding Students', icon: '⌘' },
  { name: 'Libraries & Curriculum', icon: '▦' },
  { name: 'Component Inventory', icon: '▤' },
  { name: 'Borrowing Log', icon: '↗' },
];
const tools = [];
const state = {
  files: [], robotStudents: [], codingStudents: [], codingProgress: [], borrowings: [],
  componentItems: [], robotProgress: [], codingLessons: [], robotLessons: [], curriculum: [],
  componentLibrary: [], inventory: [], robotPrograms: [], robots: [], reminders: [],
};
let activeView = "Today's Students";
let selectedStudent = '';
let componentPage = 1;
const componentPageSize = 25;
let progressFinishDates = {};
let activeLibrarySection = 'Robot Library';
const content = document.querySelector('#content');
const nav = document.querySelector('#nav');
const toolNav = document.querySelector('#toolNav');

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const save = (key, value) => localStorage.setItem(`icc-${key}`, JSON.stringify(value));
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`icc-${key}`)) ?? fallback; } catch { return fallback; } };
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const display = (value) => {
  let result = String(value ?? '');
  try { result = decodeURIComponent(result); } catch {}
  if (result.includes('(') && /(?:\/|\.md|\.csv|https?:)/i.test(result.slice(result.indexOf('(')))) result = result.slice(0, result.indexOf('(')).trim();
  result = result.replace(/\s*\([^)]*(?:https?:\/\/|%20|\.md|\.csv|ICC\/|CWB\/)[^)]*\)/gi, '');
  result = result.replace(/https?:\/\/\S+/gi, '').replace(/\s*\([^)]*\.(?:md|csv)[^)]*\)/gi, '');
  result = result.replace(/\s*\([^)]*\b(?:ICC|CWB|Student Tracker|Robot students info)[^)]*\)/gi, '');
  result = result.replace(/\b[0-9a-f]{24,}\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return result || '—';
};

const universalTableRegistry = new Map();
let universalTableId = 0;
function tableMarkup(headers, rows, className = '') {
  const sortableValue = (cell) => display(String(cell ?? '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ''));
  const sortedRows = [...rows].sort((left, right) => sortableValue(left[0]).localeCompare(sortableValue(right[0]), undefined, { numeric: true, sensitivity: 'base' }));
  const formatCell = (cell) => /<(?:button|input|select|option|textarea|span|div|svg)\b/i.test(String(cell)) ? cell : escapeHtml(display(cell));
  return `<div class="records source-table ${className}"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(display(header))}</th>`).join('')}</tr></thead><tbody>${sortedRows.map((row) => `<tr>${row.map((cell) => `<td>${formatCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function table(headers, rows, className = '') {
  const id = `universal-${universalTableId++}`;
  universalTableRegistry.set(id, { headers, rows });
  return `<div class="universal-table" data-universal-id="${id}"><div class="table-tools universal-tools"><input class="table-search universal-search" placeholder="Search table..." aria-label="Search table"><select class="table-filter universal-sort"><option value="asc">Ascending</option><option value="desc">Descending</option></select><span class="active-filter-label">All records</span><button class="mini-button universal-clear" type="button">Clear filters</button></div>${tableMarkup(headers, rows, className)}</div>`;
}

function refreshUniversalTable(container) {
  const data = universalTableRegistry.get(container.dataset.universalId);
  if (!data) return;
  const query = container.querySelector('.universal-search').value.toLowerCase();
  const direction = container.querySelector('.universal-sort').value;
  const filtered = data.rows.filter((row) => row.map((cell) => display(String(cell).replace(/<[^>]*>/g, ''))).join(' ').toLowerCase().includes(query));
  const ordered = [...filtered].sort((a, b) => {
    const result = display(String(a[0])).localeCompare(display(String(b[0])), undefined, { numeric: true, sensitivity: 'base' });
    return direction === 'desc' ? -result : result;
  });
  container.querySelector('.active-filter-label').textContent = query ? `${ordered.length} matching records` : 'All records';
  container.querySelector('.records').outerHTML = tableMarkup(data.headers, ordered);
}
const tableFilterRegistry = new Map();
let tableFilterId = 0;
function tableFilters(options, rows, headers) {
  const id = `filter-${tableFilterId++}`;
  tableFilterRegistry.set(id, { headers, rows });
  const cellText = (value) => display(String(value ?? '').replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]*>/g, ''));
  const controls = options.map((option) => `<select class="table-filter" data-filter-index="${option.index}"><option value="">All ${escapeHtml(option.label)}</option>${[...new Set(rows.map((row) => cellText(row[option.index])))] .filter((value) => value !== '—').sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select>`).join('');
  return `<div class="table-tools filter-tools">${controls}</div><div class="filtered-table" data-filter-id="${id}">${table(headers, rows)}</div>`;
}
function bindTableFilters() {
  document.querySelectorAll('.table-filter').forEach((filter) => filter.onchange = () => {
    const wrapper = filter.closest('.filtered-table') || document.querySelector('.filtered-table');
    if (!wrapper) return;
    const filters = [...wrapper.parentElement.querySelectorAll('.table-filter')];
    const data = tableFilterRegistry.get(wrapper.dataset.filterId);
    if (!data) return;
    const { headers, rows } = data;
    const filtered = rows.filter((row) => filters.every((item) => !item.value || display(String(row[Number(item.dataset.filterIndex)]).replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]*>/g, '')) === item.value));
    wrapper.innerHTML = table(headers, filtered);
  });
}
function text(value) { return escapeHtml(display(value)); }
function icon(name) {
  const paths = {
    bot: '<rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="M8 5V3m8 2V3M7 12h.01M17 12h.01M9 16h6"></path>',
    code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"></path>',
    check: '<path d="m5 12 4 4L19 6"></path><circle cx="12" cy="12" r="9"></circle>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    calendarX: '<rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18m5 4-4 4m0-4 4 4"></path>',
    off: '<circle cx="12" cy="12" r="9"></circle><path d="m5 5 14 14"></path>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"></rect><path d="M9 4V2h6v2M9 12h6M9 16h4"></path>',
    clipboardCheck: '<rect x="5" y="4" width="14" height="17" rx="2"></rect><path d="M9 4V2h6v2m-6 9 2 2 4-4"></path>',
    alert: '<path d="M10.3 3.8 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4m0 4h.01"></path>',
    home: '<path d="m3 11 9-8 9 8v9H3z"></path><path d="M9 20v-6h6v6"></path>',
    package: '<path d="m4 7 8-4 8 4-8 4-8-4Z"></path><path d="M4 7v10l8 4 8-4V7M12 11v10"></path>',
    warehouse: '<path d="m3 10 9-6 9 6v10H3z"></path><path d="M7 20v-6h10v6M7 10h.01M12 10h.01M17 10h.01"></path>'
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.code}</svg>`;
}
function progressMarkup(value, label = '') {
  const percent = Math.max(0, Math.min(100, Number.parseInt(String(value), 10) || 0));
  return `<div class="progress-cell"><div class="progress-track"><span style="width:${percent}%"></span></div><strong>${percent}%</strong>${label ? `<small>${text(label)}</small>` : ''}</div>`;
}
function attendanceMarkup(value) {
  const raw = String(value || '').toLowerCase();
  const status = /done\s+[1-9]/.test(raw) ? ['present', 'Present', 'check'] : /absent\s+[1-9]/.test(raw) ? ['absent', 'Absent', 'off'] : /planned\s+[1-9]|upcoming/.test(raw) ? ['upcoming', 'Upcoming Lesson', 'clock'] : /no lessons|no lesson|not scheduled/.test(raw) ? ['none', 'No Lesson Scheduled', 'calendarX'] : ['present', 'Present', 'check'];
  return `<span class="status-badge attendance-${status[0]}">${icon(status[2])}<span>${status[1]}</span></span>`;
}
function checklistMarkup(student) {
  const items = state.componentItems.filter((row) => display(row.student) === student.name);
  const missing = items.filter((row) => quantityResult(row.requiredQty, row.studentQty) === 'Missing').length;
  if (missing) return `<span class="status-badge checklist-missing">${icon('alert')}<span>Missing ${missing}</span></span>`;
  if (items.length) return `<span class="status-badge checklist-checked">${icon('clipboardCheck')}<span>Checked</span></span>`;
  return `<span class="status-badge checklist-pending">${icon('clipboard')}<span>Pending</span></span>`;
}
function carryMarkup(student) {
  const status = getCarryStatus(student);
  const config = status === 'Take Robot Home' ? ['carry-blue', 'home'] : status === 'Take Whole Kit Home' ? ['carry-orange', 'package'] : ['carry-green', 'warehouse'];
  return `<select class="status-select ${config[0]}" data-carry-status-student="${escapeHtml(student.name)}"><option ${status === 'Take Robot Home' ? 'selected' : ''}>Take Robot Home</option><option ${status === 'Take Whole Kit Home' ? 'selected' : ''}>Take Whole Kit Home</option><option ${status === 'Leave Kit At Centre' ? 'selected' : ''}>Leave Kit At Centre</option></select><span class="carry-icon">${icon(config[1])}</span>`;
}
function programmeLabel(value) {
  const clean = display(value);
  const kit = clean.match(/^(AIKIRO|ROBOKIT|UARO)/i)?.[1]?.toUpperCase() || '';
  return kit && !clean.endsWith(` - ${kit}`) ? `${clean} - ${kit}` : clean;
}
function programmeVariants() {
  return [...new Set(state.robotPrograms.map((row) => display(row.Program)).filter((name) => /^(AIKIRO|ROBOKIT|UARO)\s+Lv/i.test(name)))].sort((left, right) => {
    const leftMatch = left.match(/^(AIKIRO|ROBOKIT|UARO)\s+Lv(\d+)(?:_(original|additional))?/i) || [];
    const rightMatch = right.match(/^(AIKIRO|ROBOKIT|UARO)\s+Lv(\d+)(?:_(original|additional))?/i) || [];
    const kitOrder = { AIKIRO: 1, UARO: 2, ROBOKIT: 3 };
    const levelOrder = Number(leftMatch[2] || 0) - Number(rightMatch[2] || 0);
    if (kitOrder[leftMatch[1]?.toUpperCase()] !== kitOrder[rightMatch[1]?.toUpperCase()]) return (kitOrder[leftMatch[1]?.toUpperCase()] || 9) - (kitOrder[rightMatch[1]?.toUpperCase()] || 9);
    if (levelOrder) return levelOrder;
    const typeOrder = { original: 1, additional: 2 };
    return (typeOrder[leftMatch[3]?.toLowerCase()] || 1) - (typeOrder[rightMatch[3]?.toLowerCase()] || 1);
  });
}
function levelNumber(value) {
  const match = String(value ?? '').match(/(?:Lv|Level\s*)(\d+)/i);
  return match ? Number(match[1]) : null;
}
function price(value) {
  const clean = display(value);
  if (clean === '—') return clean;
  return clean.includes('HK$') ? clean : `HK$${clean}`;
}
function quantityResult(expected, actual) {
  const expectedNumber = Number(expected);
  const actualNumber = Number(actual);
  if (!Number.isFinite(expectedNumber) || !Number.isFinite(actualNumber)) return 'Missing';
  return actualNumber >= expectedNumber ? 'Enough' : 'Missing';
}
function header(title, description, action = '') { return `<div class="view-head"><div><div class="eyebrow">ICC CONTROL ROOM</div><h1>${text(title)}</h1><p>${text(description)}</p></div>${action}</div>`; }
function button(label, action, className = 'mini-button') { return `<button class="${className}" data-action="${action}">${label}</button>`; }

function renderNav() {
  nav.innerHTML = groups.map((group) => `<button data-view="${group.name}"><span class="nav-icon">${group.icon}</span>${group.name}</button>`).join('');
  if (toolNav) toolNav.innerHTML = tools.map((tool) => `<button data-view="${tool.name}"><span class="nav-icon">${tool.icon}</span>${tool.name}</button>`).join('');
  document.querySelectorAll('#nav button').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === activeView);
    item.onclick = () => { activeView = item.dataset.view; selectedStudent = ''; render(); if (window.innerWidth <= 760) closeSidebar(); };
  });
}

function render() {
  renderNav();
  document.querySelector('#breadcrumb').textContent = activeView;
  if (activeView === "Today's Students") renderTodaysStudents();
  else if (activeView === 'Robot Students') renderStudents();
  else if (activeView === 'Coding Students') renderCodingStudents();
  else if (activeView === 'Libraries & Curriculum' || activeView === 'AIKIRO' || activeView === 'UARO' || activeView === 'ROBOKIT' || /^CS[1-5] curriculum$/.test(activeView) || activeView === 'CodeMonkey curriculum') renderLibraries(activeView);
  else if (activeView === 'Borrowing Log') renderOperations();
  else if (activeView === 'Component Inventory') renderComponents();
  else renderStudents();
}

function getCarryStatus(student) {
  return student?.carryStatus || 'Leave Kit At Centre';
}

function getCarryStatusClass(status) {
  if (status === 'Take Robot Home') return 'status-blue';
  if (status === 'Take Whole Kit Home') return 'status-orange';
  return 'status-green';
}

function getStudentAttendance(student) {
  if (student && student.sourceRow?.['Monthly attendance']) return student.sourceRow['Monthly attendance'];
  if (student && student.attendance) return student.attendance;
  return '—';
}

function lessonDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const firstDate = raw.split('→')[0].trim();
  const parsed = new Date(firstDate);
  if (!Number.isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  const shortDate = firstDate.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!shortDate) return '';
  const year = shortDate[3] ? Number(shortDate[3].length === 2 ? `20${shortDate[3]}` : shortDate[3]) : new Date().getFullYear();
  return `${year}-${String(Number(shortDate[2])).padStart(2, '0')}-${String(Number(shortDate[1])).padStart(2, '0')}`;
}

function lessonStudentName(value) {
  return display(value).replace(/\s+\(.*$/, '').trim();
}

function todayLessonRows() {
  const todayKey = today();
  const robotByName = new Map(state.robotStudents.map((student) => [student.name, student]));
  const codingByName = new Map(state.codingStudents.map((student) => [student.name, student]));
  const rows = [];
  state.robotLessons.filter((lesson) => lesson['Lesson time'] && lessonDateKey(lesson['Lesson time']) === todayKey).forEach((lesson) => {
    const name = lessonStudentName(lesson['Student name']);
    const student = robotByName.get(name);
    if (student) rows.push({ type: 'Robot', name, student, lesson, programme: student.program || '—', tutor: lesson.Tutor || student.tutor || '', carryStatus: getCarryStatus(student), notes: lesson.Remarks || '' });
  });
  state.codingLessons.filter((lesson) => lesson['Lesson time'] && lessonDateKey(lesson['Lesson time']) === todayKey).forEach((lesson) => {
    const name = lessonStudentName(lesson['Student (Coding)']);
    const student = codingByName.get(name);
    if (student) rows.push({ type: 'Coding', name, student, lesson, programme: student.course || '—', tutor: lesson.Tutor || student.tutor || '', carryStatus: 'N/A', notes: lesson.Remarks || '' });
  });
  rows.push({
    type: 'Robot',
    name: 'Test Student (Demo)',
    student: { name: 'Test Student (Demo)', program: 'AIKIRO Lv1', nextRobot: 'Demo Robot', completion: '60%', carryStatus: 'Take Robot Home', sourceRow: { Tutor: 'Demo Tutor', 'Monthly attendance': 'Upcoming Lesson', Check: 'Not yet checked' } },
    lesson: { 'Lesson time': todayKey, Tutor: 'Demo Tutor', Remarks: 'Demo row for table testing' },
    programme: 'AIKIRO Lv1',
    tutor: 'Demo Tutor',
    carryStatus: 'Take Robot Home',
    notes: 'Demo row for table testing',
    demo: true
  });
  return rows;
}

function renderTodaysStudents() {
  const rows = todayLessonRows();
  const searchValue = document.querySelector('#todaySearch')?.value || '';
  const typeValue = document.querySelector('#todayType')?.value || '';
  const sortValue = document.querySelector('#todaySort')?.value || 'name';
  const filteredRows = rows.filter((row) => (!typeValue || row.type === typeValue) && `${row.name} ${row.programme} ${row.tutor} ${row.notes}`.toLowerCase().includes(searchValue.toLowerCase()));
  const sortedRows = [...filteredRows].sort((a, b) => sortValue === 'type' ? a.type.localeCompare(b.type) : a.name.localeCompare(b.name));
  content.innerHTML = header("Today's Students", 'Daily workload for students with a lesson scheduled today.') + `<div class="demo-banner">Demo row active for layout testing</div>
    <div class="today-panel"><div class="toolbar-row compact"><input id="todaySearch" class="table-search" placeholder="Search today’s workload" value="${escapeHtml(searchValue)}"><select id="todayType" class="table-filter"><option value="">All student types</option><option ${typeValue === 'Coding' ? 'selected' : ''}>Coding</option><option ${typeValue === 'Robot' ? 'selected' : ''}>Robot</option></select><select id="todaySort" class="table-filter"><option value="name" ${sortValue === 'name' ? 'selected' : ''}>Sort: name</option><option value="type" ${sortValue === 'type' ? 'selected' : ''}>Sort: type</option></select></div>
      <div class="dashboard-strip"><div><strong>${rows.length}</strong><span>Students Today</span></div><div><strong>${rows.filter((row) => row.type === 'Coding').length}</strong><span>Coding Students Today</span></div><div><strong>${rows.filter((row) => row.type === 'Robot').length}</strong><span>Robot Students Today</span></div></div>
      <div class="records today-table-wrap"><table class="data-table"><thead><tr><th>Student Name</th><th>Student Type</th><th>Programme</th><th>Tutor Name</th><th>Robot Carry Status</th><th>Quick Notes</th><th>Actions</th></tr></thead><tbody>${sortedRows.map((row) => `<tr><td>${text(row.name)}</td><td><span class="type-pill ${row.type === 'Coding' ? 'type-coding' : 'type-robot'}">${row.type}</span></td><td>${text(row.programme)}</td><td><input class="inline-input today-tutor-input" data-tutor-student="${escapeHtml(row.name)}" value="${escapeHtml(row.tutor)}" placeholder="Tutor name"></td><td>${row.type === 'Robot' ? `<select class="inline-input carry-status-select" data-carry-status-student="${escapeHtml(row.name)}"><option ${row.carryStatus === 'Take Robot Home' ? 'selected' : ''}>Take Robot Home</option><option ${row.carryStatus === 'Take Whole Kit Home' ? 'selected' : ''}>Take Whole Kit Home</option><option ${row.carryStatus === 'Leave Kit At Centre' ? 'selected' : ''}>Leave Kit At Centre</option></select>` : '<span class="status-badge">N/A</span>'}</td><td><input class="inline-input today-notes-input" data-lesson-notes="${escapeHtml(row.name)}" value="${escapeHtml(row.notes)}" placeholder="Quick note"></td><td><button class="mini-button" data-action="${row.type === 'Robot' ? 'checklist' : 'coding-profile'}" data-student-name="${escapeHtml(row.name)}">${row.type === 'Robot' ? 'Checklist' : 'Open'}</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty-state">No students are scheduled for today.</div></td></tr>'}</tbody></table></div></div>`;
  document.querySelectorAll('#todaySearch, #todayType, #todaySort').forEach((control) => control.oninput = control.onchange = () => renderTodaysStudents());
}

/*
    const raw = String(value || '').trim();
    if (!raw) return '';
    const firstDate = raw.split('→')[0].trim();
    const parsed = new Date(firstDate);
    if (!Number.isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    const shortDate = firstDate.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!shortDate) return '';
    const year = shortDate[3] ? Number(shortDate[3].length === 2 ? `20${shortDate[3]}` : shortDate[3]) : new Date().getFullYear();
    return `${year}-${String(Number(shortDate[2])).padStart(2, '0')}-${String(Number(shortDate[1])).padStart(2, '0')}`;
  }

  function lessonStudentName(value) {
    return display(value).replace(/\s+\(.*$/, '').trim();
  }

  function todayLessonRows() {
    const todayKey = today();
    const robotByName = new Map(state.robotStudents.map((student) => [student.name, student]));
    const codingByName = new Map(state.codingStudents.map((student) => [student.name, student]));
    const rows = [];
    state.robotLessons.filter((lesson) => lesson['Lesson time'] && lessonDateKey(lesson['Lesson time']) === todayKey).forEach((lesson) => {
      const name = lessonStudentName(lesson['Student name']);
      const student = robotByName.get(name);
      if (!student) return;
      rows.push({ type: 'Robot', name, student, lesson, programme: student.program || '—', tutor: lesson.Tutor || student.sourceRow?.Tutor || '', carryStatus: getCarryStatus(student), notes: lesson.Remarks || '' });
    });
    state.codingLessons.filter((lesson) => lesson['Lesson time'] && lessonDateKey(lesson['Lesson time']) === todayKey).forEach((lesson) => {
      const name = lessonStudentName(lesson['Student (Coding)']);
      const student = codingByName.get(name);
      if (!student) return;
      rows.push({ type: 'Coding', name, student, lesson, programme: student.course || '—', tutor: lesson.Tutor || student.tutor || '', carryStatus: 'N/A', notes: lesson.Remarks || '' });
    });
    return rows;
  }

  return '—';
    const rows = todayLessonRows();
    const searchValue = document.querySelector('#todaySearch')?.value || '';
    const typeValue = document.querySelector('#todayType')?.value || '';
    const sortValue = document.querySelector('#todaySort')?.value || 'name';
    const filteredRows = rows.filter((row) => (!typeValue || row.type === typeValue) && `${row.name} ${row.programme} ${row.tutor} ${row.notes}`.toLowerCase().includes(searchValue.toLowerCase()));
    const sortedRows = [...filteredRows].sort((a, b) => sortValue === 'type' ? a.type.localeCompare(b.type) : a.name.localeCompare(b.name));

    content.innerHTML = header("Today's Students", 'Daily workload for students with a lesson scheduled today.') + `
  const attendanceOptions = [...new Set(rows.map((row) => row.attendance))].filter(Boolean).sort();

          <input id="todaySearch" class="table-search" placeholder="Search today’s workload" value="${escapeHtml(searchValue)}">
    <div class="today-panel">
          <select id="todaySort" class="table-filter"><option value="name" ${sortValue === 'name' ? 'selected' : ''}>Sort: name</option><option value="type" ${sortValue === 'type' ? 'selected' : ''}>Sort: type</option></select>
        <select id="todayTutor" class="table-filter"><option value="">All tutors</option>${tutorOptions.map((value) => `<option ${tutorValue === value ? 'selected' : ''}>${text(value)}</option>`).join('')}</select>
        <select id="todayAttendance" class="table-filter"><option value="">All attendance</option>${attendanceOptions.map((value) => `<option ${attendanceValue === value ? 'selected' : ''}>${text(value)}</option>`).join('')}</select>
        <select id="todaySort" class="table-filter"><option value="name" ${sortValue === 'name' ? 'selected' : ''}>Sort: name</option><option value="time" ${sortValue === 'time' ? 'selected' : ''}>Sort: lesson time</option><option value="progress" ${sortValue === 'progress' ? 'selected' : ''}>Sort: progress</option></select>
      </div>
      <div class="stats-grid compact">
        <div class="stat-box"><span>Coding Students</span><strong>${rows.filter((row) => row.type === 'Coding').length}</strong></div>
        <div class="stat-box"><span>Robot Students</span><strong>${rows.filter((row) => row.type === 'Robot').length}</strong></div>
        <div class="stat-box warning"><span>Absent Students</span><strong>${rows.filter((row) => /absent|no lessons|not attended/i.test(String(row.attendance))).length}</strong></div>
            <thead><tr><th>Student Name</th><th>Student Type</th><th>Programme</th><th>Tutor Name</th><th>Robot Carry Status</th><th>Quick Notes</th><th>Actions</th></tr></thead>
      <div class="records today-table-wrap">
        <table class="data-table">
          <thead><tr><th>Student Name</th><th>Programme</th><th>Today's Lesson Time</th><th>Tutor</th><th>Attendance Status</th><th>Student Type</th><th>Current Progress</th><th>Actions</th></tr></thead>
          <tbody>
                <td>${text(row.lessonTime)}</td>
                  <td>${text(row.programme)}</td>
                  <td><input class="inline-input today-tutor-input" data-tutor-student="${escapeHtml(row.name)}" value="${escapeHtml(row.tutor)}" placeholder="Tutor name"></td>
                  <td>${row.type === 'Robot' ? `<select class="inline-input carry-status-select" data-carry-status-student="${escapeHtml(row.name)}"><option ${row.carryStatus === 'Take Robot Home' ? 'selected' : ''}>Take Robot Home</option><option ${row.carryStatus === 'Take Whole Kit Home' ? 'selected' : ''}>Take Whole Kit Home</option><option ${row.carryStatus === 'Leave Kit At Centre' ? 'selected' : ''}>Leave Kit At Centre</option></select>` : '<span class="status-badge">N/A</span>'}</td>
                  <td><input class="inline-input today-notes-input" data-lesson-notes="${escapeHtml(row.name)}" value="${escapeHtml(row.notes)}" placeholder="Quick note"></td>
                  <td><button class="mini-button" data-action="${row.type === 'Robot' ? 'checklist' : 'coding-profile'}" data-student-name="${escapeHtml(row.name)}">${row.type === 'Robot' ? 'Checklist' : 'Open'}</button></td>
                <td><span class="type-pill ${row.type === 'Coding' ? 'type-coding' : 'type-robot'}">${row.type}</span></td>
              `).join('') || '<tr><td colspan="7"><div class="empty-state">No students are scheduled for today.</div></td></tr>'}
                <td>${row.source === 'robot' ? `<button class="mini-button" data-profile="${row.id}">Open</button>` : `<button class="mini-button" data-coding-profile="${row.id}">Open</button>`}</td>
              </tr>
            `).join('') || '<tr><td colspan="8"><div class="empty-state">No students match the current filters.</div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.querySelectorAll('#todaySearch, #todayType, #todaySort').forEach((control) => {
    control.oninput = control.onchange = () => renderTodaysStudents();
  });
}

*/

function renderStudents() {
  const rows = state.robotStudents.map((student, index) => [
    `<button class="student-link" data-profile="${index}"><span class="student-avatar">${text(student.name).charAt(0)}</span><span><strong>${text(student.name)}</strong><small>${text(student.sourceRow?.Tutor || student.tutor || 'Robot student')}</small></span></button>`,
    `<span class="programme-chip">${icon('bot')}<span>${text(programmeLabel(student.program))}</span></span>`,
    `<span class="robot-chip">${icon('bot')}<span>${text(student.nextRobot || 'Not assigned')}</span></span>`,
    progressMarkup(student.completion),
    attendanceMarkup(getStudentAttendance(student)),
    checklistMarkup(student),
    carryMarkup(student)
  ]);
  content.innerHTML = header('Robot Students', 'Tutor control center for every robot student and current kit status.', button('New profile +', 'new-robot', 'primary-button')) + `<div class="dashboard-strip"><div><strong>${state.robotStudents.length}</strong><span>Robot students</span></div><div><strong>${state.robotStudents.filter((student) => checklistMarkup(student).includes('checklist-missing')).length}</strong><span>Missing components</span></div></div>` + tableFilters([{ label: 'Programme', index: 1 }, { label: 'Attendance', index: 4 }], rows, ['Student', 'Programme', 'Current robot', 'Progress', 'Attendance status', 'Checklist status', 'Robot carry status']);
  bindTableFilters();
}

function renderStudentChecklist() {
  const student = state.robotStudents.find((row) => row.name === selectedStudent);
  if (!student) return renderStudents();
  const checklist = state.componentItems.filter((row) => display(row.student) === selectedStudent);
  content.innerHTML = header(`${student.name} · Checklist`, 'Confirm components and quantities for this robot student.', button('← Robot Students', 'robot-students', 'mini-button')) + `
    <div class="section-heading"><h2>Student checklist</h2><span class="table-hint">Update quantities and notes as the kit is checked.</span></div>
    ${table(['Item', 'Tier', 'Required', 'Student qty', 'Status', 'Notes'], checklist.map((row) => {
      const index = state.componentItems.indexOf(row);
      const quantity = Number(row.requiredQty) || 20;
      const options = Array.from({ length: Math.max(quantity, 20) + 1 }, (_, value) => `<option value="${value}" ${String(row.studentQty) === String(value) ? 'selected' : ''}>${value}</option>`).join('');
      return [text(row.item), text(row.tier), text(row.requiredQty), `<select class="inline-input" data-checklist-qty="${index}">${options}</select>`, text(quantityResult(row.requiredQty, row.studentQty)), `<input class="inline-input checklist-note" data-checklist-note="${index}" value="${escapeHtml(row.sourceRow?.Notes || '')}" placeholder="Notes">`];
    }))}`;
}

/*
function renderStudentProfile() {
  const student = state.robotStudents.find((row) => row.name === selectedStudent);
  if (!student) return renderStudents();
  const hasProgress = state.robotProgress.some((row) => display(row.Student || row['Student (linked)']) === selectedStudent);
  const hasChecklist = state.componentItems.some((row) => row.student === selectedStudent);
  if (!hasProgress || !hasChecklist) {
    replaceStudentProgramme(student, student.program);
  }
  const progress = state.robotProgress.filter((row) => display(row.Student || row['Student (linked)']).startsWith(selectedStudent));
  const programLevel = display(student.program).match(/^(AIKIRO|ROBOKIT|UARO)\s+Lv\d+(?:_[a-z]+)?/i)?.[0] || '';
  const exactLevel = programLevel.toLowerCase();
  const levelFamily = exactLevel.replace(/_original|_additional/i, '');
  const programmeProgress = progress.filter((row) => !row.Level || String(row.Level).toLowerCase() === exactLevel || (!exactLevel.includes('_') && String(row.Level).toLowerCase().startsWith(levelFamily)));
  const checklist = state.componentItems.filter((row) => display(row.student) === selectedStudent);
  const completed = programmeProgress.filter((row) => String(row.Status).toLowerCase() === 'done').length;
  const missing = checklist.filter((row) => quantityResult(row.requiredQty, row.studentQty) === 'Missing').length;
  content.innerHTML = header(student.name, 'Individual profile with programme, robot progress, component checklist, lessons, and borrowing warnings.', button('← Students', 'students', 'mini-button')) + `<div class="profile-grid"><div class="profile-panel"><span class="eyebrow">PROGRAMME</span><h2>${text(programmeLabel(student.program))}</h2><p>Next robot: <strong>${text(student.nextRobot)}</strong></p><p>Completion: <strong>${text(student.completion)}</strong></p><p>Attendance: ${text(student.sourceRow?.['Monthly attendance'])}</p>${button('Change programme', 'change-programme', 'mini-button')}</div><div class="profile-panel"><span class="eyebrow">CHECK STATUS</span><h2>${text(student.sourceRow?.Check || 'Not checked')}</h2><p>${missing} checklist items still missing quantity.</p><p>${completed} robots marked Done in the selected programme level.</p>${button('Check components', 'check-components', 'mini-button')}</div></div><div class="section-heading"><h2>Robot progress · ${text(programLevel)}</h2></div>${table(['Sequence', 'Robot', 'Status', 'Finish date', 'Notes'], programmeProgress.map((row) => { const index = progress.indexOf(row); const key = `${selectedStudent}:${row.Robot}:${row.Sequence}`; return [text(row.Sequence), text(row.Robot), `<button class="status-button" data-progress="${index}">${text(row.Status)}</button>`, `<input class="inline-input" type="date" data-progress-date="${key}" value="${escapeHtml(progressFinishDates[key] || '')}">`, `<input class="inline-input" data-progress-notes="${index}" value="${escapeHtml(row.Notes)}" placeholder="Notes">`]; }))}<div class="section-heading"><h2>Component checklist</h2><span class="table-hint">All tiers · select quantity or add a remark</span></div>${table(['Item', 'Tier', 'Required', 'Student qty', 'Status', 'Price', 'Notes'], checklist.map((row) => { const index = state.componentItems.indexOf(row); const quantity = Number(row.requiredQty) || 20; const options = Array.from({ length: Math.max(quantity, 20) + 1 }, (_, value) => `<option value="${value}" ${String(row.studentQty) === String(value) ? 'selected' : ''}>${value}</option>`).join(''); return [text(row.item), text(row.tier), text(row.requiredQty), `<select class="inline-input" data-component-qty="${index}">${options}</select>`, quantityResult(row.requiredQty, row.studentQty), price(row.unitPrice), `<input class="inline-input" data-component-note="${index}" value="${escapeHtml(row.sourceRow.Notes)}" placeholder="Remark">`]; }))}`;
  content.insertAdjacentHTML('beforeend', `<div class="table-tools profile-checklist-tools"><input id="profileChecklistSearch" class="table-search" placeholder="Filter components..."><select id="profileChecklistTier" class="table-filter"><option value="">All tiers</option><option>Tier A</option><option>Tier B</option><option>Tier C</option></select><select id="profileChecklistStatus" class="table-filter"><option value="">All results</option><option>Enough</option><option>Missing</option></select></div>`);
  const checklistTable = content.querySelectorAll('.source-table')[1];
  const applyChecklistFilter = () => { const query = document.querySelector('#profileChecklistSearch').value.toLowerCase(); const tier = document.querySelector('#profileChecklistTier').value; const status = document.querySelector('#profileChecklistStatus').value; checklistTable.querySelectorAll('tbody tr').forEach((row) => { const cells = row.children; const show = cells[0].textContent.toLowerCase().includes(query) && (!tier || cells[1].textContent === tier) && (!status || cells[4].textContent === status); row.hidden = !show; }); };
  document.querySelectorAll('#profileChecklistSearch, #profileChecklistTier, #profileChecklistStatus').forEach((control) => control.oninput = control.onchange = applyChecklistFilter);
  if (!programmeProgress.length || !checklist.length) {
    const notice = document.createElement('div');
    notice.className = 'sync-banner profile-repair-banner';
    notice.innerHTML = `<strong>Programme tables need repair</strong><span>${programmeProgress.length} robot rows · ${checklist.length} checklist rows</span><button class="mini-button" data-repair-profile="true">Regenerate from programme</button>`;
    content.prepend(notice);
    notice.querySelector('[data-repair-profile]').onclick = () => { replaceStudentProgramme(student, student.program); renderStudentProfile(); };
  }
  document.querySelectorAll('[data-progress]').forEach((item) => item.onclick = () => {
    const row = progress[Number(item.dataset.progress)];
    row.Status = row.Status === 'Done' ? 'Not started' : row.Status === 'Not started' ? 'In progress' : 'Done';
    const ordered = progress.slice().sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0));
    const next = ordered.find((entry) => String(entry.Status).toLowerCase() !== 'done');
    student.nextRobot = next?.Robot || '';
    student.completion = `${Math.round((ordered.filter((entry) => String(entry.Status).toLowerCase() === 'done').length / Math.max(ordered.length, 1)) * 100)}%`;
    save('robot-students', state.robotStudents);
    renderStudentProfile();
      const programmeProgress = progress.filter((row) => !row.Level || String(row.Level).toLowerCase() === exactLevel || (!exactLevel.includes('_') && String(row.Level).toLowerCase().startsWith(levelFamily))).sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0));
  document.querySelectorAll('[data-component-qty], [data-component-note], [data-inventory-qty], [data-progress-notes], [data-progress-date]').forEach((input) => input.onchange = () => {
      const row = state.componentItems[Number(input.dataset.componentQty)];
      const currentRobot = student.nextRobot || programmeProgress.find((row) => String(row.Status).toLowerCase() !== 'done')?.Robot || programmeProgress[0]?.Robot || '—';
      const completedRobots = programmeProgress.filter((row) => String(row.Status).toLowerCase() === 'done').length;
      const totalRobots = Math.max(1, programmeProgress.length);
      const percentComplete = Math.round((completedRobots / totalRobots) * 100);
      const carryStatus = getCarryStatus(student);
      const checklistCost = checklist.reduce((sum, row) => {
        const unit = Number(String(row.unitPrice || '').replace(/[^\d.]/g, '')) || 0;
        const qty = Number(row.requiredQty) || 0;
        return sum + (unit * qty);
      }, 0);
      const checklistStatus = student.sourceRow?.Check || (missing === 0 ? 'Checked' : 'Not Yet Checked');
      const journeySteps = programmeProgress.map((row) => {
        const status = String(row.Status || '').toLowerCase();
        let label = 'upcoming';
        if (status === 'done') label = 'completed';
        else if (row.Robot === currentRobot) label = 'current';
        return { row, label };
      });

      content.innerHTML = header(student.name, 'Operational view of the robot student’s current progress and what needs to be checked today.', button('← Students', 'students', 'mini-button')) + `
        <div class="robot-profile">
          <div class="robot-summary-card">
            <div class="summary-header">
              <div class="student-meta">
                <span class="eyebrow">STUDENT</span>
                <h2>${text(student.name)}</h2>
              </div>
              <div class="summary-pill ${getCarryStatusClass(carryStatus)}">${text(carryStatus)}</div>
            </div>
            <div class="summary-grid">
              <div class="summary-item"><span>Programme</span><strong>${text(programmeLabel(student.program))}</strong></div>
              <div class="summary-item"><span>Current Robot</span><strong>${text(currentRobot)}</strong></div>
              <div class="summary-item"><span>Robot Completion</span><strong>${text(student.completion || `${percentComplete}%`)}</strong></div>
              <div class="summary-item"><span>Completed Robots</span><strong>${completedRobots} / ${totalRobots}</strong></div>
              <div class="summary-item"><span>Attendance</span><strong>${text(getStudentAttendance(student))}</strong></div>
            </div>
          </div>

          <div class="journey-layout">
            <div class="journey-panel">
              <div class="section-header compact">
                <div>
                  <span class="eyebrow">ROBOT LEARNING JOURNEY</span>
                  <h2>Current path</h2>
                </div>
              </div>
              <div class="journey-track">
                ${journeySteps.length ? journeySteps.map(({ row, label }) => `
                  <div class="journey-step ${label === 'completed' ? 'completed' : label === 'current' ? 'current' : 'upcoming'}">
                    <span class="journey-icon">${label === 'completed' ? icon('check') : label === 'current' ? icon('bot') : icon('clock')}</span>
                    <div>
                      <strong>${text(row.Robot || 'Robot')}</strong>
                      <small>${label === 'completed' ? 'Completed' : label === 'current' ? 'Current robot' : 'Upcoming'}</small>
                    </div>
                  </div>
                `).join('') : '<div class="empty-state">No robot learning path is available yet.</div>'}
              </div>
            </div>

            <div class="check-panel">
              <div class="section-header compact">
                <div>
                  <span class="eyebrow">CHECKLIST STATUS</span>
                  <h2>Today's status</h2>
                </div>
              </div>
              <div class="check-status-box">
                <div class="mini-row"><span>Status</span><strong>${text(checklistStatus)}</strong></div>
                <div class="mini-row"><span>Missing Components</span><strong>${missing}</strong></div>
                <div class="mini-row"><span>Estimated Cost</span><strong>${checklistCost ? `HK$${checklistCost.toLocaleString()}` : 'HK$0'}</strong></div>
              </div>
              <div class="carry-status-block">
                <label class="field-label" for="carryStatusSelect">Robot Carry Status</label>
                <select id="carryStatusSelect" class="carry-status-select" data-carry-status="${student.name}">
                  <option ${carryStatus === 'Take Robot Home' ? 'selected' : ''}>Take Robot Home</option>
                  <option ${carryStatus === 'Take Whole Kit Home' ? 'selected' : ''}>Take Whole Kit Home</option>
                  <option ${carryStatus === 'Leave Kit At Centre' ? 'selected' : ''}>Leave Kit At Centre</option>
                </select>
              </div>
              <button class="primary-button" data-action="check-components">Open Checklist</button>
            </div>
          </div>
        </div>
      `;

      document.querySelector('#carryStatusSelect')?.addEventListener('change', (event) => {
        const targetStudent = state.robotStudents.find((row) => row.name === selectedStudent);
        if (!targetStudent) return;
        targetStudent.carryStatus = event.target.value;
        save('robot-students', state.robotStudents);
        renderStudentProfile();
      });
  return rows.sort((a, b) => Number(a.Level) - Number(b.Level));
}

*/

function renderStudentProfile() {
  const student = state.robotStudents.find((row) => row.name === selectedStudent);
  if (!student) return renderStudents();
  const hasProgress = state.robotProgress.some((row) => display(row.Student || row['Student (linked)']) === selectedStudent);
  const hasChecklist = state.componentItems.some((row) => row.student === selectedStudent);
  if (!hasProgress || !hasChecklist) replaceStudentProgramme(student, student.program);

  const progress = state.robotProgress.filter((row) => display(row.Student || row['Student (linked)']).startsWith(selectedStudent));
  const programLevel = display(student.program).match(/^(AIKIRO|ROBOKIT|UARO)\s+Lv\d+(?:_[a-z]+)?/i)?.[0] || '';
  const exactLevel = programLevel.toLowerCase();
  const levelFamily = exactLevel.replace(/_original|_additional/i, '');
  const programmeProgress = progress.filter((row) => !row.Level || String(row.Level).toLowerCase() === exactLevel || (!exactLevel.includes('_') && String(row.Level).toLowerCase().startsWith(levelFamily))).sort((a, b) => Number(a.Sequence || 0) - Number(b.Sequence || 0));
  const checklist = state.componentItems.filter((row) => display(row.student) === selectedStudent);
  const missing = checklist.filter((row) => quantityResult(row.requiredQty, row.studentQty) === 'Missing').length;
  const currentRobot = student.nextRobot || programmeProgress.find((row) => String(row.Status).toLowerCase() !== 'done')?.Robot || programmeProgress[0]?.Robot || '—';
  const completedRobots = programmeProgress.filter((row) => String(row.Status).toLowerCase() === 'done').length;
  const totalRobots = Math.max(1, programmeProgress.length);
  const carryStatus = getCarryStatus(student);
  const checklistStatus = student.sourceRow?.Check || (missing === 0 ? 'Checked' : 'Not Yet Checked');
  const journeySteps = programmeProgress.map((row) => {
    const status = String(row.Status || '').toLowerCase();
    const label = status === 'done' ? 'completed' : row.Robot === currentRobot ? 'current' : 'upcoming';
    return { row, label };
  });

  content.innerHTML = header(student.name, 'Operational view of the robot student’s current progress and what needs to be checked today.', button('← Robot Students', 'robot-students', 'mini-button')) + `
    <div class="robot-profile">
      <div class="robot-summary-card">
        <div class="summary-header"><div class="student-meta"><span class="eyebrow">STUDENT</span><h2>${text(student.name)}</h2></div><div class="summary-pill ${getCarryStatusClass(carryStatus)}">${text(carryStatus)}</div></div>
        <div class="summary-grid">
          <div class="summary-item"><span>Programme</span><strong>${text(programmeLabel(student.program))}</strong></div>
          <div class="summary-item"><span>Current Robot</span><strong>${text(currentRobot)}</strong></div>
          <div class="summary-item"><span>Robot Completion</span><strong>${text(student.completion || '0%')}</strong></div>
          <div class="summary-item"><span>Completed Robots</span><strong>${completedRobots} / ${totalRobots}</strong></div>
          <div class="summary-item"><span>Attendance</span><strong>${text(getStudentAttendance(student))}</strong></div>
        </div>
      </div>
      <div class="journey-layout">
        <div class="journey-panel"><div class="section-header compact"><div><span class="eyebrow">ROBOT LEARNING JOURNEY</span><h2>Current path</h2></div></div><div class="journey-track">
          ${journeySteps.length ? journeySteps.map(({ row, label }) => `<div class="journey-step ${label}"><span class="journey-icon">${label === 'completed' ? icon('check') : label === 'current' ? icon('bot') : icon('clock')}</span><div><strong>${text(row.Robot || 'Robot')}</strong><small>${label === 'completed' ? 'Completed' : label === 'current' ? 'Current robot' : 'Upcoming'}</small></div></div>`).join('') : '<div class="empty-state">No robot learning path is available yet.</div>'}
        </div></div>
        <div class="check-panel"><div class="section-header compact"><div><span class="eyebrow">CHECKLIST STATUS</span><h2>Today’s status</h2></div></div>
          <div class="check-status-box"><div class="mini-row"><span>Status</span><strong>${text(checklistStatus)}</strong></div><div class="mini-row"><span>Missing Components</span><strong>${missing}</strong></div></div>
          <div class="carry-status-block"><label class="field-label" for="carryStatusSelect">Robot Carry Status</label><select id="carryStatusSelect" class="carry-status-select" data-carry-status="${escapeHtml(student.name)}"><option ${carryStatus === 'Take Robot Home' ? 'selected' : ''}>Take Robot Home</option><option ${carryStatus === 'Take Whole Kit Home' ? 'selected' : ''}>Take Whole Kit Home</option><option ${carryStatus === 'Leave Kit At Centre' ? 'selected' : ''}>Leave Kit At Centre</option></select></div>
          <button class="primary-button" data-action="check-components">Open Checklist</button>
        </div>
      </div>
    </div>`;
}

function renderCodingStudents() {
  const rows = state.codingStudents.map((student, index) => {
    const lessons = state.codingProgress.filter((row) => row.sourceId === student.sourceId || (!row.sourceId && row.name === student.name));
    const dashboard = buildCodingDashboard(student, lessons);
    const topic = String(student.topics || dashboard.currentConcept || 'Foundations').split('→').map((item) => item.trim()).filter(Boolean).pop() || 'Foundations';
    const level = Math.max(1, Number(student.nextLevel || dashboard.currentLevel) - 1);
    return [
      `<button class="student-link" data-coding-profile="${index}"><span class="student-avatar coding-avatar">${text(student.name).charAt(0)}</span><span><strong>${text(student.name)}</strong><small>Coding student</small></span></button>`,
      `<span class="programme-chip">${icon('code')}<span>${text(student.course || 'Programme not set')}</span></span>`,
      `<span class="topic-chip">${icon('code')}<span>${text(topic)}</span></span>`,
      progressMarkup(student.completion, `Level ${level} / ${dashboard.maxLevel}`),
      attendanceMarkup(student.attendance)
    ];
  });
  content.innerHTML = header('Coding Students', 'Tutor control center for current coding concepts, progress, and attendance.') + `<div class="dashboard-strip"><div><strong>${state.codingStudents.length}</strong><span>Coding students</span></div><div><strong>${state.codingStudents.filter((student) => Number.parseInt(student.completion, 10) >= 80).length}</strong><span>Near next level</span></div></div>` + table(['Student', 'Programme', 'Current topic', 'Progress', 'Attendance status'], rows);
  document.querySelectorAll('[data-coding-profile]').forEach((item) => item.onclick = () => renderCodingProfile(state.codingStudents[Number(item.dataset.codingProfile)]));
}

function numericLevel(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function getCurriculumForStudent(student) {
  const course = String(student.course || '').trim();
  const rows = [...state.curriculum].filter((row) => row && String(row['Program name'] || '').trim());
  if (!course) return rows.sort((a, b) => Number(a.Level) - Number(b.Level));
  const upperCourse = course.toUpperCase();
  if (/^CS\d+$/i.test(course)) return rows.filter((row) => String(row['Program name'] || '').toUpperCase() === upperCourse).sort((a, b) => Number(a.Level) - Number(b.Level));
  if (/codemonkey/i.test(course)) return rows.filter((row) => /codemonkey/i.test(String(row['Program name'] || ''))).sort((a, b) => Number(a.Level) - Number(b.Level));
  return rows.sort((a, b) => Number(a.Level) - Number(b.Level));
}

function buildCodingDashboard(student, lessons) {
  const curriculum = getCurriculumForStudent(student);
  const ordered = [...curriculum].sort((a, b) => Number(a.Level) - Number(b.Level));
  const maxLevel = Math.max(1, ...ordered.map((row) => Number(row.Level) || 0));
  const lessonLevels = lessons
    .map((lesson) => numericLevel(lesson.sourceRow?.['Completed ending level'] ?? lesson.sourceRow?.['Ending level'] ?? lesson.progress ?? lesson.next))
    .filter((value) => Number.isFinite(value));
  const inferredCurrent = lessonLevels.length ? Math.max(...lessonLevels) : (numericLevel(student.nextLevel) ? Math.max(1, numericLevel(student.nextLevel) - 1) : 1);
  const currentLevel = Math.max(1, Math.min(maxLevel, inferredCurrent));

  const completedRowEntries = ordered.filter((row) => Number(row.Level) < currentLevel);
  const currentRow = ordered.find((row) => Number(row.Level) === currentLevel) || ordered.filter((row) => Number(row.Level) <= currentLevel).pop() || ordered[0];
  const upcomingEntries = ordered.filter((row) => Number(row.Level) > currentLevel);

  const completedConcepts = [...new Set(completedRowEntries.map((row) => String(row.Topic || '').trim()).filter(Boolean))];
  const currentConcept = String(currentRow?.Topic || 'Foundations').trim() || 'Foundations';
  const upcomingConcepts = [...new Set(upcomingEntries.map((row) => String(row.Topic || '').trim()).filter(Boolean))];
  const nextConcept = upcomingConcepts[0] || 'Capstone / revision';
  const knownConcepts = completedConcepts.slice(-6);

  const lessonDates = lessons
    .map((row) => row.sourceRow?.['Lesson time'] || row.sourceRow?.Date || row.project || '')
    .filter(Boolean)
    .slice(-10);
  const lastLessonDate = lessonDates[lessonDates.length - 1] || student.lastUpdated || 'No recent lessons';
  const progressPercent = Math.min(100, Math.max(0, Math.round((currentLevel / maxLevel) * 100)));

  return {
    currentLevel,
    maxLevel,
    currentConcept,
    nextConcept,
    knownConcepts,
    upcomingConcepts,
    completedConcepts,
    lastLessonDate,
    progressPercent
  };
}

function renderCodingProfile(student) {
  const lessons = state.codingProgress.filter((row) => row.sourceId === student.sourceId || (!row.sourceId && row.name === student.name));
  const history = lessons
    .filter((row) => row.sourceRow?.['Lesson time'] || row.project || row.sourceRow?.Date)
    .slice()
    .reverse()
    .slice(0, 8);
  const dashboard = buildCodingDashboard(student, lessons);

  const historyMarkup = history.length
    ? `<div class="history-list">${history.map((row) => {
        const date = text(row.sourceRow?.['Lesson time'] || row.project || row.sourceRow?.Date || '—');
        const level = text(row.sourceRow?.['Completed ending level'] || row.sourceRow?.['Ending level'] || row.progress || row.next || '—');
        const topic = text((String(row.topics || '').split('→').map((item) => item.trim()).filter(Boolean).pop()) || '—');
        return `<div class="history-row"><span>${date}</span><span>${level}</span><span>${topic}</span></div>`;
      }).join('')}</div>`
    : '<div class="empty-state">No recent lessons recorded for this student.</div>';

  const roadmapMarkup = `
    <div class="roadmap-card">
      <div class="section-header compact">
        <div>
          <span class="eyebrow">LEARNING ROADMAP</span>
          <h2>What the student has learnt and what comes next</h2>
        </div>
      </div>
      <div class="roadmap-track">
        ${dashboard.completedConcepts.length ? dashboard.completedConcepts.map((topic) => `<div class="roadmap-step completed"><span class="roadmap-icon">${icon('check')}</span><div><strong>${text(topic)}</strong><small>Completed</small></div></div>`).join('') : `<div class="roadmap-step neutral"><span class="roadmap-icon">${icon('code')}</span><div><strong>Starting point</strong><small>Warm-up</small></div></div>`}
        <div class="roadmap-step current"><span class="roadmap-icon">${icon('code')}</span><div><strong>${text(dashboard.currentConcept)}</strong><small>Current concept</small></div></div>
        ${dashboard.upcomingConcepts.slice(0, 4).map((topic) => `<div class="roadmap-step upcoming"><span class="roadmap-icon">${icon('clock')}</span><div><strong>${text(topic)}</strong><small>Upcoming</small></div></div>`).join('')}
      </div>
    </div>
  `;

  const knownContextMarkup = dashboard.knownConcepts.length
    ? dashboard.knownConcepts.map((topic) => `<span class="chip chip-success">${text(topic)}</span>`).join('')
    : '<span class="chip chip-neutral">Foundations</span>';

  const nextContextMarkup = dashboard.upcomingConcepts.slice(0, 3).length
    ? dashboard.upcomingConcepts.slice(0, 3).map((topic) => `<span class="chip chip-muted">${text(topic)}</span>`).join('')
    : '<span class="chip chip-neutral">Capstone / revision</span>';

  content.innerHTML = header(student.name, 'Tutor view for fast learning status checks without logging into the student platform.', button('← Coding students', 'coding-students', 'mini-button')) + `
    <div class="coding-dashboard">
      <div class="student-snapshot-card">
        <div class="student-summary">
          <div class="student-identity">
            <div class="student-avatar">${text(student.name).charAt(0).toUpperCase() || 'S'}</div>
            <div>
              <span class="eyebrow">STUDENT</span>
              <h2>${text(student.name)}</h2>
            </div>
          </div>
          <div class="snapshot-grid">
            <div class="snapshot-item">
              <span class="snapshot-label">Programme</span>
              <strong>${text(student.course || 'Course not set')}</strong>
            </div>
            <div class="snapshot-item accent-item">
              <span class="snapshot-label">Current Level</span>
              <strong>${dashboard.currentLevel}</strong>
            </div>
            <div class="snapshot-item accent-item">
              <span class="snapshot-label">Current Topic</span>
              <strong>${text(dashboard.currentConcept)}</strong>
            </div>
            <div class="snapshot-item">
              <span class="snapshot-label">Progress</span>
              <strong>${dashboard.progressPercent}%</strong>
            </div>
            <div class="snapshot-item">
              <span class="snapshot-label">Last Active</span>
              <strong>${text(dashboard.lastLessonDate)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="main-column">
          ${roadmapMarkup}
        </div>

        <div class="side-column">
          <div class="context-card">
            <div class="section-header compact">
              <div>
                <span class="eyebrow">CURRENT LEARNING CONTEXT</span>
                <h2>What the tutor needs to know</h2>
              </div>
            </div>
            <div class="context-stack">
              <div class="context-row">
                <span class="context-label">Level</span>
                <strong>${dashboard.currentLevel}</strong>
              </div>
              <div class="context-row">
                <span class="context-label">Current concept</span>
                <strong>${text(dashboard.currentConcept)}</strong>
              </div>
              <div class="context-row muted">
                <span class="context-label">Should already know</span>
                <div class="chip-list">${knownContextMarkup}</div>
              </div>
              <div class="context-row muted">
                <span class="context-label">Will encounter next</span>
                <div class="chip-list">${nextContextMarkup}</div>
              </div>
            </div>
          </div>

          <div class="history-card">
            <div class="section-header compact">
              <div>
                <span class="eyebrow">LESSON HISTORY</span>
                <h2>Recent progress</h2>
              </div>
            </div>
            ${historyMarkup}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderComponents() {
  const query = document.querySelector('#componentSearch')?.value?.toLowerCase() || '';
  const tier = document.querySelector('#componentTier')?.value || '';
  const kit = document.querySelector('#componentKit')?.value || '';
  const priceFor = (item) => item['Unit Price'] || state.componentLibrary.find((libraryItem) => libraryItem.Component === item.Component && libraryItem.Kit === item.Kit)?.['Unit Price'] || '';
  const filtered = state.inventory.filter((item) => `${item.Component} ${item.Kit} ${item.Category} ${item.Colour} ${item.Notes} ${priceFor(item)}`.toLowerCase().includes(query) && (!tier || item.Tier === tier) && (!kit || item.Kit === kit));
  const pageCount = Math.max(1, Math.ceil(filtered.length / componentPageSize));
  componentPage = Math.max(1, Math.min(componentPage, pageCount));
  const pageRows = filtered.slice((componentPage - 1) * componentPageSize, componentPage * componentPageSize);
  const kits = [...new Set(state.inventory.map((item) => item.Kit).filter(Boolean))].sort();
  const groupedRows = [...new Set(pageRows.map((item) => item.Kit).filter(Boolean))].sort().map((kitName) => {
    const kitRows = pageRows.filter((item) => item.Kit === kitName);
    const inventoryRows = kitRows.map((item) => {
      const index = state.inventory.indexOf(item);
      const itemPrice = priceFor(item);
      return [
        item.Component,
        itemPrice ? `HK$${itemPrice}` : 'Not priced',
        item.Colour || '—',
        item.Category || '—',
        item.Tier || '—',
        `<input class="inline-input inventory-qty-input" type="number" min="0" data-center-inventory-qty="${index}" value="${escapeHtml(item['Total center qty'] || '0')}">`,
        `<input class="inline-input inventory-date-input" type="date" data-center-inventory-date="${index}" value="${escapeHtml(item['Last counted'] || '')}">`,
        `<textarea class="inventory-note-input" data-center-inventory-note="${index}" rows="2" placeholder="Add note">${escapeHtml(item.Notes || '')}</textarea>`
      ];
    });
    return `<section class="inventory-kit-group"><div class="inventory-kit-heading"><div><span class="eyebrow">KIT INVENTORY</span><h2>${text(kitName)}</h2></div><span>${kitRows.length} components</span></div>${tableMarkup(['Component', 'Price', 'Colour', 'Category', 'Tier', 'Centre qty', 'Last counted', 'Notes'], inventoryRows)}</section>`;
  }).join('');
  content.innerHTML = header('Component Inventory', 'Centre-owned stock ledger. Grouped by kit and not linked to students.') + `<div class="inventory-summary"><strong>${state.inventory.length}</strong><span>Centre inventory items</span></div><div class="table-tools"><input id="componentSearch" class="table-search" placeholder="Search component, category, colour, or price..." value="${text(query)}"><select id="componentKit" class="table-filter"><option value="">All kits</option>${kits.map((value) => `<option ${kit === value ? 'selected' : ''}>${text(value)}</option>`).join('')}</select><select id="componentTier" class="table-filter"><option value="">All tiers</option><option ${tier === 'Tier A' ? 'selected' : ''}>Tier A</option><option ${tier === 'Tier B' ? 'selected' : ''}>Tier B</option><option ${tier === 'Tier C' ? 'selected' : ''}>Tier C</option></select><span>Page ${componentPage} / ${pageCount}</span><button class="mini-button" data-component-page="prev">←</button><button class="mini-button" data-component-page="next">→</button></div><div class="inventory-groups">${groupedRows || '<div class="empty-state">No inventory items match the current filters.</div>'}</div>`;
  document.querySelectorAll('#componentSearch, #componentKit, #componentTier').forEach((control) => control.onchange = control.oninput = () => { componentPage = 1; renderComponents(); document.querySelector('#componentSearch')?.focus(); });
  document.querySelectorAll('[data-component-page]').forEach((item) => item.onclick = () => { componentPage += item.dataset.componentPage === 'next' ? 1 : -1; renderComponents(); });
  document.querySelectorAll('[data-center-inventory-qty]').forEach((input) => input.onchange = () => { state.inventory[Number(input.dataset.centerInventoryQty)]['Total center qty'] = input.value; save('inventory', state.inventory); });
  document.querySelectorAll('[data-center-inventory-date]').forEach((input) => input.onchange = () => { state.inventory[Number(input.dataset.centerInventoryDate)]['Last counted'] = input.value; save('inventory', state.inventory); });
  document.querySelectorAll('[data-center-inventory-note]').forEach((input) => input.onchange = () => { state.inventory[Number(input.dataset.centerInventoryNote)].Notes = input.value; save('inventory', state.inventory); });
}

function renderLibraries(active = 'AIKIRO') {
  content.innerHTML = header('Libraries & curriculum', 'Three clear database areas: robot programmes, components, and coding curriculum.') + `<div class="library-tabs">${['Robot Library', 'Component Library', 'Coding Curriculum', 'Component Inventory'].map((name) => button(name, `library-section:${name}`, 'tab-button')).join('')}</div><div id="libraryTable"></div>`;
  showLibrarySection('Robot Library');
}
function showLibrarySection(section) {
  activeLibrarySection = section;
  const target = document.querySelector('#libraryTable');
  if (section === 'Robot Library') target.innerHTML = `<div class="library-tabs sub-tabs">${programmeVariants().map((name) => button(name, `library:${name}`, 'tab-button')).join('')}</div><div id="subLibraryTable"></div>`;
  if (section === 'Component Library') target.innerHTML = `<div class="library-tabs sub-tabs">${programmeVariants().map((name) => button(name, `library:${name}`, 'tab-button')).join('')}</div><div id="subLibraryTable"></div>`;
  if (section === 'Coding Curriculum') target.innerHTML = `<div class="library-tabs sub-tabs">${['CS1 curriculum','CS2 curriculum','CS3 curriculum','CS4 curriculum','CS5 curriculum','CodeMonkey curriculum'].map((name) => button(name, `library:${name}`, 'tab-button')).join('')}</div><div id="subLibraryTable"></div>`;
  if (section === 'Component Inventory') { target.innerHTML = '<div id="subLibraryTable"></div>'; showLibrary('Component inventory'); return; }
  const defaultTab = section === 'Coding Curriculum' ? 'CS1 curriculum' : programmeVariants()[0];
  showLibrary(defaultTab);
  document.querySelectorAll('#libraryTable > .library-tabs .tab-button').forEach((item) => item.onclick = () => { if (item.dataset.action.startsWith('library-section:')) showLibrarySection(item.textContent); else showLibrary(item.textContent); });
}
function showLibrary(name) {
  const target = document.querySelector('#subLibraryTable') || document.querySelector('#libraryTable');
  let headers = [], rows = [];
  if (programmeVariants().includes(name)) {
    if (activeLibrarySection === 'Robot Library') {
      headers = ['Sequence', 'Robot', 'Level', 'Kit'];
      const match = name.match(/^(AIKIRO|ROBOKIT|UARO)\s+(Lv\d+(?:_[a-z]+)?)/i);
      const kitKey = match?.[1]?.toUpperCase() || '';
      const levelKey = match?.[2]?.toLowerCase() || '';
      rows = state.robots.filter((row) => String(row['Kit name']).toUpperCase() === kitKey && (kitKey !== 'AIKIRO' || String(row.Level).toLowerCase() === levelKey) && (kitKey === 'AIKIRO' || levelNumber(row.Level) === levelNumber(levelKey))).map((row) => [row.Sequence, row['Robot name'], row.Level, row['Kit name']]);
    } else {
      headers = ['Component', 'Tier', 'Unit price', 'Levels'];
      const match = name.match(/^(AIKIRO|ROBOKIT|UARO)\s+(Lv\d+(?:_[a-z]+)?)/i);
      const kitKey = match?.[1]?.toUpperCase() || '';
      const levelKey = match?.[2]?.toLowerCase().replace(/_original|_additional/, '') || '';
      const componentKit = kitKey === 'UARO' ? 'URAO' : kitKey;
      const unique = state.componentLibrary.filter((row) => String(row.Kit).toUpperCase() === componentKit && Number(row[levelKey.replace('lv', 'Lv')] || 0) > 0);
      rows = unique.map((row) => [row.Component, row.Tier, price(row['Unit Price']), `${name} · ${row['Appears in levels']}`]);
    }
  }
  if (name === 'Component inventory') { headers = ['Component', 'Tier', 'Category', 'Colour', 'Kit', 'Expected qty', 'Centre qty', 'Result']; rows = state.inventory.map((row, index) => { const expected = row['Required Qty'] || row['Demo qty'] || '0'; const actual = row['Total center qty'] || '0'; const options = Array.from({ length: 51 }, (_, value) => `<option value="${value}" ${String(actual) === String(value) ? 'selected' : ''}>${value}</option>`).join(''); return [row.Component, row.Tier, row.Category, row.Colour, row.Kit, expected, `<select class="inline-input" data-inventory-qty="${index}">${options}</select>`, quantityResult(expected, actual)]; }); }
  if (/^CS[1-5] curriculum$/.test(name) || name === 'CodeMonkey curriculum') { const program = name.replace(' curriculum', '').toLowerCase(); headers = ['Item', 'Level', 'Topic', 'Program']; rows = state.curriculum.filter((row) => program === 'codemonkey' ? String(row['Program name']).toLowerCase().startsWith('codemonkey') : row['Program name'] === program.toUpperCase()).map((row) => [row.Item, row.Level, row.Topic, row['Program name']]); }
  target.innerHTML = table(headers, rows);
  document.querySelectorAll('[data-inventory-qty]').forEach((input) => input.onchange = () => { const row = state.inventory[Number(input.dataset.inventoryQty)]; row['Total center qty'] = input.value; save('inventory', state.inventory); showLibrary('Component inventory'); });
  document.querySelectorAll('.tab-button').forEach((item) => item.onclick = () => showLibrary(item.textContent));
}

function renderOperations() {
  content.innerHTML = header('Borrowing log', 'Track borrowed components, returns, kits, and student ownership.') + '<div id="operationTable"></div>';
  showOperation('Borrowing');
}
function showOperation(name) {
  const target = document.querySelector('#operationTable');
  if (name === 'Borrowing') {
    target.innerHTML = header('Student borrowing', 'Each record links one student to a component from that student’s checklist.', button('Log borrowing +', 'new-borrowing', 'primary-button')) + table(['Date', 'Student', 'Borrowed component', 'Qty', 'Status', 'Returned'], state.borrowings.map((row, index) => [text(row.sourceRow?.['Borrowed on'] || today()), text(row.borrower || row.sourceRow?.Student), text(row.item), text(row.sourceRow?.Quantity), `<button class="status-button borrowing-status" data-borrowing="${index}">${text(row.status)}</button>`, text(row.sourceRow?.['Returned on'])]));
    document.querySelectorAll('[data-borrowing]').forEach((item) => item.onclick = () => { const row = state.borrowings[Number(item.dataset.borrowing)]; row.status = row.status === 'Returned' ? 'Still borrowing' : 'Returned'; if (row.sourceRow) row.sourceRow['Returned on'] = row.status === 'Returned' ? today() : ''; save('borrowings', state.borrowings); showOperation('Borrowing'); });
  }
}

function renderTool(name) {
  if (name === 'Coding Student Profiles') return renderCodingStudents();
  if (name === 'Borrowing') return showOperation('Borrowing');
}

function openForm(title, fields, submit) {
  document.querySelector('#modalTitle').textContent = title;
  document.querySelector('#recordForm').innerHTML = fields.map((field) => field.type === 'select' ? `<label>${field.label}<select name="${field.name}" ${field.required ? 'required' : ''}>${field.options}</select></label>` : `<label>${field.label}<input name="${field.name}" type="${field.type || 'text'}" ${field.required ? 'required' : ''}></label>`).join('') + '<button class="primary-button" type="submit">Save</button>';
  document.querySelector('#modalBackdrop').hidden = false;
  document.querySelector('#recordForm').onsubmit = (event) => { event.preventDefault(); submit(Object.fromEntries(new FormData(event.target))); document.querySelector('#modalBackdrop').hidden = true; };
}
function openBorrowingForm(studentOptions) {
  document.querySelector('#modalTitle').textContent = 'Log borrowing';
  document.querySelector('#recordForm').innerHTML = `<label>Student<select name="student" id="borrowStudent" required>${studentOptions}</select></label><label>Borrowed component<select name="component" id="borrowComponent" required></select></label><label>Quantity<select name="quantity" required>${Array.from({ length: 21 }, (_, value) => `<option value="${value}">${value}</option>`).join('')}</select></label><button class="primary-button" type="submit">Save borrowing</button>`;
  const studentSelect = document.querySelector('#borrowStudent');
  const componentSelect = document.querySelector('#borrowComponent');
  const updateComponents = () => {
    const rows = state.componentItems.filter((row) => row.student === studentSelect.value);
    componentSelect.innerHTML = rows.length ? rows.map((row) => `<option value="${escapeHtml(row.item)}">${text(row.item)} · ${text(row.tier)}</option>`).join('') : '<option value="">No checklist components</option>';
  };
  studentSelect.onchange = updateComponents;
  updateComponents();
  document.querySelector('#modalBackdrop').hidden = false;
  document.querySelector('#recordForm').onsubmit = (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const checklist = state.componentItems.filter((row) => row.student === data.student);
    const component = checklist.find((row) => row.item === data.component);
    if (!component) return;
    state.borrowings.push({ item: component.item, borrower: data.student, status: 'Still borrowing', sourceRow: { Student: data.student, Component: component.item, Quantity: data.quantity, Kit: component.kit, Status: 'Still borrowing', 'Borrowed on': today(), 'Returned on': '' } });
    save('borrowings', state.borrowings);
    document.querySelector('#modalBackdrop').hidden = true;
    showOperation('Borrowing');
  };
}

function createProgrammeRecords(studentName, program) {
  const programLabel = display(program);
  const kit = programLabel.match(/^(AIKIRO|ROBOKIT|UARO)/i)?.[1]?.toUpperCase() || '';
  const robotKit = kit;
  const componentKit = kit === 'UARO' ? 'URAO' : kit;
  const level = programLabel.match(/Lv\d+(?:_[a-z]+)?/i)?.[0] || '';
  const progress = state.robots
    .filter((robot) => String(robot['Kit name']).toUpperCase() === robotKit && levelNumber(robot.Level) === levelNumber(level))
    .sort((left, right) => Number(left.Sequence || 0) - Number(right.Sequence || 0))
    .map((robot) => ({
      Robot: robot['Robot name'],
      Sequence: robot.Sequence,
      Status: 'Not started',
      Notes: '',
      Level: level,
      Student: studentName,
      'Student (linked)': studentName,
    }));
  const checklist = state.componentLibrary
    .filter((component) => String(component.Kit).toUpperCase() === componentKit)
    .map((component) => {
      const required = component[`${level.split('_')[0]} total`] || component[level.split('_')[0]] || '0';
      return { component, required: Number(required) || 0 };
    })
    .filter(({ required }) => required > 0)
    .map(({ component, required }) => ({
      item: component.Component,
      tier: component.Tier || '',
      requiredQty: String(required),
      studentQty: '',
      quantityStatus: 'Missing',
      student: studentName,
      kit: kit,
      level,
      unitPrice: component['Unit Price'] ? price(component['Unit Price']) : '',
      priceOptions: component['Unit Price'] ? [price(component['Unit Price'])] : [],
      sourcePath: 'Generated from Component Library',
      sourceRow: { Item: component.Component, Tier: component.Tier || '', 'Required Qty': String(required), 'Student Qty': '', 'Qty status': 'Missing', Notes: '' },
    }));
  state.robotProgress.push(...progress);
  state.componentItems.push(...checklist);
  return { progress, checklist };
}

function replaceStudentProgramme(student, program) {
  state.robotProgress = state.robotProgress.filter((row) => display(row.Student || row['Student (linked)']) !== student.name);
  state.componentItems = state.componentItems.filter((row) => row.student !== student.name);
  const generated = createProgrammeRecords(student.name, program);
  student.program = program;
  student.nextRobot = generated.progress[0]?.Robot || '';
  student.completion = '0%';
  student.sourceRow.Check = 'Not yet checked';
  save('robot-students', state.robotStudents);
  save('robot-progress', state.robotProgress);
  save('component-items', state.componentItems);
}

function rebuildCurrentProfile() {
  const student = state.robotStudents.find((row) => row.name === selectedStudent);
  if (!student) return;
  replaceStudentProgramme(student, student.program);
  renderStudentProfile();
}

function repairStudentLinks() {
  state.robotStudents.forEach((student) => {
    const hasProgress = state.robotProgress.some((row) => display(row.Student || row['Student (linked)']) === student.name);
    const hasChecklist = state.componentItems.some((row) => row.student === student.name);
    if (!hasProgress || !hasChecklist) {
      state.robotProgress = state.robotProgress.filter((row) => display(row.Student || row['Student (linked)']) !== student.name);
      state.componentItems = state.componentItems.filter((row) => row.student !== student.name);
      const generated = createProgrammeRecords(student.name, student.program);
      student.nextRobot = student.nextRobot || generated.progress[0]?.Robot || '';
      student.completion = student.completion || '0%';
    }
  });
  save('robot-students', state.robotStudents);
  save('robot-progress', state.robotProgress);
  save('component-items', state.componentItems);
}

function handleAction(action) {
  if (action === 'robot-students') { activeView = 'Robot Students'; render(); }
  if (action === "today-students") { activeView = "Today's Students"; renderTodaysStudents(); }
  if (action === 'checklist') { activeView = 'Student Checklist'; renderStudentChecklist(); }
  if (action === 'regenerate-programme') { const student = state.robotStudents.find((row) => row.name === selectedStudent); if (student) { replaceStudentProgramme(student, student.program); renderStudentProfile(); } }
  if (action === 'coding-students') { activeView = 'Coding Students'; render(); }
  if (action === 'new-robot') openForm('Add robot student', [{ label: 'Student name', name: 'name', required: true }, { label: 'Programme', name: 'program', type: 'select', options: [...new Set(state.robotPrograms.map((row) => row.Program))].map((program) => `<option>${text(program)}</option>`).join(''), required: true }], (data) => { createProgrammeRecords(data.name, data.program); state.robotStudents.push({ name: data.name, program: data.program, nextRobot: state.robotProgress.find((row) => row.Student === data.name)?.Robot || '', completion: '0%', sourceRow: { Student: data.name, Program: data.program, Check: 'Not yet checked' } }); save('robot-students', state.robotStudents); save('robot-progress', state.robotProgress); save('component-items', state.componentItems); selectedStudent = data.name; renderStudentProfile(); });
  if (action === 'new-borrowing') {
    const studentOptions = state.robotStudents.map((row) => `<option value="${escapeHtml(row.name)}">${text(row.name)} · ${text(programmeLabel(row.program))}</option>`).join('');
    openBorrowingForm(studentOptions);
  }
  if (action === 'change-programme') openForm('Change programme', [{ label: 'Programme', name: 'program', type: 'select', options: [...new Set(state.robotPrograms.map((row) => row.Program))].map((program) => `<option>${text(program)}</option>`).join(''), required: true }], (data) => { const student = state.robotStudents.find((row) => row.name === selectedStudent); if (student) { replaceStudentProgramme(student, data.program); renderStudentProfile(); } });
  if (action === 'check-components') { const student = state.robotStudents.find((row) => row.name === selectedStudent); const items = state.componentItems.filter((row) => row.student === selectedStudent); const valid = items.length > 0 && items.every((row) => row.studentQty !== ''); if (student) student.sourceRow.Check = valid ? 'Checked' : 'Not yet checked'; renderStudentChecklist(); }
  if (action.startsWith('view:')) { activeView = action.slice(5); render(); }
  if (action.startsWith('library:')) showLibrary(action.slice(8));
  if (action.startsWith('library-section:')) showLibrarySection(action.slice(16));
  if (action.startsWith('operation:')) showOperation(action.slice(10));
}

document.addEventListener('click', (event) => { const action = event.target.closest('[data-action]')?.dataset.action; if (action) handleAction(action); });
content.addEventListener('click', (event) => {
  const profile = event.target.closest('[data-profile]');
  if (profile) { selectedStudent = state.robotStudents[Number(profile.dataset.profile)].name; renderStudentProfile(); }
  const action = event.target.closest('[data-action]');
  if (action?.dataset.studentName) {
    selectedStudent = action.dataset.studentName;
    if (action.dataset.action === 'coding-profile') renderCodingProfile(state.codingStudents.find((row) => row.name === selectedStudent));
  }
});
content.addEventListener('change', (event) => {
  if (event.target.matches('[data-carry-status]')) {
    const student = state.robotStudents.find((row) => row.name === selectedStudent);
    if (student) { student.carryStatus = event.target.value; save('robot-students', state.robotStudents); renderStudentProfile(); }
  }
  if (event.target.matches('[data-carry-status-student]')) {
    const student = state.robotStudents.find((row) => row.name === event.target.dataset.carryStatusStudent);
    if (student) { student.carryStatus = event.target.value; save('robot-students', state.robotStudents); }
  }
  if (event.target.matches('[data-tutor-student]')) {
    const name = event.target.dataset.tutorStudent;
    const robot = state.robotStudents.find((row) => row.name === name);
    const coding = state.codingStudents.find((row) => row.name === name);
    if (robot) { robot.tutor = event.target.value; robot.sourceRow.Tutor = event.target.value; save('robot-students', state.robotStudents); }
    if (coding) { coding.tutor = event.target.value; save('coding-students', state.codingStudents); }
  }
  if (event.target.matches('[data-lesson-notes]')) {
    const row = todayLessonRows().find((item) => item.name === event.target.dataset.lessonNotes);
    if (row?.lesson) { row.lesson.Remarks = event.target.value; save(row.type === 'Robot' ? 'robot-lessons' : 'coding-lessons', row.type === 'Robot' ? state.robotLessons : state.codingLessons); }
  }
  if (event.target.matches('[data-checklist-qty]')) {
    const row = state.componentItems[Number(event.target.dataset.checklistQty)];
    row.studentQty = event.target.value; row.quantityStatus = quantityResult(row.requiredQty, event.target.value); row.sourceRow['Student Qty'] = event.target.value; row.sourceRow['Qty status'] = row.quantityStatus; save('component-items', state.componentItems); renderStudentChecklist();
  }
  if (event.target.matches('[data-checklist-note]')) { state.componentItems[Number(event.target.dataset.checklistNote)].sourceRow.Notes = event.target.value; save('component-items', state.componentItems); }
  if (event.target.matches('.universal-sort')) refreshUniversalTable(event.target.closest('.universal-table'));
});
content.addEventListener('input', (event) => { if (event.target.matches('.universal-search')) refreshUniversalTable(event.target.closest('.universal-table')); });
content.addEventListener('click', (event) => { if (event.target.matches('.universal-clear')) { const container = event.target.closest('.universal-table'); container.querySelector('.universal-search').value = ''; container.querySelector('.universal-sort').value = 'asc'; refreshUniversalTable(container); } });
document.querySelector('#closeModal').onclick = () => { document.querySelector('#modalBackdrop').hidden = true; };
document.querySelector('#modalBackdrop').onclick = (event) => { if (event.target.id === 'modalBackdrop') document.querySelector('#modalBackdrop').hidden = true; };
document.querySelector('#menuButton').onclick = () => document.querySelector('.sidebar')?.classList.toggle('open');
document.querySelector('#exportButton').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'icc-control-room-export.json';
  link.click();
  URL.revokeObjectURL(link.href);
};
document.querySelector('#globalSearch').oninput = (event) => {
  const query = event.target.value.trim().toLowerCase();
  if (!query) return render();
  const rows = state.robotStudents.filter((student) => JSON.stringify(student).toLowerCase().includes(query));
  activeView = 'Students';
  renderNav();
  document.querySelector('#breadcrumb').textContent = `Students · ${rows.length} matches`;
  content.innerHTML = header('Student search', `${rows.length} matching student profiles.`) + table(['Student', 'Programme', 'Next robot', 'Completion', 'Check'], rows.map((student) => [text(student.name), text(student.program), text(student.nextRobot), text(student.completion), text(student.sourceRow?.Check)]));
};
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelector('.sidebar')?.classList.remove('open'); });

function renderDataLoadError(error) {
  content.innerHTML = header('Database unavailable', 'Safari could not load workspace-db.json. Open the website through its web URL, not by double-clicking index.html.') + `<div class="empty"><p>Use the published URL or start a local server in the website folder:</p><code>python3 -m http.server 4173</code><p>${text(error?.message || 'Database request failed')}</p></div>`;
}

fetch(`./workspace-db.json?v=${Date.now()}`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error(`Database request returned ${response.status}`); return response.json(); }).then((value) => { Object.assign(state, value); const savedStudents = load('robot-students', []); if (savedStudents.length) state.robotStudents = savedStudents; const savedCodingStudents = load('coding-students', []); if (savedCodingStudents.length) state.codingStudents = savedCodingStudents; const savedLessons = load('robot-lessons', []); if (savedLessons.length) state.robotLessons = savedLessons; const savedCodingLessons = load('coding-lessons', []); if (savedCodingLessons.length) state.codingLessons = savedCodingLessons; const savedItems = load('component-items', []); const savedByKey = new Map(savedItems.map((row) => [`${row.student}:${row.item}`, row])); state.componentItems = state.componentItems.map((row) => { const saved = savedByKey.get(`${row.student}:${row.item}`); return saved ? { ...row, studentQty: saved.studentQty, quantityStatus: quantityResult(row.requiredQty, saved.studentQty), sourceRow: { ...row.sourceRow, Notes: saved.sourceRow?.Notes || row.sourceRow?.Notes || '' } } : row; }); const savedInventory = load('inventory', []); const savedInventoryByKey = new Map(savedInventory.map((row) => [`${row.Kit}:${row.Component}`, row])); state.inventory = state.inventory.map((row) => { const saved = savedInventoryByKey.get(`${row.Kit}:${row.Component}`); return saved ? { ...row, 'Total center qty': saved['Total center qty'], 'Last counted': saved['Last counted'] || row['Last counted'], Notes: saved.Notes || row.Notes } : row; }); const savedProgress = load('robot-progress', []); if (savedProgress.length) state.robotProgress = savedProgress; progressFinishDates = load('progress-finish-dates', {}); repairStudentLinks(); render(); }).catch(renderDataLoadError);
