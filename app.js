const groups = [
  { name: 'Students', icon: '◎' },
  { name: 'Libraries & curriculum', icon: '⌘' },
  { name: 'Operations', icon: '↗' },
];
const tools = [
  { name: 'Coding Student Profiles', icon: '⌘' },
];
const state = {
  files: [], robotStudents: [], codingStudents: [], codingProgress: [], borrowings: [],
  componentItems: [], robotProgress: [], codingLessons: [], robotLessons: [], curriculum: [],
  componentLibrary: [], inventory: [], robotPrograms: [], robots: [], reminders: [],
};
let activeView = 'Students';
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
const today = () => new Date().toISOString().slice(0, 10);
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
  const formatCell = (cell) => /<(?:button|input|select|option|textarea)\b/i.test(String(cell)) ? cell : escapeHtml(display(cell));
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
  const controls = options.map((option) => `<select class="table-filter" data-filter-index="${option.index}"><option value="">All ${escapeHtml(option.label)}</option>${[...new Set(rows.map((row) => display(row[option.index])))] .filter((value) => value !== '—').sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select>`).join('');
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
    const filtered = rows.filter((row) => filters.every((item) => !item.value || display(row[Number(item.dataset.filterIndex)]) === item.value));
    wrapper.innerHTML = table(headers, filtered);
  });
}
function text(value) { return escapeHtml(display(value)); }
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
  toolNav.innerHTML = tools.map((tool) => `<button data-view="${tool.name}"><span class="nav-icon">${tool.icon}</span>${tool.name}</button>`).join('');
  document.querySelectorAll('#nav button, #toolNav button').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === activeView);
    item.onclick = () => { activeView = item.dataset.view; selectedStudent = ''; render(); if (window.innerWidth <= 760) closeSidebar(); };
  });
}

function render() {
  renderNav();
  document.querySelector('#breadcrumb').textContent = activeView;
  if (activeView === 'Students') renderStudents();
  else if (activeView === 'Coding Students') renderCodingStudents();
  else if (activeView === 'Libraries & curriculum' || activeView === 'AIKIRO' || activeView === 'UARO' || activeView === 'ROBOKIT' || /^CS[1-5] curriculum$/.test(activeView) || activeView === 'CodeMonkey curriculum') renderLibraries(activeView);
  else if (activeView === 'Operations') renderOperations();
  else if (activeView === 'Component inventory') renderComponents();
  else if (tools.some((tool) => tool.name === activeView)) renderTool(activeView);
  else renderStudents();
}

function renderStudents() {
  const rows = state.robotStudents.map((student, index) => [`<button class="link-button" data-profile="${index}">${text(student.name)}</button>`, text(programmeLabel(student.program)), text(student.nextRobot), text(student.completion), text(student.sourceRow?.Check), text(student.sourceRow?.['Monthly attendance'])]);
  content.innerHTML = header('Robot students', '24 student profiles with programme, progress, next robot, attendance, and checks.', button('New profile +', 'new-robot', 'primary-button')) + tableFilters([{ label: 'Programme', index: 1 }, { label: 'Check', index: 4 }], rows, ['Student', 'Programme', 'Next robot', 'Completion', 'Check', 'Monthly attendance']);
  bindTableFilters();
}

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
  });
  document.querySelectorAll('[data-component-qty], [data-component-note], [data-inventory-qty], [data-progress-notes], [data-progress-date]').forEach((input) => input.onchange = () => {
    if (input.dataset.componentQty !== undefined) {
      const row = state.componentItems[Number(input.dataset.componentQty)];
      row.studentQty = input.value;
      row.quantityStatus = quantityResult(row.requiredQty, input.value);
      row.sourceRow['Student Qty'] = input.value;
      row.sourceRow['Qty status'] = row.quantityStatus;
    } else if (input.dataset.componentNote !== undefined) {
      state.componentItems[Number(input.dataset.componentNote)].sourceRow.Notes = input.value;
    } else if (input.dataset.inventoryQty !== undefined) {
      const row = state.inventory[Number(input.dataset.inventoryQty)];
      row['Total center qty'] = input.value;
      save('inventory', state.inventory);
      showLibrary('Component inventory');
      return;
    } else if (input.dataset.progressDate !== undefined) {
      progressFinishDates[input.dataset.progressDate] = input.value;
      save('progress-finish-dates', progressFinishDates);
      return;
    } else {
      progress[Number(input.dataset.progressNotes)].Notes = input.value;
    }
    save('component-items', state.componentItems);
    renderStudentProfile();
    save('robot-progress', state.robotProgress);
  });
}

function renderCodingStudents() {
  const rows = state.codingStudents.map((student, index) => [`<button class="link-button" data-coding-profile="${index}">${text(student.name)}</button>`, text(student.course), text(student.completion), text(student.lastUpdated), text(student.attendance), text(student.nextLevel), text(student.topics)]);
  content.innerHTML = header('Coding students', 'Coding profiles generated from the prepared student templates and progress files.') + table(['Student profile', 'Course', 'Completion', 'Last updated', 'Attendance', 'Next level', 'Topics learnt'], rows);
  document.querySelectorAll('[data-coding-profile]').forEach((item) => item.onclick = () => renderCodingProfile(state.codingStudents[Number(item.dataset.codingProfile)]));
}

function renderCodingProfile(student) {
  const lessons = state.codingProgress.filter((row) => row.sourceId === student.sourceId || (!row.sourceId && row.name === student.name));
  const topics = [...new Set(lessons.flatMap((row) => String(row.topics || '').split('→').map((topic) => topic.trim()).filter(Boolean)))];
  content.innerHTML = header(student.name, 'Coding progress shown as a compact lesson timeline and cumulative topic map.', button('← Coding students', 'coding-students', 'mini-button')) + `<div class="profile-grid"><div class="profile-panel"><span class="eyebrow">CODING PROFILE</span><h2>${text(student.course || 'Course not set')}</h2><p>Completion: <strong>${text(student.completion)}</strong></p><p>Next starting level: <strong>${text(student.nextLevel)}</strong></p><p>${text(student.attendance)}</p></div><div class="profile-panel"><span class="eyebrow">ALL TOPICS LEARNT</span><h2>${text(topics.join(' · ') || student.topics || 'No topics recorded')}</h2><p>${topics.length} unique topic${topics.length === 1 ? '' : 's'} across all lessons.</p></div></div><div id="codingAnalytics"></div><div class="section-heading"><h2>Progress calendar</h2></div>${table(['Date', 'Lesson', 'Status', 'Level', 'Topics', 'Remarks'], lessons.map((row) => [text(row.sourceRow?.['Lesson time']), text(row.project), text(row.status), `${text(row.next)} → ${text(row.progress)}`, text(row.topics), text(row.sourceRow?.Remarks)]), 'calendar-table')}`;
  const topicCounts = topics.reduce((counts, topic) => { counts[topic] = (counts[topic] || 0) + 1; return counts; }, {});
  const maxTopics = Math.max(1, ...Object.values(topicCounts));
  document.querySelector('#codingAnalytics').innerHTML = `<div class="analytics-grid"><div class="analytics-panel"><span class="eyebrow">TOPICS BY CATEGORY</span>${Object.entries(topicCounts).map(([topic, count]) => `<div class="bar-row"><span>${text(topic)}</span><i style="width:${Math.round(count / maxTopics * 100)}%"></i><b>${count}</b></div>`).join('') || '<div class="empty">No lesson topics recorded.</div>'}</div><div class="analytics-panel"><span class="eyebrow">LEVEL SUMMARY</span><div class="level-cards"><div><strong>${text(student.nextLevel || '—')}</strong><span>Current / next level</span></div><div><strong>${lessons.filter((lesson) => String(lesson.status).toLowerCase() === 'done').length}</strong><span>Completed lessons</span></div><div><strong>${topics.length}</strong><span>Unique topics</span></div></div></div></div>`;
}

function renderComponents() {
  const query = document.querySelector('#componentSearch')?.value?.toLowerCase() || '';
  const tier = document.querySelector('#componentTier')?.value || '';
  const status = document.querySelector('#componentStatus')?.value || '';
  const filtered = state.componentItems.filter((item) => `${item.item} ${item.student} ${item.kit} ${item.level}`.toLowerCase().includes(query) && (!tier || item.tier === tier) && (!status || quantityResult(item.requiredQty, item.studentQty) === status));
  const pageCount = Math.max(1, Math.ceil(filtered.length / componentPageSize));
  componentPage = Math.max(1, Math.min(componentPage, pageCount));
  const pageRows = filtered.slice((componentPage - 1) * componentPageSize, componentPage * componentPageSize);
  content.innerHTML = header('Component inventory', 'Search and inspect every checklist row. Edit quantities from the student profile.') + `<div class="table-tools"><input id="componentSearch" class="table-search" placeholder="Search item, student, kit..." value="${text(query)}"><select id="componentTier" class="table-filter"><option value="">All tiers</option><option ${tier === 'Tier A' ? 'selected' : ''}>Tier A</option><option ${tier === 'Tier B' ? 'selected' : ''}>Tier B</option><option ${tier === 'Tier C' ? 'selected' : ''}>Tier C</option></select><select id="componentStatus" class="table-filter"><option value="">All results</option><option ${status === 'Enough' ? 'selected' : ''}>Enough</option><option ${status === 'Missing' ? 'selected' : ''}>Missing</option></select><span>Page ${componentPage} / ${pageCount}</span><button class="mini-button" data-component-page="prev">←</button><button class="mini-button" data-component-page="next">→</button></div>` + table(['Item', 'Tier', 'Required', 'Student qty', 'Status', 'Student', 'Kit', 'Level', 'Unit price'], pageRows.map((item) => [item.item, item.tier, item.requiredQty, item.studentQty, quantityResult(item.requiredQty, item.studentQty), item.student, item.kit, item.level, item.unitPrice || 'Not priced']));
  document.querySelectorAll('#componentSearch, #componentTier, #componentStatus').forEach((control) => control.onchange = control.oninput = () => { componentPage = 1; renderComponents(); document.querySelector('#componentSearch')?.focus(); });
  document.querySelectorAll('[data-component-page]').forEach((item) => item.onclick = () => { componentPage += item.dataset.componentPage === 'next' ? 1 : -1; renderComponents(); });
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
  if (action === 'students') { activeView = 'Students'; render(); }
  if (action === 'regenerate-programme') { const student = state.robotStudents.find((row) => row.name === selectedStudent); if (student) { replaceStudentProgramme(student, student.program); renderStudentProfile(); } }
  if (action === 'coding-students') { activeView = 'Coding Student Profiles'; render(); }
  if (action === 'new-robot') openForm('Add robot student', [{ label: 'Student name', name: 'name', required: true }, { label: 'Programme', name: 'program', type: 'select', options: [...new Set(state.robotPrograms.map((row) => row.Program))].map((program) => `<option>${text(program)}</option>`).join(''), required: true }], (data) => { createProgrammeRecords(data.name, data.program); state.robotStudents.push({ name: data.name, program: data.program, nextRobot: state.robotProgress.find((row) => row.Student === data.name)?.Robot || '', completion: '0%', sourceRow: { Student: data.name, Program: data.program, Check: 'Not yet checked' } }); save('robot-students', state.robotStudents); save('robot-progress', state.robotProgress); save('component-items', state.componentItems); selectedStudent = data.name; renderStudentProfile(); });
  if (action === 'new-borrowing') {
    const studentOptions = state.robotStudents.map((row) => `<option value="${escapeHtml(row.name)}">${text(row.name)} · ${text(programmeLabel(row.program))}</option>`).join('');
    openBorrowingForm(studentOptions);
  }
  if (action === 'change-programme') openForm('Change programme', [{ label: 'Programme', name: 'program', type: 'select', options: [...new Set(state.robotPrograms.map((row) => row.Program))].map((program) => `<option>${text(program)}</option>`).join(''), required: true }], (data) => { const student = state.robotStudents.find((row) => row.name === selectedStudent); if (student) { replaceStudentProgramme(student, data.program); renderStudentProfile(); } });
  if (action === 'check-components') { const student = state.robotStudents.find((row) => row.name === selectedStudent); const items = state.componentItems.filter((row) => row.student === selectedStudent); const valid = items.length > 0 && items.every((row) => row.studentQty !== ''); if (student) student.sourceRow.Check = valid ? 'Checked' : 'Not yet checked'; renderStudentProfile(); }
  if (action.startsWith('view:')) { activeView = action.slice(5); render(); }
  if (action.startsWith('library:')) showLibrary(action.slice(8));
  if (action.startsWith('library-section:')) showLibrarySection(action.slice(16));
  if (action.startsWith('operation:')) showOperation(action.slice(10));
}

document.addEventListener('click', (event) => { const action = event.target.closest('[data-action]')?.dataset.action; if (action) handleAction(action); });
content.addEventListener('click', (event) => { const profile = event.target.closest('[data-profile]'); if (profile) { selectedStudent = state.robotStudents[Number(profile.dataset.profile)].name; renderStudentProfile(); } });
content.addEventListener('input', (event) => { if (event.target.matches('.universal-search')) refreshUniversalTable(event.target.closest('.universal-table')); });
content.addEventListener('change', (event) => { if (event.target.matches('.universal-sort')) refreshUniversalTable(event.target.closest('.universal-table')); });
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

fetch(`./workspace-db.json?v=${Date.now()}`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error(`Database request returned ${response.status}`); return response.json(); }).then((value) => { Object.assign(state, value); const savedStudents = load('robot-students', []); if (savedStudents.length) state.robotStudents = savedStudents; const savedLessons = load('robot-lessons', []); if (savedLessons.length) state.robotLessons = savedLessons; const savedItems = load('component-items', []); const savedByKey = new Map(savedItems.map((row) => [`${row.student}:${row.item}`, row])); state.componentItems = state.componentItems.map((row) => { const saved = savedByKey.get(`${row.student}:${row.item}`); return saved ? { ...row, studentQty: saved.studentQty, quantityStatus: quantityResult(row.requiredQty, saved.studentQty), sourceRow: { ...row.sourceRow, Notes: saved.sourceRow?.Notes || row.sourceRow?.Notes || '' } } : row; }); const savedInventory = load('inventory', []); const savedQuantities = new Map(savedInventory.map((row) => [row.Component, row['Total center qty']])); state.inventory = state.inventory.map((row) => ({ ...row, 'Total center qty': savedQuantities.has(row.Component) ? savedQuantities.get(row.Component) : row['Total center qty'] })); const savedProgress = load('robot-progress', []); if (savedProgress.length) state.robotProgress = savedProgress; progressFinishDates = load('progress-finish-dates', {}); repairStudentLinks(); render(); }).catch(renderDataLoadError);
