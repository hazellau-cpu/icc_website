const groups = [
  { name: "Today's Students", icon: '◔' },
  { name: 'Robot Students', icon: '◎' },
  { name: 'Coding Students', icon: '⌘' },
  { name: 'Math Students', icon: '∑' },
  { name: 'Libraries & Curriculum', icon: '▦' },
  { name: 'Center Inventory', icon: '▤' },
  { name: 'Borrowing Log', icon: '↗' },
  { name: 'System Status', icon: '◌' },
];
const tools = [];
const state = {
  files: [], robotStudents: [], codingStudents: [], codingProgress: [], borrowings: [],
  componentItems: [], robotProgress: [], robotProgressHistory: [], robotPathwayReviews: [], robotProgressReviews: [], localRobotProgressRemovals: [], codingLessons: [], robotLessons: [], mathLessons: [], curriculum: [], mathStudents: [], starterProgress: [],
  componentLibrary: [], inventory: [], centerInventory: [], robotPrograms: [], robots: [], reminders: [], dailyLessonDrafts: [], dailyLessonFinalizations: [],
};
let activeView = 'Robot Students';
let selectedStudent = '';
let componentPage = 1;
const componentPageSize = 25;
let progressFinishDates = {};
let activeLibrarySection = 'Robot Library';
let activeInventoryKit = 'ALL';
const todayConversion = { programme: 'CS1', start: '', end: '' };
const content = document.querySelector('#content');
const nav = document.querySelector('#nav');
const toolNav = document.querySelector('#toolNav');
let services;
const authBackdrop = document.querySelector('#authBackdrop');
const authButton = document.querySelector('#authButton');
const authForm = document.querySelector('#authForm');
const authError = document.querySelector('#authError');
const apiTokenKey = 'icc-api-access-token';
const userEmailKey = 'icc-authenticated-user-email';
const localDemoSessionKey = 'icc-local-demo-email';
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const localWorkspaceAllowed = window.ICC_FORCE_LOCAL_PREVIEW
  || isLocalHost;
const localDemoEnabled = isLocalHost && window.ICC_LOCAL_DEMO_LOGIN === true;
const localDemoSignedIn = localDemoEnabled && Boolean(sessionStorage.getItem(localDemoSessionKey));
const localGoogleSignInEnabled = localDemoEnabled && window.ICC_LOCAL_GOOGLE_SIGN_IN === true;
const localLiveSheetsEnabled = isLocalHost && window.ICC_LOCAL_LIVE_SHEETS === true;
const iapAuthEnabled = !localWorkspaceAllowed && window.ICC_AUTH_MODE === 'iap';
const liveSheetsMode = !localWorkspaceAllowed && window.ICC_LIVE_SHEETS === true;
let localLiveSheetsReady = false;
let liveSheetsStatus = { message: 'Not loaded.', details: null };
const localCalendarEnabled = isLocalHost && window.ICC_LOCAL_CALENDAR === true;
const remoteCalendarEnabled = !localWorkspaceAllowed && window.ICC_CALENDAR_ENABLED === true;
const calendarEnabled = localCalendarEnabled || remoteCalendarEnabled;
let calendarState = { status: 'loading', date: '', events: [], error: '' };
let calendarRefresh = null;
let sharedEdits = {};
const sharedEditVersions = {};
const sharedSaveQueues = new Map();
const localWorkspaceDataVersionKey = 'icc-local-workspace-data-version';
const useSavedLocalWorkspaceEdits = localWorkspaceAllowed
  && localStorage.getItem(localWorkspaceDataVersionKey) === 'james-paid-v1';
if (!localWorkspaceAllowed) {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('icc-')) localStorage.removeItem(key);
  }
} else {
  localStorage.removeItem(apiTokenKey);
  localStorage.removeItem(userEmailKey);
}

const getApiBaseUrl = () => {
  const configured = String(window.ICC_API_BASE_URL || '').trim();
  if (!configured) return '';
  try {
    const url = new URL(configured, window.location.origin);
    const localApi = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if ((!localApi && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return '';
    if (iapAuthEnabled && url.origin !== window.location.origin) return '';
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return '';
  }
};
const getAccessToken = () => (iapAuthEnabled || window.ICC_FORCE_LOCAL_PREVIEW || localDemoEnabled ? '' : sessionStorage.getItem(apiTokenKey) || '');
const setAccessToken = (token, email = '') => {
  localStorage.removeItem(apiTokenKey);
  localStorage.removeItem(userEmailKey);
  if (token) {
    sessionStorage.setItem(apiTokenKey, token);
    sessionStorage.setItem(userEmailKey, email);
  } else {
    sessionStorage.removeItem(apiTokenKey);
    sessionStorage.removeItem(userEmailKey);
  }
  updateAuthButton();
};
function updateAuthButton() {
  if (iapAuthEnabled && authButton) authButton.hidden = true;
  const signedInEmail = localDemoEnabled ? sessionStorage.getItem(localDemoSessionKey) : getAccessToken() && sessionStorage.getItem(userEmailKey);
  if (authButton && !iapAuthEnabled) authButton.textContent = signedInEmail ? `Sign out (${signedInEmail})` : 'Sign in';
  const workspaceMode = document.querySelector('#workspaceMode');
  const workspaceModeDetail = document.querySelector('#workspaceModeDetail');
  if (workspaceMode) workspaceMode.textContent = localWorkspaceAllowed ? 'Local workspace' : 'Protected workspace';
  if (workspaceModeDetail) workspaceModeDetail.textContent = localWorkspaceAllowed
    ? 'Changes saved in this browser'
    : iapAuthEnabled ? 'Access controlled by Google IAP'
      : getAccessToken() ? 'Connected to the protected backend' : 'Sign in to continue';
}
function showAuth(message = '') {
  if (iapAuthEnabled) return;
  if (!authBackdrop) return;
  authBackdrop.hidden = false;
  const notice = message || (!localDemoEnabled && !getApiBaseUrl() ? 'Sign-in is not configured. Contact the workspace administrator.' : '');
  authError.hidden = !notice;
  authError.textContent = notice;
}
function hideAuth() { if (authBackdrop && (!localDemoEnabled || localDemoSignedIn)) authBackdrop.hidden = true; }
async function setupLocalGoogleSignIn() {
  const container = document.querySelector('#googleSignIn');
  const status = document.querySelector('#googleSignInStatus');
  container.hidden = false;
  status.textContent = 'Loading Google sign-in...';
  const showError = (message) => { status.textContent = ''; authError.hidden = false; authError.textContent = message; };
  if (window.location.origin !== 'http://localhost:8000') {
    showError('The Google sign-in trial is available at http://localhost:8000/.');
    return;
  }
  try {
    const response = await fetch('http://127.0.0.1:8788/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The local Google sign-in service is unavailable.');
    const config = await response.json();
    if (!/^[0-9]+-[a-zA-Z0-9]+\.apps\.googleusercontent\.com$/.test(config.clientId)) throw new Error('The Google sign-in client is not configured.');
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Google sign-in could not load.'));
      document.head.appendChild(script);
    });
    if (!window.google?.accounts?.id) throw new Error('Google sign-in could not initialize.');
    window.google.accounts.id.initialize({
      client_id: config.clientId,
      callback: async ({ credential }) => {
        authError.hidden = true;
        status.textContent = 'Verifying Google sign-in...';
        try {
          const result = await fetch('http://127.0.0.1:8788/verify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential }), signal: AbortSignal.timeout(20000),
          });
          const data = await result.json();
          if (!result.ok || !data.email) throw new Error(data.detail || 'Google sign-in failed.');
          sessionStorage.setItem(localDemoSessionKey, data.email);
          window.location.reload();
        } catch (error) {
          console.error('Local Google sign-in failed:', error);
          showError(error.message || 'Google sign-in failed.');
        }
      },
      error_callback: () => showError('Google sign-in was not completed. Please try again.'),
    });
    window.google.accounts.id.renderButton(document.querySelector('#googleSignInButton'), { theme: 'outline', size: 'large', text: 'signin_with' });
    status.textContent = '';
  } catch (error) {
    console.error('Local Google sign-in setup failed:', error);
    showError(error.message || 'Google sign-in is unavailable.');
  }
}
async function handlePasswordSignIn(event) {
  event.preventDefault();
  authError.hidden = true;
  authButton.disabled = true;
  const submitButton = authForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const formData = new FormData(authForm);
    if (localDemoEnabled) {
      const response = await fetch('./secrets/local-demo-auth.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Local demo sign-in is unavailable. Check the private demo configuration.');
      const config = await response.json();
      if (!Array.isArray(config.emails) || typeof config.password !== 'string') throw new Error('Local demo sign-in configuration is invalid.');
      const email = String(formData.get('email') || '').trim().toLowerCase();
      if (!config.emails.includes(email) || formData.get('password') !== config.password) throw new Error('Invalid email or password.');
      sessionStorage.setItem(localDemoSessionKey, email);
      authForm.reset();
      window.location.reload();
      return;
    }
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) throw new Error('Sign-in is not configured. Contact the workspace administrator.');
    const response = await fetch(`${baseUrl}/auth/password`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `Sign-in failed (${response.status}).`);
    if (!data.access_token || !data.user?.email) throw new Error('Backend sign-in response was incomplete.');
    setAccessToken(data.access_token, data.user.email);
    authForm.reset();
    hideAuth();
    window.location.reload();
  } catch (error) {
    authError.hidden = false;
    authError.textContent = error.message || 'Sign-in failed.';
  } finally {
    authButton.disabled = false;
    submitButton.disabled = false;
  }
}
async function apiRequest(endpoint, method = 'GET', body, timeoutMs = 8000) {
  if (window.ICC_FORCE_LOCAL_PREVIEW) {
    throw new Error('Local CSV preview mode is active. The app is using the local database instead of the API.');
  }
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) throw new Error('API base URL is not configured by the workspace administrator.');
  const headers = { Accept: 'application/json' };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try { response = await fetch(`${baseUrl}/${String(endpoint).replace(/^\//, '')}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal }); } catch (error) { throw new Error(error.name === 'AbortError' ? 'Backend request timed out' : error.message); } finally { clearTimeout(timeout); }
  if (response.status === 401) {
    if (!iapAuthEnabled) {
      setAccessToken('');
      if (!localWorkspaceAllowed) window.location.reload();
      else showAuth('Your session has expired. Please sign in again.');
    }
    throw new Error(iapAuthEnabled ? 'IAP authentication required' : 'Authentication required');
  }
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof data === 'string' ? data || `API request failed (${response.status})` : data.detail || data.message || `API request failed (${response.status})`);
  return data;
}
window.apiRequest = apiRequest;

const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const saveStatus = document.querySelector('#workspaceSaveStatus');
let saveStatusTimer;
function setSaveStatus(message, failed = false) {
  if (!saveStatus) return;
  clearTimeout(saveStatusTimer);
  saveStatus.hidden = !message;
  saveStatus.textContent = message;
  saveStatus.classList.toggle('save-error', failed);
  if (message && !failed) saveStatusTimer = setTimeout(() => { saveStatus.hidden = true; }, 4000);
}
const save = (key, value) => {
  if (localWorkspaceAllowed) {
    localStorage.setItem(`icc-${key}`, JSON.stringify(value));
    return;
  }
  if (!iapAuthEnabled || ['borrowings', 'inventory'].includes(key)) return;
  const snapshot = JSON.parse(JSON.stringify(value));
  const previous = sharedSaveQueues.get(key) || Promise.resolve();
  const write = previous.catch(() => {}).then(async () => {
    setSaveStatus('Saving shared changes…');
    const response = await apiRequest(`/workspace/edits/${encodeURIComponent(key)}`, 'PUT', {
      expected_version: sharedEditVersions[key] || 0,
      value: snapshot,
    });
    sharedEditVersions[key] = response.version;
    sharedEdits[key] = { value: snapshot, version: response.version };
    setSaveStatus('Shared changes saved.');
  });
  sharedSaveQueues.set(key, write);
  write.catch((error) => {
    console.error(`Unable to save shared workspace edit "${key}":`, error);
    setSaveStatus(`Could not save changes: ${error.message}`, true);
  });
};
function mergeSharedStudentEdits(current, saved) {
  const identity = (student) => String(student.jamesStudentId || student.jamesData?.['Student ID'] || student.studentId || student.sourceRow?.['Student ID'] || '').trim().toUpperCase();
  const savedById = new Map(saved.map((student) => [identity(student), student]).filter(([id]) => id));
  return current.map((student) => {
    const previous = savedById.get(identity(student));
    if (!previous) return student;
    return {
      ...student,
      ...(previous.carryStatus !== undefined ? { carryStatus: previous.carryStatus } : {}),
      ...(previous.tutor !== undefined ? { tutor: previous.tutor } : {}),
    };
  });
}
const load = (key, fallback) => {
  if (localWorkspaceAllowed && !useSavedLocalWorkspaceEdits) return fallback;
  if (window.ICC_FORCE_LOCAL_PREVIEW && ['robot-students', 'coding-students', 'inventory', 'robot-lessons', 'coding-lessons'].includes(key)) return fallback;
  if (!localWorkspaceAllowed && iapAuthEnabled) return sharedEdits[key]?.value ?? fallback;
  if (!localWorkspaceAllowed) return fallback;
  try { return JSON.parse(localStorage.getItem(`icc-${key}`)) ?? fallback; } catch { return fallback; }
};
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

let localPathways = [];
let localPathwayError = '';
if (localWorkspaceAllowed) {
  try { localPathways = window.ICCLocalPathways.read(localStorage); }
  catch (error) {
    console.error('Unable to load local student pathways:', error);
    localPathwayError = 'Saved pathways could not be loaded. Editing is disabled to avoid overwriting them.';
  }
}
function pathwayFor(student, courseType = student?.studentType) {
  if (!localWorkspaceAllowed || !student || !courseType || !student.studentId) return null;
  const saved = window.ICCLocalPathways.find(localPathways, courseType, student.studentId);
  const review = courseType === 'Robot' ? state.robotPathwayReviews.find((item) => item.studentId === student.studentId) : null;
  return window.ICCLocalPathways.reviewedRobotPathway(saved, review);
}
function pathwayEditorButton(student, courseType) {
  if (!localWorkspaceAllowed || !student.studentId) return '';
  const pathway = pathwayFor(student, courseType);
  return `<div class="pathway-controls"><button type="button" class="mini-button" id="editPathway">Update pathway</button><small>${pathway?.reviewed ? 'Reviewed · local preview only' : pathway ? 'Manually recorded · this browser only' : 'Not confirmed · this browser only'}</small>${localPathwayError ? `<small role="alert">${text(localPathwayError)}</small>` : ''}</div>`;
}
function openPathwayEditor(student, courseType, renderProfile) {
  if (localPathwayError) {
    alert(localPathwayError);
    return;
  }
  const current = pathwayFor(student, courseType);
  const currentProgramme = studentProgramme(student);
  const options = courseType === 'Robot' ? programmeVariants() : ['CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CodeMonkey P1', 'CodeMonkey P2'];
  const normalise = (value) => String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const comparableProgramme = courseType === 'Coding' ? window.ICCLocalPathways.codingCurriculumProgramme(currentProgramme) : currentProgramme;
  const selected = options.find((option) => normalise(option) === normalise(comparableProgramme));
  const control = courseType === 'Math'
    ? `<input name="programme" required maxlength="100" value="${escapeHtml(current?.programme || '')}" placeholder="e.g. Math Level 2">`
    : `<select name="programme" required><option value="" ${selected ? '' : 'selected'} disabled>Select a programme</option>${options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? 'selected' : ''}>${text(courseType === 'Coding' && /^CS\d+$/.test(option) ? `${option} (CodeCombat Lv${option.slice(2)})` : option)}</option>`).join('')}</select>`;
  const history = current?.history || [];
  document.querySelector('#modalTitle').textContent = 'Update student pathway';
  document.querySelector('#recordForm').innerHTML = `<p class="auth-help">Saved only in this browser; the Google Sheet is not changed. A new Robot or Coding programme starts at its first level. Lessons on the change date or earlier stay in history; later lessons are assumed to belong to the new path.</p><label>${courseType === 'Math' ? 'Math programme or level' : 'Programme'}${control}</label>${history.length ? `<p class="auth-help">Previous pathways: ${history.map((entry) => `${text(entry.programme)} (until ${text(entry.endedOn)})`).join(', ')}</p>` : ''}<div class="auth-error" role="alert" hidden></div><button class="primary-button" type="submit">Save pathway</button>`;
  document.querySelector('#modalBackdrop').hidden = false;
  document.querySelector('#recordForm').onsubmit = (event) => {
    event.preventDefault();
    const errorElement = event.target.querySelector('[role="alert"]');
    const programme = String(new FormData(event.target).get('programme') || '').trim();
    try {
      if (courseType !== 'Math' && !options.includes(programme)) throw new Error('Choose a listed programme.');
      const records = window.ICCLocalPathways.update(localPathways, {
        courseType, studentId: student.studentId, programme, previousProgramme: currentProgramme === '—' ? '' : currentProgramme, date: today(),
      });
      window.ICCLocalPathways.write(localStorage, records);
      localPathways = records;
      document.querySelector('#modalBackdrop').hidden = true;
      renderProfile();
    } catch (error) {
      console.error('Unable to save student pathway:', error);
      errorElement.hidden = false;
      errorElement.textContent = 'Could not save the pathway. Check your selection and browser storage.';
    }
  };
}

const universalTableRegistry = new Map();
let universalTableId = 0;
function tableMarkup(headers, rows, className = '', sortRows = true, sortIndex = 0, direction = 'asc') {
  const sortableValue = (cell) => display(String(cell ?? '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ''));
  const sortedRows = sortRows ? [...rows].sort((left, right) => {
    const result = sortableValue(left[sortIndex]).localeCompare(sortableValue(right[sortIndex]), undefined, { numeric: true, sensitivity: 'base' });
    return direction === 'desc' ? -result : result;
  }) : rows;
  const formatCell = (cell) => /<(?:button|input|select|option|textarea|span|div|svg)\b/i.test(String(cell)) ? cell : escapeHtml(display(cell));
  return `<div class="records source-table ${className}"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(display(header))}</th>`).join('')}</tr></thead><tbody>${sortedRows.map((row) => `<tr>${row.map((cell) => `<td>${formatCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function table(headers, rows, className = '', sortIndex = 0) {
  const id = `universal-${universalTableId++}`;
  const defaultSort = [{ index: sortIndex, direction: 'asc' }];
  universalTableRegistry.set(id, { headers, rows, className, sortIndex, sortLevels: defaultSort });
  const sortOptions = (selectedIndex = '') => `<option value="">Then by...</option>${headers.map((header, index) => `<option value="${index}" ${String(index) === String(selectedIndex) ? 'selected' : ''}>${escapeHtml(display(header))}</option>`).join('')}`;
  const sortControl = (level, selectedIndex = '', direction = 'asc') => `<select class="table-filter universal-sort-field" data-sort-level="${level}">${sortOptions(selectedIndex)}</select><select class="table-filter universal-sort-direction" data-sort-level="${level}"><option value="asc" ${direction === 'asc' ? 'selected' : ''}>Ascending</option><option value="desc" ${direction === 'desc' ? 'selected' : ''}>Descending</option></select>`;
  return `<div class="universal-table" data-universal-id="${id}"><div class="table-tools universal-tools"><input class="table-search universal-search" placeholder="Search table..." aria-label="Search table"><span class="sort-label">Sort</span>${sortControl(0, sortIndex, 'asc')}${sortControl(1)}${sortControl(2)}<span class="active-filter-label">All records</span><button class="mini-button universal-clear" type="button">Clear filters</button></div>${tableMarkup(headers, rows, className, true, sortIndex)}</div>`;
}

function refreshUniversalTable(container) {
  const data = universalTableRegistry.get(container.dataset.universalId);
  if (!data) return;
  const query = container.querySelector('.universal-search').value.toLowerCase();
  const sortLevels = [...container.querySelectorAll('.universal-sort-field')].map((field) => ({ index: field.value === '' ? null : Number(field.value), direction: container.querySelector(`.universal-sort-direction[data-sort-level="${field.dataset.sortLevel}"]`).value })).filter((sort) => sort.index !== null);
  data.sortLevels = sortLevels;
  const filtered = data.rows.filter((row) => row.map((cell) => display(String(cell).replace(/<[^>]*>/g, ''))).join(' ').toLowerCase().includes(query));
  const ordered = [...filtered].sort((a, b) => {
    for (const sort of sortLevels) {
      const result = display(String(a[sort.index])).localeCompare(display(String(b[sort.index])), undefined, { numeric: true, sensitivity: 'base' });
      if (result) return sort.direction === 'desc' ? -result : result;
    }
    return 0;
  });
  container.querySelector('.active-filter-label').textContent = query ? `${ordered.length} matching records` : 'All records';
  container.querySelector('.records').outerHTML = tableMarkup(data.headers, ordered, data.className, false, data.sortIndex);
}
const tableFilterRegistry = new Map();
let tableFilterId = 0;
function tableFilters(options, rows, headers, className = '') {
  const id = `filter-${tableFilterId++}`;
  tableFilterRegistry.set(id, { headers, rows, className });
  const cellText = (value) => display(String(value ?? '').replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]*>/g, ''));
  const controls = options.map((option) => `<select class="table-filter" data-filter-index="${option.index}"><option value="">All ${escapeHtml(option.label)}</option>${[...new Set(rows.map((row) => cellText(row[option.index])))] .filter((value) => value !== '—').sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select>`).join('');
  return `<div class="table-tools filter-tools">${controls}</div><div class="filtered-table" data-filter-id="${id}">${table(headers, rows, className)}</div>`;
}
function bindTableFilters() {
  document.querySelectorAll('.table-filter').forEach((filter) => filter.onchange = () => {
    const wrapper = filter.closest('.filtered-table') || document.querySelector('.filtered-table');
    if (!wrapper) return;
    const filters = [...wrapper.parentElement.querySelectorAll('[data-filter-index]')];
    const data = tableFilterRegistry.get(wrapper.dataset.filterId);
    if (!data) return;
    const { headers, rows } = data;
    const filtered = rows.filter((row) => filters.every((item) => !item.value || display(String(row[Number(item.dataset.filterIndex)]).replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]*>/g, '')) === item.value));
    wrapper.innerHTML = table(headers, filtered, data.className);
  });
}
function text(value) { return escapeHtml(display(value)); }
function jamesStudentIdOf(record) {
  return String(record?.jamesStudentId
    || record?.jamesData?.['Student ID']
    || record?.['James Student ID']
    || record?.studentId
    || record?.['Student ID']
    || record?.sourceRow?.['Student ID']
    || '').trim();
}
function studentRecordIdentifiers(record) {
  return [...new Set([
    record.studentId,
    record['Student ID'],
    record.sourceRow?.['Student ID'],
    record.jamesStudentId,
    record.jamesData?.['Student ID'],
    typeof record.sourceId === 'string' && !/[/:]/.test(record.sourceId) ? record.sourceId : '',
  ].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];
}
function studentRecordMatches(row, student) {
  if (!row || !student) return false;
  const rowIds = studentRecordIdentifiers(row);
  const studentIds = studentRecordIdentifiers(student);
  if (rowIds.some((id) => studentIds.includes(id))) return true;

  const source = row.sourceRow || {};
  const name = [row.name, typeof row.student === 'string' ? row.student : '', row.borrower, row.Student,
    row['Student (linked)'], row['Student name'], row['Student (Coding)'], row['Student (Math)'],
    source.Student, source['Student Name'], source.Name, source['Student (linked)'], source['Student (Coding)'], source['Student (Math)']]
    .map((value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase())
    .find(Boolean);
  return Boolean(name && name === String(student.name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    && (!rowIds.length || !studentIds.length));
}
function belongsToStudent(row, student) {
  return studentRecordMatches(row, student);
}
function starterProgressMatches(record, student) {
  const recordId = jamesStudentIdOf(record).toUpperCase();
  const studentId = jamesStudentIdOf(student).toUpperCase();
  return recordId && studentId ? recordId === studentId : studentRecordMatches(record, student);
}
function starterProgressRecords(student, courseType) {
  return state.starterProgress.filter((record) => record.courseType === courseType && starterProgressMatches(record, student))
    .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
}
const starterProgressCsvHeaders = ['Student ID', 'Student Name', 'Course Type', 'Programme', 'Date', 'Progress Detail', 'Level or Stage', 'Status', 'Tutor', 'Notes'];
function csvCell(value) {
  const textValue = String(value ?? '');
  return /[",\r\n]/.test(textValue) ? `"${textValue.replaceAll('"', '""')}"` : textValue;
}
function starterProgressCsvTemplate() {
  const students = [
    ...state.robotStudents.map((student) => ({ student, courseType: 'Robot' })),
    ...state.codingStudents.map((student) => ({ student, courseType: 'Coding' })),
    ...state.mathStudents.map((student) => ({ student, courseType: 'Math' })),
  ];
  return [starterProgressCsvHeaders, ...students.map(({ student, courseType }) => [
    jamesStudentIdOf(student),
    student.name,
    courseType,
    studentProgramme(student),
    '',
    '',
    '',
    '',
    '',
    '',
  ])].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
function parseStarterProgressCsv(csvText) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (quoted) {
      if (character === '"' && csvText[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && !cell) quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n' || character === '\r') {
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      if (character === '\r' && csvText[index + 1] === '\n') index += 1;
    } else cell += character;
  }
  if (quoted) throw new Error('The CSV has an unfinished quoted field.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('The CSV has no progress rows to import.');

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, '').toLowerCase());
  const indexFor = (...names) => headers.findIndex((header) => names.includes(header));
  const columns = {
    studentId: indexFor('student id', 'student id (james)', 'james student id', 'internal student id'),
    jamesStudentId: indexFor('james student id'),
    name: indexFor('student name', 'student'),
    courseType: indexFor('course type', 'course'),
    programme: indexFor('programme', 'program'),
    date: indexFor('date', 'progress date'),
    detail: indexFor('progress detail', 'progress', 'topic or achievement'),
    level: indexFor('level or stage', 'level', 'stage'),
    status: indexFor('status'),
    tutor: indexFor('tutor'),
    notes: indexFor('notes'),
  };
  for (const required of ['studentId', 'name', 'courseType', 'date', 'detail']) {
    if (columns[required] < 0) throw new Error(`Missing required CSV column: ${required}. Download the latest template and keep its column headers.`);
  }
  return rows.slice(1).map((values, offset) => {
    const get = (column) => column < 0 ? '' : String(values[column] || '').trim();
    return {
      rowNumber: offset + 2,
      studentId: get(columns.studentId),
      jamesStudentId: get(columns.jamesStudentId),
      name: get(columns.name),
      courseType: get(columns.courseType),
      programme: get(columns.programme),
      date: get(columns.date),
      detail: get(columns.detail),
      level: get(columns.level),
      status: get(columns.status) || 'Recorded',
      tutor: get(columns.tutor),
      notes: get(columns.notes),
    };
  }).filter((record) => record.date || record.detail);
}
function importStarterProgressRows(rows) {
  const studentGroups = {
    Robot: state.robotStudents,
    Coding: state.codingStudents,
    Math: state.mathStudents,
  };
  const errors = [];
  const additions = [];
  let duplicates = 0;
  rows.forEach((row) => {
    const courseType = row.courseType.trim();
    const students = studentGroups[courseType];
    if (!students) { errors.push(`Row ${row.rowNumber}: Course Type must be Robot, Coding, or Math.`); return; }
    const canonicalStudentId = String(row.jamesStudentId || row.studentId).trim().toUpperCase();
    const student = students.find((item) => jamesStudentIdOf(item).toUpperCase() === canonicalStudentId);
    if (!student) { errors.push(`Row ${row.rowNumber}: no ${courseType} student matches Student ID “${row.jamesStudentId || row.studentId}”.`); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number.isNaN(Date.parse(`${row.date}T00:00:00`))) {
      errors.push(`Row ${row.rowNumber}: Date must use YYYY-MM-DD.`);
      return;
    }
    if (!row.detail) { errors.push(`Row ${row.rowNumber}: Progress Detail is required when a date is entered.`); return; }
    if (!['Recorded', 'In progress', 'Completed'].includes(row.status)) {
      errors.push(`Row ${row.rowNumber}: Status must be Recorded, In progress, or Completed.`);
      return;
    }
    const duplicate = [...state.starterProgress, ...additions].some((existing) =>
      existing.courseType === courseType
      && starterProgressMatches(existing, student)
      && existing.date === row.date
      && existing.detail === row.detail);
    if (duplicate) { duplicates += 1; return; }
    additions.push({
      id: globalThis.crypto?.randomUUID?.() || `starter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      courseType,
      studentId: jamesStudentIdOf(student),
      name: student.name,
      programme: row.programme || studentProgramme(student),
      date: row.date,
      detail: row.detail,
      level: row.level,
      status: row.status,
      tutor: row.tutor,
      notes: row.notes,
      source: 'pre-james',
    });
  });
  return { additions, errors, duplicates };
}
function downloadStarterProgressCsv() {
  const blob = new Blob(['\uFEFF', starterProgressCsvTemplate()], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'icc-starter-progress-template.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}
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
  const status = /absent/.test(raw) ? ['absent', 'Absent', 'off'] : /upcoming|planned/.test(raw) ? ['upcoming', 'Upcoming Lesson', 'clock'] : /no lessons|no lesson|not scheduled/.test(raw) ? ['none', 'No Lesson Scheduled', 'calendarX'] : ['present', 'Present', 'check'];
  return `<span class="status-badge attendance-${status[0]}">${icon(status[2])}<span>${status[1]}</span></span>`;
}
function checklistMarkup(student) {
  const items = state.componentItems.filter((row) => belongsToStudent(row, student));
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
function carryMasterMarkup(student) {
  const record = latestRobotCarryRecord(student);
  const status = record?.carryStatus || getCarryStatus(student);
  const config = status === 'Take Robot Home' ? ['carry-blue', 'home'] : status === 'Take Whole Kit Home' ? ['carry-orange', 'package'] : ['carry-green', 'warehouse'];
  return `<span class="carry-record ${config[0]}">${icon(config[1])}<span>${text(status)}</span>${record?.date ? `<small>${text(record.date)}</small>` : ''}</span>`;
}
function programmeLabel(value) {
  const clean = display(value);
  const kit = clean.match(/^(AIKIRO|ROBOKIT|UARO)/i)?.[1]?.toUpperCase() || '';
  return kit && !clean.endsWith(` - ${kit}`) ? `${clean} - ${kit}` : clean;
}
function programmeVariants() {
  return [...new Set(services.LibraryService.getProgrammes().map((value) => display(value)).filter((name) => /^(AIKIRO|ROBOKIT|UARO)\s+Lv/i.test(name)))].sort((left, right) => {
    const leftMatch = left.match(/^(AIKIRO|ROBOKIT|UARO)\s+Lv(\d+)(?:[_ ](original|additional))?/i) || [];
    const rightMatch = right.match(/^(AIKIRO|ROBOKIT|UARO)\s+Lv(\d+)(?:[_ ](original|additional))?/i) || [];
    const kitOrder = { AIKIRO: 1, UARO: 2, ROBOKIT: 3 };
    const levelOrder = Number(leftMatch[2] || 0) - Number(rightMatch[2] || 0);
    if (kitOrder[leftMatch[1]?.toUpperCase()] !== kitOrder[rightMatch[1]?.toUpperCase()]) return (kitOrder[leftMatch[1]?.toUpperCase()] || 9) - (kitOrder[rightMatch[1]?.toUpperCase()] || 9);
    if (levelOrder) return levelOrder;
    const typeOrder = { original: 1, additional: 2 };
    return (typeOrder[leftMatch[3]?.toLowerCase()] || 1) - (typeOrder[rightMatch[3]?.toLowerCase()] || 1);
  });
}
function levelNumber(value) {
  if (Number.isFinite(Number(value))) return Number(value);
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
    item.onclick = () => { activeView = item.dataset.view; selectedStudent = ''; render(); if (window.innerWidth <= 760) document.querySelector('.sidebar')?.classList.remove('open'); };
  });
}

function render() {
  renderNav();
  document.querySelector('#breadcrumb').textContent = activeView;
  if (activeView === "Today's Students") renderTodaysStudents();
  else if (activeView === 'Robot Students') renderStudents();
  else if (activeView === 'Coding Students') renderCodingStudents();
  else if (activeView === 'Math Students') renderCodingStudents('Math');
  else if (activeView === 'Libraries & Curriculum' || activeView === 'AIKIRO' || activeView === 'UARO' || activeView === 'ROBOKIT' || /^CS[1-5] curriculum$/.test(activeView) || /^CodeMonkey Part [12]$/.test(activeView)) renderLibraries(activeView);
  else if (activeView === 'Borrowing Log') renderOperations();
  else if (activeView === 'Center Inventory') renderComponents();
  else if (activeView === 'System Status') renderSystemStatus();
  else renderStudents();
}

function applyStatusTestRoute() {
  const shouldOpenStatusTest = new URLSearchParams(window.location.search).get('status-test') === '1';
  if (!shouldOpenStatusTest) return false;
  activeView = 'System Status';
  render();
  window.setTimeout(() => checkSystemStatus(), 0);
  return true;
}

function latestRobotCarryRecord(student) {
  return finalizedQuickNotes(student, 'Robot').find((record) => record.carryStatus) || null;
}

function getCarryStatus(student) {
  return latestRobotCarryRecord(student)?.carryStatus || student?.carryStatus || 'Leave Kit At Centre';
}

function getCarryStatusClass(status) {
  if (status === 'Take Robot Home') return 'status-blue';
  if (status === 'Take Whole Kit Home') return 'status-orange';
  return 'status-green';
}

function studentProgramme(student) {
  const source = student?.sourceRow || {};
  return display(pathwayFor(student)?.programme || student?.program || student?.course || student?.programme || student?.programme_name || source.Program || source.Programme || source['Programme Name'] || source['Program name'] || '').trim();
}

function normalizeRobotName(value) {
  return String(value ?? '').replace(/Deliveryy Robot/g, 'Delivery Robot').replace(/\bCannon\s*Bot\b/gi, 'CannoBot');
}

function outstandingBorrowings(student) {
  const courseType = student?.studentType || student?.sourceRow?.['Course type'] || student?.sourceRow?.['Course Type'] || (/math/i.test(String(student?.course || '')) ? 'Math' : /coding|cs\d|codemonkey/i.test(String(student?.course || '')) ? 'Coding' : 'Robot');
  if (courseType !== 'Robot') return [];
  const records = services?.BorrowingService.getBorrowingLogs?.() || state.borrowings || [];
  return records.filter((row) => {
    const source = row.sourceRow || {};
    const matches = studentRecordMatches(row, student);
    const status = String(row.status || source.Status || '').toLowerCase();
    return matches && !/returned|return/.test(status) && !source['Returned on'];
  });
}

function borrowingSummary(student) {
  return outstandingBorrowings(student).map((row) => {
    const source = row.sourceRow || {};
    const date = row.borrowed_on || source['Borrowed on'] || row.borrowedOn || today();
    const item = row.item || source.Component || source['Component Name'] || 'Borrowed item';
    const quantity = row.quantity || source.Quantity || '—';
    return `${date} - ${item} * ${quantity}`;
  });
}

function borrowingWarningMarkup(student) {
  const count = outstandingBorrowings(student).length;
  return count ? `<span class="borrowing-warning" title="${count} unreturned borrowed item${count === 1 ? '' : 's'}" aria-label="${count} unreturned borrowed item${count === 1 ? '' : 's'}">!</span>` : '';
}

function programmeTemplate(student) {
  const programme = studentProgramme(student);
  const normalized = programme.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const robotLibrary = state.robots.length ? state.robots : services?.LibraryService.getRobotLibrary?.() || [];
  const template = robotLibrary.filter((row) => String(row['Programme Name'] || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() === normalized).sort((left, right) => Number(left.Sequence || 0) - Number(right.Sequence || 0));
  const review = localWorkspaceAllowed ? state.robotPathwayReviews.find((item) => item.studentId === student.studentId
    && String(item.programme).replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() === normalized) : null;
  const robotSequence = window.ICCLocalPathways.reviewedRobotSequence(template, pathwayFor(student, 'Robot'), review);
  const coding = /^(cs\d+|codemonkey|code\s*combat)/i.test(programme);
  return { programme, robotSequence, coding, curriculum: coding ? getCurriculumForStudent({ ...student, course: programme }) : [] };
}

function robotPathReconciliation(student) {
  const programme = studentProgramme(student).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const isRobokitLv3 = /^robokit\s*lv\s*3$/i.test(programme);
  const isAikiroAdditional = /^aikiro\s+lv\s*1\s+additional$/i.test(programme);
  if ((!isRobokitLv3 && !isAikiroAdditional) || pathwayFor(student, 'Robot')?.startedOn) return null;
  const template = programmeTemplate(student).robotSequence;
  if (!template.length) return null;
  const progress = state.robotProgress.filter((row) => belongsToStudent(row, student));
  const programmeId = isRobokitLv3 ? 'ROB-L3' : 'AIK-L1-A';
  const level = isRobokitLv3 ? 3 : 1;
  const matching = progress.filter((row) => (!row.sourceRow?.['Programme ID'] || row.sourceRow['Programme ID'] === programmeId)
    && (levelNumber(row.Level) === level || (!row.Level && row.sourceRow?.['Programme ID'] === programmeId)));
  const result = window.ICCLocalPathways.reconcileRobotProgress(programme, template, matching, student);
  result.retired.push(...progress.filter((row) => !row.Level && !row.sourceRow?.['Programme ID']));
  return result;
}

function reviewedProgrammeRobotProgress(student, rows) {
  const reviews = state.robotProgressReviews.filter((review) => review.studentId === student.studentId);
  if (!reviews.length) return rows;
  const lessons = state.robotLessons.filter((lesson) => studentRecordMatches(lesson, student)).map((lesson) => {
    const source = lesson.sourceRow || {};
    const status = String(source['Progress Status'] || '').trim().toLowerCase();
    return {
      date: lessonDateKey(source.Date), time: source['Start Time'], robot: source['Robot Name'],
      status: /^(finished|done|completed)$/.test(status) ? 'Done' : /^(in progress|ongoing)$/.test(status) ? 'In progress' : /^(not started|unfinished)$/.test(status) ? 'Not started' : '',
    };
  });
  return window.ICCLocalPathways.applyRobotReviews(rows, reviews, studentProgramme(student), lessons);
}

function programmeRobotProgress(student) {
  const pathway = pathwayFor(student, 'Robot');
  if (pathway?.startedOn) {
    const records = programmeTemplate(student).robotSequence.map((row) => ({
      Robot: row['Robot name'], Sequence: row.Sequence, Status: 'Not started', Level: row.Level,
      Student: student.name, studentId: student.studentId,
    }));
    const lessons = state.robotLessons.filter((lesson) => studentRecordMatches(lesson, student)
      && window.ICCLocalPathways.afterPathwayChange(lessonDateKey(lesson.sourceRow?.Date), pathway))
      .sort((a, b) => `${a.sourceRow?.Date || ''} ${a.sourceRow?.['Start Time'] || ''}`.localeCompare(`${b.sourceRow?.Date || ''} ${b.sourceRow?.['Start Time'] || ''}`));
    for (const lesson of lessons) {
      const source = lesson.sourceRow || {};
      const robotKey = (name) => window.ICCLocalPathways.robotNameKey(name, studentProgramme(student));
      const matches = records.filter((row) => robotKey(row.Robot) === robotKey(source['Robot Name']));
      const status = String(source['Progress Status'] || '').trim().toLowerCase();
      if (matches.length !== 1) continue;
      if (/^(finished|done|completed)$/.test(status)) matches[0].Status = 'Done';
      else if (/^(in progress|ongoing)$/.test(status)) matches[0].Status = 'In progress';
      else if (/^(not started|unfinished)$/.test(status)) matches[0].Status = 'Not started';
    }
    return reviewedProgrammeRobotProgress(student, records);
  }
  const reconciliation = robotPathReconciliation(student);
  if (reconciliation) return reviewedProgrammeRobotProgress(student, reconciliation.rows);
  const programme = studentProgramme(student).match(/^(AIKIRO|ROBOKIT|UARO)\s+Lv\d+(?:[_ ][a-z]+)?/i)?.[0] || '';
  const exactLevel = programme.toLowerCase();
  const levelFamily = exactLevel.replace(/_original|_additional/i, '');
  const programmeLevelNumber = levelNumber(programme);
  return reviewedProgrammeRobotProgress(student, state.robotProgress.filter((row) => {
    if (!belongsToStudent(row, student)) return false;
    if (!row.Level) return true;
    const rowLevel = String(row.Level).toLowerCase();
    const rowLevelNumber = levelNumber(row.Level);
    if (programmeLevelNumber && rowLevelNumber) return rowLevelNumber === programmeLevelNumber;
    return rowLevel === exactLevel || (!exactLevel.includes('_') && rowLevel.startsWith(levelFamily));
  }));
}

function robotCompletion(student) {
  const progress = programmeRobotProgress(student);
  if (!progress.length) return student.completion || '0%';
  return `${Math.round(progress.filter((row) => String(row.Status).toLowerCase() === 'done').length * 100 / progress.length)}%`;
}

function nextRobotForStudent(student) {
  const progress = programmeRobotProgress(student).sort((left, right) => Number(left.Sequence || 0) - Number(right.Sequence || 0));
  const template = programmeTemplate(student);
  const review = localWorkspaceAllowed ? state.robotPathwayReviews.find((item) => item.studentId === student.studentId) : null;
  if (window.ICCLocalPathways.reviewedRobotSequence([], pathwayFor(student, 'Robot'), review).length) {
    const ongoing = progress.find((row) => row.Status === 'In progress');
    if (ongoing) return normalizeRobotName(ongoing.Robot);
  }
  const next = progress.find((row) => !/done|finished|completed/i.test(String(row.Status || '')));
  if (next?.Status === 'Unknown') return 'Not assigned';
  return normalizeRobotName(next?.Robot || template.robotSequence[0]?.['Robot name'] || student.nextRobot || 'Not assigned');
}

function renderSystemStatus() {
  const apiUrl = getApiBaseUrl() || 'Not configured';
  const detailsTable = (heading, headers, rows) => `<section class="status-panel"><div class="section-header compact"><h2>${text(heading)} (${rows.length})</h2></div>${rows.length ? `<div class="records"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${text(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${text(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="settings-value">None.</p>'}</section>`;
  const details = liveSheetsStatus.details;
  const sheetsPanel = (localLiveSheetsEnabled || liveSheetsMode) ? `<section class="status-panel"><div class="section-header compact"><div><span class="eyebrow">${liveSheetsMode ? 'LIVE READ-ONLY SOURCE' : 'LOCAL READ-ONLY SOURCE'}</span><h2>Google Sheet</h2></div></div><p class="settings-value" role="status">${text(liveSheetsStatus.message)}</p></section>${details ? [
    detailsTable('Students not in local roster', ['Student', 'Student ID', 'Course'], details.students.map((row) => [row.name, row.studentId, row.course])),
    detailsTable('Unmatched lessons', ['Date', 'Student', 'Student ID', 'Course', 'Robot', 'Status', 'Reason'], details.lessons.map((row) => [row.date, row.name, row.studentId, row.course, row.robot, row.status, row.reason])),
    detailsTable('Unmatched robot updates', ['Date', 'Student', 'Student ID', 'Robot', 'Status', 'Reason'], details.robots.map((row) => [row.date, row.name, row.studentId, row.robot, row.status, row.reason])),
  ].join('') : ''}` : '';
  const sessionStatus = iapAuthEnabled ? 'Access controlled by Google IAP' : getAccessToken() ? 'Signed in for this browser session' : 'Not signed in';
  content.innerHTML = header('System Status', 'Verify the frontend, service layer, Cloud Run API, and Cloud SQL connection.') + `<div class="status-dashboard"><div class="status-panel"><div class="section-header compact"><div><span class="eyebrow">CLOUD ARCHITECTURE</span><h2>Connection checks</h2></div><button class="primary-button" data-action="check-system-status">Run checks</button></div><div id="systemStatusRows"><div class="service-status loading"><span></span><strong>Loading</strong><span>Run checks to verify backend services.</span></div></div></div><div class="status-panel developer-panel"><div class="section-header compact"><div><span class="eyebrow">WORKSPACE CONFIGURATION</span><h2>API access</h2></div></div><p class="settings-value">Backend: <strong>${getApiBaseUrl() ? escapeHtml(getApiBaseUrl()) : 'Not configured'}</strong></p><p class="settings-value">Session: <strong>${sessionStatus}</strong></p></div></div>${sheetsPanel ? `<div class="sheet-status-details">${sheetsPanel}</div>` : ''}`;
}
async function checkSystemStatus() {
  const target = document.querySelector('#systemStatusRows');
  if (!target) return;
  target.innerHTML = '<div class="service-status loading"><span></span><strong>Loading</strong><span>Checking Cloud Run and service endpoints...</span></div>';
  const checks = [{ label: 'Backend Status', endpoint: '/health' }, { label: 'Library Service Status', endpoint: '/programmes' }, { label: 'Inventory Service Status', endpoint: '/centre-inventory' }, { label: 'Borrowing Service Status', endpoint: '/borrowings' }];
  const results = await Promise.all(checks.map(async (check) => { try { await apiRequest(check.endpoint); return { ...check, connected: true }; } catch (error) { return { ...check, connected: false, message: error.message }; } }));
  target.innerHTML = results.map((result) => `<div class="service-status ${result.connected ? 'connected' : 'disconnected'}"><span></span><strong>${result.connected ? 'Connected' : 'Disconnected'}</strong><span>${result.label}</span>${result.message ? `<small>${text(result.message)}</small>` : ''}</div>`).join('');
}

function robotLessonDates(student) {
  const dates = state.robotLessons.map((lesson) => {
    const source = lesson.sourceRow || {};
    const date = lessonDateKey(source['Lesson Date'] || lesson['Lesson Date'] || lesson['Lesson time']);
    return { date, matches: studentRecordMatches(lesson, student) };
  }).filter((lesson) => lesson.matches && lesson.date).map((lesson) => lesson.date).sort();
  const todayKey = today();
  return { last: [...dates].filter((date) => date <= todayKey).pop() || 'No previous lesson', next: dates.find((date) => date > todayKey) || 'Not scheduled' };
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

function lessonTimeLabel(lesson, fallback) {
  const source = lesson.sourceRow || {};
  const timeRange = String(lesson['Lesson time'] || source['Lesson Time'] || source['Lesson time'] || '').trim();
  const start = String(source['Start Time'] || source['Lesson Start Time'] || lesson['Start Time'] || '').trim();
  const end = String(source['End Time'] || source['Lesson End Time'] || lesson['End Time'] || '').trim();
  if (start && end) return `${start} - ${end}`;
  return timeRange && !/^\d{4}-\d{2}-\d{2}$/.test(timeRange) ? timeRange.replace(/\s*-\s*/, ' - ') : fallback;
}

function calendarToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function refreshLocalCalendar() {
  if (calendarRefresh) return calendarRefresh;
  calendarState = { status: 'loading', date: '', events: [], error: '' };
  if (activeView === "Today's Students") renderTodaysStudents();
  calendarRefresh = (async () => {
    try {
      let data;
      if (localCalendarEnabled) {
        const response = await fetch('http://127.0.0.1:8787/today', { cache: 'no-store', signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error('The local calendar reader could not retrieve events.');
        data = await response.json();
      } else {
        data = await apiRequest('/calendar/today', 'GET', undefined, 45000);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Array.isArray(data.events)) throw new Error('The calendar reader returned invalid data.');
      calendarState = { status: 'ready', date: data.date, events: data.events, error: '' };
    } catch (error) {
      console.error('Unable to refresh the calendar:', error);
      calendarState = { status: 'error', date: '', events: [], error: 'Calendar is unavailable. Try again.' };
    } finally {
      calendarRefresh = null;
      if (activeView === "Today's Students") renderTodaysStudents();
    }
  })();
  return calendarRefresh;
}

function dailyLessonKey(row) {
  return `${calendarEnabled ? calendarToday() : today()}|${row.type}|${row.student.studentId || row.name}${row.calendarEventId ? `|${row.calendarEventId}` : ''}`;
}

function findDailyLessonRecord(records, row) {
  return records.find((record) => record.key === dailyLessonKey(row));
}

function saveDailyLessonDraft(row, changes) {
  const key = dailyLessonKey(row);
  const previous = state.dailyLessonDrafts.find((record) => record.key === key) || {};
  const record = { ...previous, ...changes, key, date: calendarEnabled ? calendarToday() : today(), studentId: row.student.studentId || '', studentName: row.name, courseType: row.type, updatedAt: new Date().toISOString() };
  state.dailyLessonDrafts = [...state.dailyLessonDrafts.filter((item) => item.key !== key), record];
  save('daily-lesson-drafts', state.dailyLessonDrafts);
}

function refreshDailyLessonRecords() {
  state.dailyLessonDrafts = load('daily-lesson-drafts', state.dailyLessonDrafts);
  state.dailyLessonFinalizations = load('daily-lesson-finalizations', state.dailyLessonFinalizations);
}

function finalizedQuickNotes(student, courseType) {
  refreshDailyLessonRecords();
  return state.dailyLessonFinalizations.filter((record) => record.courseType === courseType && studentRecordMatches({ ...record, name: record.studentName }, student)).sort((left, right) => right.date.localeCompare(left.date));
}

function studentLessonSchedule(student, courseType) {
  const config = courseType === 'Robot' ? { lessons: state.robotLessons, fields: ['Student name', 'Student'] } : courseType === 'Coding' ? { lessons: state.codingLessons, fields: ['Student (Coding)', 'Student'] } : { lessons: state.mathLessons, fields: ['Student (Math)', 'Student'] };
  const dates = config.lessons.map((lesson) => {
    const source = lesson.sourceRow || {};
    const name = lessonStudentName(config.fields.map((field) => lesson[field] || source[field]).find(Boolean) || '');
    return { date: lessonDateKey(source['Lesson Date'] || lesson['Lesson Date'] || lesson['Lesson time']), matches: studentRecordMatches({ ...lesson, name }, student) };
  }).filter((lesson) => lesson.matches && lesson.date).map((lesson) => lesson.date).sort();
  const todayKey = today();
  return { last: [...dates].filter((date) => date <= todayKey).pop() || 'No previous lesson', next: dates.find((date) => date > todayKey) || 'Not scheduled' };
}

function nextLessonMarkup(fallback) {
  return calendarEnabled ? '<strong data-calendar-next aria-live="polite">Checking calendar…</strong>' : `<strong>${text(fallback)}</strong>`;
}

async function loadNextCalendarLesson(student, courseType) {
  if (!calendarEnabled) return;
  const target = content.querySelector('[data-calendar-next]');
  const studentId = String(student.jamesStudentId || student.jamesData?.['Student ID'] || student.sourceRow?.['James Student ID'] || '').trim();
  if (!studentId) {
    target.textContent = 'Student ID unavailable';
    return;
  }
  try {
    let result;
    if (localCalendarEnabled) {
      const url = new URL('http://127.0.0.1:8787/next');
      url.searchParams.set('studentId', studentId);
      url.searchParams.set('courseType', courseType);
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error('The local calendar reader could not retrieve the next lesson.');
      result = await response.json();
    } else {
      const params = new URLSearchParams({ studentId, courseType });
      result = await apiRequest(`/calendar/next?${params}`, 'GET', undefined, 45000);
    }
    let label;
    if (result.status === 'none') label = 'No matching calendar lesson';
    else if (result.status === 'review') label = 'Calendar event needs review';
    else if (result.status === 'found' && result.event?.start) {
      const start = /^\d{4}-\d{2}-\d{2}$/.test(result.event.start) ? `${result.event.start}T00:00:00+08:00` : result.event.start;
      const date = new Date(start);
      if (!Number.isFinite(date.getTime())) throw new Error('Calendar returned an invalid lesson date.');
      const formatted = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hong_Kong', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
      label = `${formatted} · ${window.ICCLocalCalendar.timeLabel(result.event)}`;
    } else throw new Error('Calendar returned an invalid next-lesson result.');
    if (target.isConnected) target.textContent = label;
  } catch (error) {
    console.error('Unable to load the next calendar lesson:', error);
    if (target.isConnected) target.textContent = 'Calendar unavailable';
  }
}

function studentDemographics(student) {
  const source = student.sourceRow || {};
  const yob = String(student.yob || student.yearOfBirth || source.YOB || source['Year of Birth'] || source['Birth Year'] || '').trim();
  const dob = String(student.dateOfBirth || source.DOB || source['Date of Birth'] || '').trim();
  const age = String(student.age || source.Age || '').trim() || (yob && /^\d{4}$/.test(yob) ? String(new Date().getFullYear() - Number(yob)) : 'Not imported');
  return { yob: yob || (dob ? dob.slice(0, 4) : 'Not imported'), age };
}

function studentLessonComments(student, courseType) {
  const config = courseType === 'Math' ? { lessons: state.mathLessons, fields: ['Student (Math)', 'Student'] } : courseType === 'Coding' ? { lessons: state.codingLessons, fields: ['Student (Coding)', 'Student'] } : { lessons: state.robotLessons, fields: ['Student name', 'Student'] };
  return config.lessons.map((lesson) => {
    const source = lesson.sourceRow || {};
    const name = lessonStudentName(config.fields.map((field) => lesson[field] || source[field]).find(Boolean) || '');
    return { date: lessonDateKey(source['Lesson Date'] || lesson['Lesson Date'] || lesson['Lesson time']), tutor: lesson.Tutor || source['Tutor Name'] || '', topic: source.Progress || lesson.Progress || source.Topic || lesson.Topic || '', comment: source.Comment || lesson.Comment || '', matches: studentRecordMatches({ ...lesson, name }, student) };
  }).filter((lesson) => lesson.matches && lesson.comment).sort((left, right) => right.date.localeCompare(left.date));
}

function latestMathTopic(student) {
  const lessonTopic = state.mathLessons.map((lesson) => {
    const source = lesson.sourceRow || {};
    return {
      date: lessonDateKey(source['Lesson Date'] || lesson['Lesson Date'] || lesson['Lesson time']),
      topic: source.Progress || lesson.Progress || source.Topic || lesson.Topic || '',
      matches: studentRecordMatches(lesson, student),
    };
  }).filter((lesson) => lesson.matches && lesson.topic).sort((left, right) => right.date.localeCompare(left.date))[0]?.topic;
  return lessonTopic || studentLessonComments(student, 'Math').find((comment) => comment.topic)?.topic || student.progress || student.sourceRow?.Progress || student.topics || '—';
}

function finalizeToday() {
  const finalizedAt = new Date().toISOString();
  const finalRecords = todayLessonRows().map((row) => {
    const draft = findDailyLessonRecord(state.dailyLessonDrafts, row) || {};
    return { key: dailyLessonKey(row), date: calendarEnabled ? calendarToday() : today(), studentId: row.student.studentId || '', studentName: row.name, courseType: row.type, lessonTime: row.lessonTime, tutor: row.tutor || '', startingLevel: draft.startingLevel ?? row.startingLevel ?? '', endingLevel: draft.endingLevel ?? row.endingLevel ?? '', learntTopic: draft.learntTopic ?? row.learntTopic ?? '', quickNotes: draft.quickNotes ?? row.notes ?? '', carryStatus: row.type === 'Robot' ? (draft.carryStatus ?? row.carryStatus ?? '') : '', finalizedAt };
  });
  const finalizedKeys = new Set(finalRecords.map((record) => record.key));
  state.dailyLessonFinalizations = [...state.dailyLessonFinalizations.filter((record) => !finalizedKeys.has(record.key)), ...finalRecords];
  save('daily-lesson-finalizations', state.dailyLessonFinalizations);
  exportWorkspace(`icc-workspace-final-${today()}.json`);
}

function scheduleAutomaticFinalization() {
  const nextDay = new Date();
  nextDay.setHours(24, 0, 0, 0);
  window.setTimeout(() => { finalizeToday(); scheduleAutomaticFinalization(); }, Math.max(1000, nextDay.getTime() - Date.now()));
}

function exportWorkspace(filename = 'icc-control-room-export.json') {
  const exported = localWorkspaceAllowed && !localPathwayError ? { ...state, localStudentPathways: localPathways } : state;
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function todayLessonRows() {
  refreshDailyLessonRecords();
  if (calendarEnabled) {
    if (calendarState.status !== 'ready' || calendarState.date !== calendarToday()) return [];
    return window.ICCLocalCalendar.matchEvents(calendarState.events, state).matched.map(({ event, type, student, lessonTime }) => {
      const row = {
        type, name: student.name, student, lesson: { Remarks: '', sourceRow: {} },
        programme: studentProgramme(student) || '—', lessonTime, tutor: student.tutor || '',
        carryStatus: type === 'Robot' ? getCarryStatus(student) : 'N/A', notes: '', calendarEventId: event.id,
      };
      const draft = findDailyLessonRecord(state.dailyLessonDrafts, row);
      return { ...row, carryStatus: draft?.carryStatus ?? row.carryStatus, notes: draft?.quickNotes ?? '', startingLevel: draft?.startingLevel ?? '', endingLevel: draft?.endingLevel ?? '', learntTopic: draft?.learntTopic ?? '' };
    });
  }
  const todayKey = today();
  const robotByName = new Map(state.robotStudents.map((student) => [student.name, student]));
  const codingByName = new Map(state.codingStudents.map((student) => [student.name, student]));
  const mathByName = new Map(state.mathStudents.map((student) => [student.name, student]));
  const rows = [];
  state.robotLessons.filter((lesson) => lesson['Lesson time'] && lessonDateKey(lesson['Lesson time']) === todayKey).forEach((lesson) => {
    const name = lessonStudentName(lesson['Student name']);
    const student = robotByName.get(name);
    if (student) { const row = { type: 'Robot', name, student, lesson, programme: studentProgramme(student) || '—', lessonTime: lessonTimeLabel(lesson, '4:00 PM - 5:00 PM'), tutor: lesson.Tutor || student.tutor || '', carryStatus: getCarryStatus(student), notes: lesson.Remarks || '' }; const draft = findDailyLessonRecord(state.dailyLessonDrafts, row); rows.push({ ...row, carryStatus: draft?.carryStatus ?? row.carryStatus, notes: draft?.quickNotes ?? row.notes }); }
  });
  state.codingLessons.filter((lesson) => lesson['Lesson time'] && lessonDateKey(lesson['Lesson time']) === todayKey).forEach((lesson) => {
    const name = lessonStudentName(lesson['Student (Coding)']);
    const student = codingByName.get(name);
    if (student) { const source = lesson.sourceRow || {}; const row = { type: 'Coding', name, student, lesson, programme: studentProgramme(student) || '—', lessonTime: lessonTimeLabel(lesson, '5:00 PM - 6:00 PM'), tutor: lesson.Tutor || student.tutor || '', carryStatus: 'N/A', notes: lesson.Remarks || '', startingLevel: source["Today's Starting Level"] || lesson["Today's Starting Level"] || '', endingLevel: source["Today's Finished Level"] || lesson["Today's Finished Level"] || '', learntTopic: source['Topic learnt'] || lesson['Topic learnt'] || '' }; const draft = findDailyLessonRecord(state.dailyLessonDrafts, row); rows.push({ ...row, notes: draft?.quickNotes ?? row.notes, startingLevel: draft?.startingLevel ?? row.startingLevel, endingLevel: draft?.endingLevel ?? row.endingLevel, learntTopic: draft?.learntTopic ?? row.learntTopic }); }
  });
  state.mathLessons.filter((lesson) => lesson['Lesson time'] && lessonDateKey(lesson['Lesson time']) === todayKey).forEach((lesson) => {
    const name = lessonStudentName(lesson['Student (Math)']);
    const student = mathByName.get(name);
    if (student) { const row = { type: 'Math', name, student, lesson, programme: studentProgramme(student), lessonTime: lessonTimeLabel(lesson, '6:00 PM - 7:00 PM'), tutor: lesson.Tutor || student.tutor || '', notes: lesson.Remarks || '' }; const draft = findDailyLessonRecord(state.dailyLessonDrafts, row); rows.push({ ...row, notes: draft?.quickNotes ?? row.notes }); }
  });
  return rows;
}

function ensureDemoLessonsForToday() {
  const date = today();
  const previousDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const demoLessons = [
    { collection: 'robotLessons', studentField: 'Student name', student: 'Demo Robot Student Today', courseType: 'Robot', studentId: 'ST-R-DEMO-002', yob: 2015, tutor: 'Hazel', time: '4:00 PM - 5:00 PM', note: 'Review the current robot build.', comment: 'The student worked steadily through the robot build and showed better care when checking each connection. They could explain the purpose of the main sensors and corrected a loose motor wire without prompting. The next lesson should begin with a short checklist review before moving into movement testing. Encourage the student to describe the expected result before pressing run, because this helped them notice mistakes earlier. Overall, the student was engaged, responded well to questions, and finished the session with a clearer understanding of how the parts work together.' },
    { collection: 'codingLessons', studentField: 'Student (Coding)', student: 'Demo Coding Student Today', courseType: 'Coding', studentId: 'ST-C-DEMO-002', yob: 2014, finishedLevel: 6, tutor: 'Hazel', time: '5:00 PM - 6:00 PM', note: 'Practise functions and debugging.', comment: 'The student made good progress with functions and was able to identify where a repeated instruction could be replaced by a reusable block. They initially needed reminders about parameters and return values, but improved after tracing the program with small test inputs. Debugging was more focused than in the previous session, especially when the student read the error message before changing the code. Continue with short function exercises next time, then connect them to a small project so the ideas become practical. Participation was positive and the student finished with growing confidence.' },
    { collection: 'mathLessons', studentField: 'Student (Math)', student: 'Demo Math Student', courseType: 'Math', studentId: 'ST-M-001', yob: 2013, tutor: 'Jason', time: '6:00 PM - 7:00 PM', note: 'Continue with Python loops.', comment: 'The student participated actively and explained the main steps of the problem before starting the calculation. They were comfortable with familiar examples but needed extra time when the numbers changed or when two operations appeared in the same question. A useful strategy was to ask the student to estimate the answer first and then compare it with the final result. This helped them catch one arithmetic error independently. Next lesson should revisit the same concept with a few gradually harder examples, keeping the explanation verbal and encouraging the student to check each stage.' },
  ];
  demoLessons.forEach(({ collection, studentField, student, courseType, studentId, yob, finishedLevel, tutor, time, note }) => {
    const studentRecord = [...state.robotStudents, ...state.codingStudents, ...state.mathStudents].find((row) => row.studentId === studentId || row.name === student);
    if (studentRecord) { studentRecord.yob = yob; studentRecord.yearOfBirth = yob; studentRecord.sourceRow = { ...(studentRecord.sourceRow || {}), YOB: String(yob), 'Year of Birth': String(yob), ...(finishedLevel ? { "Today's Finished Level": String(finishedLevel), 'Finished Level': String(finishedLevel) } : {}) }; }
    const lesson = state[collection].find((row) => row[studentField] === student);
    if (!lesson) return;
    lesson['Lesson time'] = date;
    lesson.Tutor = tutor;
    lesson.Remarks = lesson.Remarks || note;
    lesson.sourceRow = { ...(lesson.sourceRow || {}), 'Lesson Date': date, 'Tutor Name': tutor, Remarks: lesson.Remarks, ...(finishedLevel ? { "Today's Finished Level": String(finishedLevel), 'Finished Level': String(finishedLevel) } : {}) };
    const previousMarker = `demo-previous-${studentId}`;
    if (!state[collection].some((row) => row.sourceRow?.['Demo record key'] === previousMarker)) {
      state[collection].push({ ...lesson, 'Lesson time': previousDate, [studentField]: student, Tutor: tutor, Remarks: note, sourceRow: { ...(lesson.sourceRow || {}), 'Demo record key': previousMarker, 'Lesson Date': previousDate, 'Tutor Name': tutor, Comment: demoLessons.find((item) => item.student === student)?.comment || '' } });
    }
    const finalizations = load('daily-lesson-finalizations', state.dailyLessonFinalizations);
    if (!finalizations.some((record) => record.studentId === studentId && record.courseType === courseType)) {
      finalizations.push({ key: `${previousDate}|${courseType}|${studentId}`, date: previousDate, studentId, studentName: student, courseType, lessonTime: time, tutor, quickNotes: note, finalizedAt: `${previousDate}T18:00:00.000Z` });
      state.dailyLessonFinalizations = finalizations;
      save('daily-lesson-finalizations', finalizations);
    }
  });
}

function resetToDemoUsageData() {
  const previousDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const todayDate = today();
  const tutors = ['Hazel', 'Jason', 'Mina', 'Alex'];
  const comment = (name, programme) => `${name} followed the ${programme} plan with steady participation. The tutor reviewed the main task, checked understanding with short questions, and recorded the next step for the following lesson. The student completed the practical activity with some prompting and showed improvement when explaining their choices. Continue with a similar activity next time and encourage the student to check their own work before asking for help.`;
  const note = (name) => `${name} completed the planned lesson and has a clear next step.`;
  const recordHistory = (student, courseType, tutor, programme) => {
    state.dailyLessonFinalizations.push({ key: `${previousDate}|${courseType}|${student.studentId}`, date: previousDate, studentId: student.studentId, studentName: student.name, courseType, lessonTime: '4:00 PM - 5:00 PM', tutor, quickNotes: note(student.name), finalizedAt: `${previousDate}T18:00:00.000Z` });
    return { date: previousDate, tutor, topic: programme, comment: comment(student.name, programme) };
  };
  const addBorrowing = (student, item, kit, componentId, tutor) => state.borrowings.push({ borrowing_id: `demo-${student.studentId}`, item, borrower: student.name, quantity: '1', status: 'Still borrowing', sourceRow: { 'Student ID': student.studentId, Student: student.name, 'Programme Name': student.program, 'Tutor Name': tutor, 'Course Type': student.studentType, Component: item, 'Component Name': item, Quantity: '1', Kit: kit, Status: 'Still borrowing', 'Borrowed on': previousDate, 'Returned on': '' }, studentId: student.studentId, componentId });
  state.robotStudents = [];
  state.codingStudents = [];
  state.mathStudents = [];
  state.robotProgress = [];
  state.componentItems = [];
  state.codingProgress = [];
  state.robotLessons = [];
  state.codingLessons = [];
  state.mathLessons = [];
  state.borrowings = [];
  state.dailyLessonDrafts = [];
  state.dailyLessonFinalizations = [];
  const robotProgrammes = [...new Set(state.robots.map((row) => row['Programme Name']).filter(Boolean))];
  robotProgrammes.forEach((program, index) => {
    const studentId = index === 0 ? 'ST-R-DEMO-002' : `DEMO-R-${String(index + 1).padStart(3, '0')}`;
    const student = { name: index === 0 ? 'Demo Robot Student Today' : `Test Robot ${program}`, studentId, program, studentType: 'Robot', completion: '0%', sourceRow: { Name: index === 0 ? 'Demo Robot Student Today' : `Test Robot ${program}`, 'Student ID': studentId, 'Course type': 'Robot' } };
    const generated = createProgrammeRecords(student.name, program);
    const completed = index % Math.max(1, generated.progress.length);
    generated.progress.forEach((row, rowIndex) => { if (rowIndex < completed) row.Status = 'Done'; });
    student.nextRobot = generated.progress.find((row) => row.Status !== 'Done')?.Robot || generated.progress[0]?.Robot || '';
    student.completion = `${Math.round((completed / Math.max(1, generated.progress.length)) * 100)}%`;
    state.robotStudents.push(student);
    const tutor = tutors[index % tutors.length];
    recordHistory(student, 'Robot', tutor, program);
    addBorrowing(student, generated.checklist[0]?.item || 'Robot component', program.match(/^(AIKIRO|ROBOKIT|UARO)/i)?.[1] || '', generated.checklist[0]?.componentId || '', tutor);
    state.robotLessons.push({ 'Lesson time': index === 0 ? todayDate : previousDate, 'Student name': student.name, Tutor: tutor, Remarks: note(student.name), 'Course type': 'Robot', sourceRow: { 'Lesson Date': index === 0 ? todayDate : previousDate, 'Student ID': student.studentId, Student: student.name, 'Tutor Name': tutor, Remarks: note(student.name), Comment: comment(student.name, program), 'Course Type': 'Robot' } });
  });
  const codingProgrammes = ['CS1', 'CS5', 'CodeMonkey P1', 'CodeMonkey P2'];
  codingProgrammes.forEach((course, index) => {
    const studentId = index === 0 ? 'ST-C-DEMO-002' : `DEMO-C-${String(index + 1).padStart(3, '0')}`;
    const student = { name: index === 0 ? 'Demo Coding Student Today' : `Test Coding ${course}`, studentId, course, studentType: 'Coding', completion: `${index * 12}%`, sourceRow: { Name: index === 0 ? 'Demo Coding Student Today' : `Test Coding ${course}`, 'Student ID': studentId, 'Course type': 'Coding', "Today's Finished Level": String(index === 0 ? 6 : index === 1 ? 10 : index === 2 ? 35 : 100) } };
    state.codingStudents.push(student);
    const finishedLevel = Number(student.sourceRow["Today's Finished Level"]);
    state.codingProgress.push({ sourceId: student.studentId, name: student.name, studentId: student.studentId, next: finishedLevel, topics: getCurriculumForStudent(student).filter((row) => Number(row.Level) <= finishedLevel).map((row) => row.Topic).filter(Boolean).pop() || '' });
    const tutor = tutors[index % tutors.length];
    recordHistory(student, 'Coding', tutor, course);
    state.codingLessons.push({ 'Lesson time': index === 0 ? todayDate : previousDate, 'Student (Coding)': student.name, Tutor: tutor, Remarks: note(student.name), 'Course type': 'Coding', sourceRow: { 'Lesson Date': index === 0 ? todayDate : previousDate, 'Student ID': student.studentId, Student: student.name, 'Tutor Name': tutor, Remarks: note(student.name), Comment: comment(student.name, course), 'Course Type': 'Coding', "Today's Finished Level": String(finishedLevel), Progress: getCurriculumForStudent(student).filter((row) => Number(row.Level) === Math.max(1, finishedLevel)).map((row) => row.Topic).filter(Boolean).pop() || '' } });
  });
  const mathStudent = { name: 'Demo Math Student', studentId: 'DEMO-M-001', course: 'Math', studentType: 'Math', tutor: 'Jason', sourceRow: { Name: 'Demo Math Student', 'Student ID': 'DEMO-M-001', 'Course type': 'Math' } };
  state.mathStudents.push(mathStudent);
  recordHistory(mathStudent, 'Math', 'Jason', 'Math');
  state.mathLessons.push({ 'Lesson time': todayDate, 'Student (Math)': mathStudent.name, Tutor: 'Jason', Remarks: note(mathStudent.name), 'Course type': 'Math', sourceRow: { 'Lesson Date': todayDate, 'Student ID': mathStudent.studentId, Student: mathStudent.name, 'Tutor Name': 'Jason', Remarks: note(mathStudent.name), 'Course Type': 'Math', Comment: comment(mathStudent.name, 'Math'), Progress: 'Problem solving' } });
  ['robot-students', 'coding-students', 'math-students', 'robot-progress', 'component-items', 'coding-progress', 'robot-lessons', 'coding-lessons', 'math-lessons', 'borrowings', 'daily-lesson-drafts', 'daily-lesson-finalizations'].forEach((key) => localStorage.removeItem(`icc-${key}`));
  services?.BorrowingService.hydrateFromState(state);
}

function renderTodaysStudents() {
  const rows = todayLessonRows();
  const sortedRows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const studentCount = (type) => new Set(rows.filter((row) => !type || row.type === type).map((row) => (jamesStudentIdOf(row.student) || row.name).toUpperCase())).size;
  const eventAttribute = (row) => row.calendarEventId ? ` data-calendar-event="${escapeHtml(row.calendarEventId)}"` : '';
  const profileButton = (row) => `<button class="student-link" data-today-profile="${escapeHtml(row.name)}" data-today-type="${row.type}" aria-label="View ${escapeHtml(row.type)} progress for ${escapeHtml(row.name)}"><strong>${text(row.name)}${borrowingWarningMarkup(row.student)}</strong></button>`;
  const borrowedCell = (student) => { const summary = borrowingSummary(student); return summary.length ? `<span class="borrowed-item-warning">${text(summary.join(' · '))}</span>` : '—'; };
  const robotRows = sortedRows.filter(row => row.type === 'Robot').map(row => `<tr><td>${profileButton(row)}</td><td><span class="type-pill type-robot">Robot</span></td><td><span class="lesson-time">${text(row.lessonTime)}</span></td><td>${text(row.programme)}</td><td>${text(nextRobotForStudent(row.student))}</td><td>${borrowedCell(row.student)}</td><td><select class="inline-input carry-status-select" data-carry-status-student="${escapeHtml(row.name)}"${eventAttribute(row)}><option ${row.carryStatus === 'Take Robot Home' ? 'selected' : ''}>Take Robot Home</option><option ${row.carryStatus === 'Take Whole Kit Home' ? 'selected' : ''}>Take Whole Kit Home</option><option ${row.carryStatus === 'Leave Kit At Centre' ? 'selected' : ''}>Leave Kit At Centre</option></select></td><td><input class="inline-input today-notes-input" data-lesson-notes="${escapeHtml(row.name)}"${eventAttribute(row)} value="${escapeHtml(row.notes)}" placeholder="Quick note"></td><td><button class="mini-button" data-action="checklist" data-student-name="${escapeHtml(row.name)}">Checklist</button></td></tr>`).join('');
  const codingRows = sortedRows.filter(row => row.type === 'Coding').map(row => { const finished = Number(row.student.sourceRow?.["Today's Finished Level"] || 0); const lessons = state.codingProgress.filter((item) => studentRecordMatches(item, row.student));
    const topic = buildCodingDashboard(row.student, lessons).currentConcept || '—';
    return `<tr><td>${profileButton(row)}</td><td><span class="type-pill type-coding">Coding</span></td><td><span class="lesson-time">${text(row.lessonTime)}</span></td><td>${text(row.programme)}</td><td>${text(finished || '—')}</td><td>${text(topic)}</td><td><input class="inline-input today-notes-input" data-lesson-notes="${escapeHtml(row.name)}"${eventAttribute(row)} value="${escapeHtml(row.notes)}" placeholder="Quick note"></td><td><button class="mini-button" data-action="coding-profile" data-student-name="${escapeHtml(row.name)}">Open</button></td></tr>`; }).join('');
  const mathRows = sortedRows.filter(row => row.type === 'Math').map(row => `<tr><td>${profileButton(row)}</td><td><span class="type-pill type-math">Math</span></td><td><span class="lesson-time">${text(row.lessonTime)}</span></td><td><input class="inline-input today-notes-input" data-lesson-notes="${escapeHtml(row.name)}"${eventAttribute(row)} value="${escapeHtml(row.notes)}" placeholder="Quick note"></td><td><button class="mini-button" data-action="math-profile" data-student-name="${escapeHtml(row.name)}">Open</button></td></tr>`).join('');
  const section = (title, headers, body, count) => { const type = title.split(' ')[0].toLowerCase(); return `<section class="today-student-section today-${type}"><div class="section-header compact"><div><span class="eyebrow">${title.toUpperCase()}</span><h2>${count} students</h2></div></div><div class="records today-table-wrap"><table class="data-table today-table-${type}"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}"><div class="empty-state">No ${title.toLowerCase()} scheduled today.</div></td></tr>`}</tbody></table></div></section>`; };
  const currentCalendar = calendarEnabled && calendarState.status === 'ready' && calendarState.date === calendarToday();
  const unmatched = currentCalendar ? window.ICCLocalCalendar.matchEvents(calendarState.events, state).unmatched : [];
  const calendarNotice = !calendarEnabled ? '' : currentCalendar
    ? `Google Calendar · ${calendarState.date} · ${calendarState.events.length} events · ${unmatched.length} need review`
    : calendarState.status === 'loading' ? 'Google Calendar is loading.' : `Google Calendar is unavailable or out of date. ${calendarState.error || 'Refresh the calendar.'}`;
  const unmatchedMarkup = unmatched.length ? `<section class="today-student-section"><h2>Calendar events needing review</h2>${table(['Time', 'Event', 'Student ID', 'Course', 'Reason'], unmatched.map((event) => [text(window.ICCLocalCalendar.timeLabel(event)), text(event.title || 'Untitled event'), text(event.studentId || '—'), text(event.course || '—'), text(event.reason)]))}</section>` : '';
  content.innerHTML = header("Today's Students", 'Daily workload for students with a lesson scheduled today.', calendarEnabled ? button('Refresh calendar', 'refresh-calendar', 'mini-button') : '') + `<div class="demo-banner">${calendarEnabled ? text(calendarNotice) : `Today's Date · ${today()}`}</div>
    <div class="today-panel">
      <div class="dashboard-strip"><div><strong>${studentCount()}</strong><span>Students Today</span></div><div><strong>${studentCount('Robot')}</strong><span>Robot</span></div><div><strong>${studentCount('Coding')}</strong><span>Coding</span></div><div><strong>${studentCount('Math')}</strong><span>Math</span></div></div>${unmatchedMarkup}<section class="conversion-panel"><div class="section-header compact"><div><span class="eyebrow">CODING CURRICULUM TOOL</span><h2>Level conversion</h2></div><span class="table-hint">Independent lookup · not linked to a student</span></div><div class="conversion-grid"><label>Programme<select id="conversionProgramme">${[...new Set(state.curriculum.map((item) => item['Program name']).filter(Boolean))].sort().map((programme) => `<option ${programme === todayConversion.programme ? 'selected' : ''}>${text(programme)}</option>`).join('')}</select></label><label>Starting level<input id="conversionStart" type="number" min="1" value="${escapeHtml(todayConversion.start)}"></label><label>Ending level<input id="conversionEnd" type="number" min="1" value="${escapeHtml(todayConversion.end)}"></label><output id="conversionTopics">${text(codingTopicsForRange({ course: todayConversion.programme }, todayConversion.start, todayConversion.end).join(', ') || 'Enter a starting and ending level')}</output></div></section>${section('Robot students',['Student Name','Student Type','Lesson Time','Programme','Next robot','Borrowed item','Robot Carry Status','Quick Notes','Checklist'],robotRows,studentCount('Robot'))}${section('Coding students',['Student Name','Student Type','Lesson Time','Programme','Last Finished Level','Current Topic','Quick Notes','Actions'],codingRows,studentCount('Coding'))}${section('Math students',['Student Name','Student Type','Lesson Time','Quick Notes','Actions'],mathRows,studentCount('Math'))}</div>`;
  document.querySelectorAll('#conversionProgramme, #conversionStart, #conversionEnd').forEach((control) => control.oninput = control.onchange = () => {
    todayConversion.programme = document.querySelector('#conversionProgramme').value;
    todayConversion.start = document.querySelector('#conversionStart').value;
    todayConversion.end = document.querySelector('#conversionEnd').value;
    document.querySelector('#conversionTopics').textContent = codingTopicsForRange({ course: todayConversion.programme }, todayConversion.start, todayConversion.end).join(', ') || 'Enter a starting and ending level';
  });
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
  const kits = ['AIKIRO', 'ROBOKIT', 'UARO'];
  const studentRow = (student, index) => [
    `<button class="student-link" data-profile="${index}" aria-label="View Robot progress for ${escapeHtml(student.name)}"><span class="student-avatar">${text(student.name).charAt(0)}</span><span><strong>${text(student.name)}</strong><small>${text(student.sourceRow?.Tutor || student.tutor || 'Robot student')}</small>${student.includeWhenUnpaid && String(student.paidStatus).trim().toLowerCase() !== 'paid' ? '<small>Payment status not used for visibility</small>' : ''}<small>View progress</small></span></button>`,
    `<span class="programme-chip">${icon('bot')}<span>${text(programmeLabel(studentProgramme(student)))}</span></span>`,
    `<span class="robot-chip">${icon('bot')}<span>${text(nextRobotForStudent(student))}</span></span>`,
    progressMarkup(robotCompletion(student)),
    carryMasterMarkup(student)
  ];
  const sections = kits.map((kit) => {
    const students = state.robotStudents.map((student, index) => ({ student, index })).filter(({ student }) => String(studentProgramme(student)).toUpperCase().startsWith(kit));
    return `<section class="robot-student-group robot-group-${kit.toLowerCase()}"><div class="section-header compact"><div><span class="eyebrow">ROBOT PROGRAMME</span><h2>${kit} Students</h2></div><span class="group-count">${students.length} students</span></div>${table(['Student', 'Programme', 'Current robot', 'Progress', 'Robot carry status'], students.map(({ student, index }) => studentRow(student, index)), `robot-master-table robot-master-${kit.toLowerCase()}`)}</section>`;
  }).join('');
  content.innerHTML = header('Robot Students', 'Tutor control center for every robot student and current kit status.') + `<div class="dashboard-strip"><div><strong>${state.robotStudents.length}</strong><span>Robot students</span></div></div><div class="robot-student-groups">${sections}</div>`;
}

function renderStudentChecklist() {
  const student = state.robotStudents.find((row) => row.name === selectedStudent);
  if (!student) return renderStudents();
  const checklist = state.componentItems.filter((row) => belongsToStudent(row, student));
  content.innerHTML = header(`${student.name} · Checklist`, 'Confirm components and quantities for this robot student.', button('← Robot Students', 'robot-students', 'mini-button')) + `
    <div class="section-heading"><h2>Student checklist</h2><span class="table-hint">Update quantities and notes as the kit is checked.</span></div>
    ${table(['Component ID', 'Item', 'Tier', 'Required', 'Student qty', 'Status', 'Notes'], checklist.map((row) => {
      const index = state.componentItems.indexOf(row);
      const quantity = Number(row.requiredQty) || 20;
      const options = Array.from({ length: Math.max(quantity, 20) + 1 }, (_, value) => `<option value="${value}" ${String(row.studentQty) === String(value) ? 'selected' : ''}>${value}</option>`).join('');
      return [text(row.componentId), text(row.item), text(row.tier), text(row.requiredQty), `<select class="inline-input" data-checklist-qty="${index}">${options}</select>`, text(quantityResult(row.requiredQty, row.studentQty)), `<input class="inline-input checklist-note" data-checklist-note="${index}" value="${escapeHtml(row.sourceRow?.Notes || '')}" placeholder="Notes">`];
    }))}`;
}

function renderStudentProfile() {
  const student = state.robotStudents.find((row) => row.name === selectedStudent);
  if (!student) return renderStudents();
  const hasProgress = state.robotProgress.some((row) => belongsToStudent(row, student));
  const hasChecklist = state.componentItems.some((row) => belongsToStudent(row, student));
  if ((!hasProgress || !hasChecklist) && !pathwayFor(student, 'Robot')) {
    replaceStudentProgramme(student, student.program);
  }
  const progress = state.robotProgress.filter((row) => belongsToStudent(row, student));
  const programmeProgress = programmeRobotProgress(student);
  const checklist = state.componentItems.filter((row) => belongsToStudent(row, student));
  const currentRobot = nextRobotForStudent(student) === 'Not assigned' ? '—' : nextRobotForStudent(student);
  const completedRobots = programmeProgress.filter((row) => String(row.Status).toLowerCase() === 'done').length;
  const totalRobots = Math.max(1, programmeProgress.length);
  const carryStatus = getCarryStatus(student);
  const lessons = robotLessonDates(student);
  const quickNoteHistory = finalizedQuickNotes(student, 'Robot');
  const demographics = studentDemographics(student);
  const liveLessons = localLiveSheetsReady ? state.robotLessons.filter((lesson) => studentRecordMatches(lesson, student))
    .sort((left, right) => String(right.sourceRow?.Date || '').localeCompare(String(left.sourceRow?.Date || ''))) : [];
  const review = state.robotPathwayReviews.find((item) => item.studentId === student.studentId);
  const usingReviewedSequence = localWorkspaceAllowed && review?.robotSequence
    && window.ICCLocalPathways.reviewedRobotSequence([], pathwayFor(student, 'Robot'), review).length > 0;
  const previousRobots = state.robotProgressHistory.filter((row) => studentRecordMatches(row, student)
    && !(usingReviewedSequence && row.source === 'starter-sheet-snapshot'
      && programmeProgress.some((item) => window.ICCLocalPathways.robotNameKey(item.Robot, review.programme)
        === window.ICCLocalPathways.robotNameKey(row.robot, review.programme))));
  const reconciliation = robotPathReconciliation(student);
  const preservedRobots = reconciliation ? [...reconciliation.retired, ...reconciliation.conflicts] : [];
  const preservedRobotsMarkup = preservedRobots.length
    ? `<div class="profile-panel quick-note-history"><div class="section-header compact"><h2>Other saved robot records</h2></div><p>These records are preserved separately because they are not in the current sequence or need review.</p>${table(['Robot', 'Status', 'Notes'], preservedRobots.map((row) => [text(row.Robot), text(row.Status), text(row.Notes || '—')]), 'quick-note-table')}</div>`
    : '';
  const previousRobotsMarkup = previousRobots.length
    ? `<div class="profile-panel quick-note-history"><div class="section-header compact"><div><span class="eyebrow">TRACKER HISTORY</span><h2>Other recorded robots</h2></div></div><p>These entries are retained separately because they do not match the current programme list.</p>${table(['Robot', 'Status', 'Tracker sequence', 'Notes'], previousRobots.map((row) => [text(row.robot), text(row.status), text(row.sequence || '—'), text(row.notes || '—')]), 'quick-note-table')}</div>`
    : '';
  const savedProgressMarkup = !(localWorkspaceAllowed && review?.hidePreviousTrackerProgress)
    && pathwayFor(student, 'Robot')?.startedOn && progress.length
    ? `<div class="profile-panel quick-note-history"><div class="section-header compact"><h2>Previous tracker progress</h2></div><p>These saved records are retained separately; their programme may not be recorded.</p>${table(['Robot', 'Level', 'Status', 'Notes'], progress.map((row) => [text(row.Robot), text(row.Level || '—'), text(row.Status), text(row.Notes || '—')]), 'quick-note-table')}</div>`
    : '';
  const journeySteps = programmeProgress.map((row) => {
    const status = String(row.Status || '').toLowerCase();
    const label = status === 'done' ? 'completed' : normalizeRobotName(row.Robot) === currentRobot ? 'current' : 'upcoming';
    return { row, label };
  });

  content.innerHTML = header(student.name, 'Operational view of the robot student’s current progress and what needs to be checked today.', button('← Students', 'students', 'mini-button')) + `
    <div class="robot-profile">
      <div class="robot-summary-card">
        <div class="summary-header"><div class="student-meta"><span class="eyebrow">STUDENT</span><h2>${text(student.name)}${borrowingWarningMarkup(student)}</h2>${borrowingSummary(student).map((item) => `<div class="borrowing-details">${text(item)}</div>`).join('')}<div class="student-demographics"><span>YOB <strong>${text(demographics.yob)}</strong></span><span>AGE <strong>${text(demographics.age)}</strong></span></div></div><div class="summary-actions"><select class="summary-carry-select ${getCarryStatusClass(carryStatus)}" data-carry-status="${escapeHtml(student.name)}" aria-label="Robot Carry Status"><option ${carryStatus === 'Take Robot Home' ? 'selected' : ''}>Take Robot Home</option><option ${carryStatus === 'Take Whole Kit Home' ? 'selected' : ''}>Take Whole Kit Home</option><option ${carryStatus === 'Leave Kit At Centre' ? 'selected' : ''}>Leave Kit At Centre</option></select><button class="summary-checklist-button ${getCarryStatusClass(carryStatus)}" data-action="check-components">Open Checklist</button></div></div>
        <div class="summary-grid">
          <div class="summary-item"><span>Programme</span><strong>${text(programmeLabel(studentProgramme(student)))}</strong>${pathwayEditorButton(student, 'Robot')}</div>
          <div class="summary-item"><span>Current Robot</span><strong>${text(currentRobot)}</strong></div>
          <div class="summary-item"><span>Robot Completion</span><strong>${Math.round((completedRobots / totalRobots) * 100)}%</strong></div>
          <div class="summary-item"><span>Completed Robots</span><strong>${completedRobots} / ${totalRobots}</strong></div>
          <div class="summary-item"><span>Last Lesson</span><strong>${text(lessons.last)}</strong></div>
          <div class="summary-item"><span>Next Lesson</span>${nextLessonMarkup(lessons.next)}</div>
        </div>
      </div>
      <div class="journey-layout">
        <div class="journey-panel"><div class="section-header compact"><div><span class="eyebrow">ROBOT LEARNING JOURNEY</span><h2>Current path</h2></div></div>${pathwayFor(student, 'Robot')?.startedOn ? '<p class="auth-help">Sheet lessons after the change date are assumed to belong to this pathway. The checklist still reflects the previous pathway.</p>' : ''}<div class="journey-track">
          ${journeySteps.length ? journeySteps.map(({ row, label }, index) => `<div class="journey-step ${label}"><span class="journey-icon">${label === 'completed' ? icon('check') : label === 'current' ? icon('bot') : icon('clock')}</span><div><strong>${text(normalizeRobotName(row.Robot) || 'Robot')}</strong><small>${row.Status === 'Unknown' ? 'Status unknown' : label === 'completed' ? 'Completed' : label === 'current' ? 'Current robot' : 'Upcoming'}</small></div><button class="status-button" data-progress="${index}" ${row.conflict ? 'disabled title="Multiple saved records need review"' : localLiveSheetsEnabled || liveSheetsMode || pathwayFor(student, 'Robot')?.startedOn || row.reviewedProgress ? 'disabled title="Progress is read-only"' : ''}>${text(row.Status || 'Not started')}</button></div>`).join('') : '<div class="empty-state">No robot learning path is available yet.</div>'}
        </div></div>
      </div>
      ${previousRobotsMarkup}${savedProgressMarkup}${preservedRobotsMarkup}
      ${localLiveSheetsReady ? `<div class="profile-panel quick-note-history"><div class="section-header compact"><div><span class="eyebrow">GOOGLE SHEET · READ ONLY</span><h2>Robot lesson history</h2></div></div>${liveLessons.length ? table(['Date', 'Tutor', 'Robot', 'Status', 'Comment', 'Remarks'], liveLessons.map((lesson) => [text(lesson.sourceRow.Date), text(lesson.Tutor), text(lesson.sourceRow['Robot Name']), text(lesson.sourceRow['Progress Status']), text(lesson.sourceRow.Comment), text(lesson.Remarks)]), 'quick-note-table') : '<div class="empty-state">No live Robot lessons for this student.</div>'}</div>` : ''}
      <div class="profile-panel quick-note-history"><div class="section-header compact"><div><span class="eyebrow">END-OF-DAY NOTES</span><h2>Quick Note History</h2></div></div>${quickNoteHistory.length ? table(['Date', 'Tutor', 'Note'], quickNoteHistory.map((record) => [text(record.date), text(record.tutor || 'Not recorded'), text(record.quickNotes || '—')]), 'quick-note-table') : '<div class="empty-state">No finalized quick notes for this student yet.</div>'}</div>
    </div>`;
  document.querySelector('#editPathway')?.addEventListener('click', () => openPathwayEditor(student, 'Robot', renderStudentProfile));
  document.querySelectorAll('[data-progress]').forEach((item) => item.onclick = () => {
    if (localLiveSheetsEnabled || liveSheetsMode) return;
    const entry = programmeProgress[Number(item.dataset.progress)];
    if (!entry || entry.conflict) return;
    let row = entry.sourceProgress || (progress.includes(entry) ? entry : null);
    if (!row && reconciliation) {
      row = { studentId: student.studentId, Student: student.name, Robot: entry.Robot, Sequence: entry.Sequence, Level: entry.Level, Status: entry.Status, sourceRow: { 'Student ID': student.studentId, 'Programme ID': 'ROB-L3', 'Robot Name': entry.Robot } };
      state.robotProgress.push(row);
    }
    if (!row) return;
    row.Status = row.Status === 'Done' ? 'Not started' : row.Status === 'Not started' ? 'In progress' : 'Done';
    entry.Status = row.Status;
    const ordered = programmeProgress.slice().sort((left, right) => Number(left.Sequence || 0) - Number(right.Sequence || 0));
    const completedCount = ordered.filter((entry) => String(entry.Status).toLowerCase() === 'done').length;
    student.nextRobot = ordered.find((entry) => String(entry.Status).toLowerCase() !== 'done')?.Robot || '';
    student.completion = `${Math.round((completedCount / Math.max(ordered.length, 1)) * 100)}%`;
    save('robot-students', state.robotStudents);
    save('robot-progress', state.robotProgress);
    renderStudentProfile();
  });
  loadNextCalendarLesson(student, 'Robot');
}

function renderCodingStudents(studentType = 'Coding') {
  const students = studentType === 'Math' ? state.mathStudents : state.codingStudents;
  const rows = students.map((student, index) => {
    const lessons = studentType === 'Math' ? [] : state.codingProgress.filter((row) => studentRecordMatches(row, student));
    const dashboard = studentType === 'Math' ? { currentConcept: student.topics || '—', currentLevel: 1, maxLevel: 1, progressPercent: Number.parseInt(student.completion, 10) || 0 } : buildCodingDashboard(student, lessons);
    const topic = String(studentType === 'Math' ? latestMathTopic(student) : dashboard.curriculumUnavailable ? 'Select CodeCombat level' : dashboard.currentConcept || 'Foundations').split('→').map((item) => item.trim()).filter(Boolean).pop() || 'Foundations';
    const level = dashboard.isCodeMonkeyPart2 ? dashboard.currentLevel : dashboard.finishedLevel;
    const baseCells = [
      `<button class="student-link" data-${studentType === 'Math' ? 'math' : 'coding'}-profile="${index}" aria-label="View ${studentType} progress for ${escapeHtml(student.name)}"><span class="student-avatar coding-avatar">${text(student.name).charAt(0)}</span><span><strong>${text(student.name)}</strong><small>View progress</small></span></button>`,
      `<span class="programme-chip">${icon('code')}<span>${text(studentProgramme(student) || 'Programme not set')}</span></span>`,
      `<span class="topic-chip">${icon('code')}<span>${text(topic)}</span></span>`
    ];
    return studentType === 'Math' ? baseCells : [...baseCells, dashboard.curriculumUnavailable ? 'Not available' : progressMarkup(dashboard.progressPercent, `Level ${level} / ${dashboard.maxLevel}`)];
  });
  const title = studentType === 'Math' ? 'Math Students' : 'Coding Students';
  const summary = studentType === 'Math' ? `<div class="dashboard-strip"><div><strong>${students.length}</strong><span>Math students</span></div></div>` : `<div class="dashboard-strip"><div><strong>${students.length}</strong><span>Coding students</span></div><div><strong>${students.filter((student) => Number.parseInt(student.completion, 10) >= 80).length}</strong><span>Near next level</span></div></div>`;
  content.innerHTML = header(title, studentType === 'Math' ? 'Tutor control center for imported Math topics.' : 'Tutor control center for current learning concepts and progress.') + summary + table(['Student', 'Programme', studentType === 'Math' ? 'Last topic' : 'Current topic', ...(studentType === 'Math' ? [] : ['Progress'])], rows);
  document.querySelectorAll(`[data-${studentType === 'Math' ? 'math' : 'coding'}-profile]`).forEach((item) => item.onclick = () => {
    const student = students[Number(studentType === 'Math' ? item.dataset.mathProfile : item.dataset.codingProfile)];
    if (!student) return;
    selectedStudent = student.name;
    if (studentType === 'Math') renderMathProfile(student);
    else renderCodingProfile(student);
  });
}

function numericLevel(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function codingTopicsForRange(student, startLevel, endLevel) {
  const start = numericLevel(startLevel);
  const end = numericLevel(endLevel);
  if (!start || !end) return [];
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  return [...new Set(getCurriculumForStudent(student).filter((row) => Number(row.Level) >= lower && Number(row.Level) <= upper).map((row) => String(row.Topic || '').trim()).filter(Boolean))];
}

function getCurriculumForStudent(student) {
  const course = studentProgramme(student);
  const curriculum = state.curriculum.length ? state.curriculum : services?.LibraryService.getCurriculum?.() || [];
  const rows = [...curriculum].filter((row) => row && String(row['Program name'] || '').trim());
  if (!course) return rows.sort((a, b) => Number(a.Level) - Number(b.Level));
  const upperCourse = window.ICCLocalPathways.codingCurriculumProgramme(course).toUpperCase();
  if (/^CS\d+$/.test(upperCourse)) return rows.filter((row) => String(row['Program name'] || '').toUpperCase() === upperCourse).sort((a, b) => Number(a.Level) - Number(b.Level));
  if (/^code\s*combat/i.test(course)) return rows.filter((row) => /^code\s*combat/i.test(String(row['Program name'] || '').trim())).sort((a, b) => Number(a.Level) - Number(b.Level));
  if (/codemonkey/i.test(course)) {
    const codeMonkeyRows = rows.filter((row) => /codemonkey/i.test(String(row['Program name'] || '')));
    const part = course.match(/P([12])/i)?.[1];
    return codeMonkeyRows.filter((row) => !part || (part === '1' ? Number(row.Level) < 88 : Number(row.Level) >= 88)).sort((a, b) => Number(a.Level) - Number(b.Level));
  }
  return rows.sort((a, b) => Number(a.Level) - Number(b.Level));
}

function codingLessonHistory(student) {
  const curriculum = getCurriculumForStudent(student);
  const pathway = pathwayFor(student, 'Coding');
  return state.codingLessons.map((lesson) => {
    const source = lesson.sourceRow || {};
    const name = lessonStudentName(lesson['Student (Coding)'] || source.Student || '');
    const startLevel = numericLevel(source["Today's Starting Level"] ?? lesson["Today's Starting Level"] ?? source['Starting Level']);
    const endLevel = numericLevel(source["Today's Finished Level"] ?? lesson["Today's Finished Level"] ?? source['Finished Level'] ?? source['Ending Level']);
    const lower = Math.min(startLevel ?? endLevel ?? 0, endLevel ?? startLevel ?? 0);
    const upper = Math.max(startLevel ?? endLevel ?? 0, endLevel ?? startLevel ?? 0);
    const date = lessonDateKey(source['Lesson Date'] || lesson['Lesson Date'] || lesson['Lesson time']);
    const appliesToPathway = !pathway?.startedOn || window.ICCLocalPathways.afterPathwayChange(date, pathway);
    const topics = lower && appliesToPathway ? [...new Set(curriculum.filter((row) => Number(row.Level) >= lower && Number(row.Level) <= upper).map((row) => String(row.Topic || '').trim()).filter(Boolean))] : [];
    return { date, startLevel, endLevel, topics, matches: studentRecordMatches({ ...lesson, name }, student) };
  }).filter((lesson) => lesson.matches && lesson.date).sort((left, right) => right.date.localeCompare(left.date));
}

function buildCodingDashboard(student, lessons) {
  const template = programmeTemplate(student);
  const pathway = pathwayFor(student, 'Coding');
  const curriculum = template.curriculum;
  const isCodeMonkeyPart2 = /codemonkey/i.test(template.programme) && /P2/i.test(template.programme);
  const ordered = [...curriculum].sort((a, b) => Number(a.Level) - Number(b.Level));
  const maxLevel = Math.max(1, ...ordered.map((row) => Number(row.Level) || 0));
  const minimumLevel = /codemonkey/i.test(studentProgramme(student)) && /P2/i.test(studentProgramme(student)) ? 88 : 1;
  const lessonLevels = lessons
    .filter((lesson) => /done|finished|completed/i.test(String(lesson.status || lesson.sourceRow?.['Robot Status'] || '')))
    .map((lesson) => numericLevel(lesson.sourceRow?.['Completed ending level'] ?? lesson.sourceRow?.['Ending level'] ?? lesson.next ?? lesson.progress))
    .filter((value) => Number.isFinite(value));
  const sourceFinishedLevel = numericLevel(student.sourceRow?.["Today's Finished Level"] ?? student.sourceRow?.['Ending Level'] ?? student.finishedLevel);
  const newPathwayLevels = pathway?.startedOn ? state.codingLessons
    .filter((lesson) => studentRecordMatches(lesson, student) && window.ICCLocalPathways.afterPathwayChange(lessonDateKey(lesson.sourceRow?.Date), pathway))
    .map((lesson) => numericLevel(lesson.sourceRow?.["Today's Finished Level"]))
    .filter((value) => Number.isFinite(value) && value >= minimumLevel && value <= maxLevel) : [];
  const finishedLevel = pathway?.startedOn
    ? (newPathwayLevels.length ? Math.max(...newPathwayLevels) : 0)
    : Math.max(sourceFinishedLevel || 0, lessonLevels.length ? Math.max(...lessonLevels) : 0);
  const currentLevel = Math.max(minimumLevel, Math.min(maxLevel, finishedLevel + 1));

  const currentRow = ordered.find((row) => Number(row.Level) === currentLevel) || ordered.filter((row) => Number(row.Level) <= currentLevel).pop() || ordered[0];
  const currentConcept = String(currentRow?.Topic || 'Foundations').trim() || 'Foundations';
  const uniqueTopicEntries = [];
  const seenTopics = new Set();
  ordered.forEach((row) => {
    const topic = String(row.Topic || '').trim();
    if (topic && !seenTopics.has(topic)) { seenTopics.add(topic); uniqueTopicEntries.push({ level: Number(row.Level) || 0, topic }); }
  });
  const completedConcepts = uniqueTopicEntries.filter((entry) => entry.level <= finishedLevel && entry.topic !== currentConcept).map((entry) => entry.topic);
  const upcomingConcepts = uniqueTopicEntries.filter((entry) => entry.level > finishedLevel && entry.topic !== currentConcept).map((entry) => entry.topic);
  const nextConcept = upcomingConcepts[0] || 'Capstone / revision';
  const knownConcepts = completedConcepts.slice(-6);

  const lessonDates = lessons
    .map((row) => row.sourceRow?.['Lesson time'] || row.sourceRow?.Date || row.project || '')
    .filter(Boolean)
    .slice(-10);
  const lastLessonDate = lessonDates[lessonDates.length - 1] || student.lastUpdated || 'No recent lessons';
  const progressPercent = pathway?.startedOn && minimumLevel > 1
    ? Math.min(100, Math.max(0, Math.round(((finishedLevel ? finishedLevel - minimumLevel + 1 : 0) / Math.max(1, maxLevel - minimumLevel + 1)) * 100)))
    : Math.min(100, Math.max(0, Math.round((finishedLevel / maxLevel) * 100)));

  return {
    curriculumUnavailable: /^code\s*combat/i.test(template.programme) && !ordered.length,
    isCodeMonkeyPart2,
    currentLevel,
    maxLevel,
    currentConcept,
    nextConcept,
    knownConcepts,
    upcomingConcepts,
    completedConcepts,
    finishedLevel,
    lastLessonDate,
    progressPercent
  };
}

function renderCodingProfile(student) {
  const lessons = state.codingProgress.filter((row) => studentRecordMatches(row, student));
  const history = codingLessonHistory(student).slice(0, 8);
  const dashboard = buildCodingDashboard(student, lessons);
  const lessonSchedule = studentLessonSchedule(student, 'Coding');
  const quickNoteHistory = finalizedQuickNotes(student, 'Coding');
  const demographics = studentDemographics(student);

  const curriculumProgress = lessons.map((row) => {
    const source = row.sourceRow || {};
    const topic = row.topic || row.topics || row.progress || row.project || source.Topic || source.Progress || '';
    return {
      level: numericLevel(row.level_number ?? row.Level ?? row.level ?? row.next ?? source.Level ?? source['Finished Level']),
      topic: Array.isArray(topic) ? topic.join(', ') : topic,
      status: row.status || source.Status || 'Recorded',
    };
  }).filter((row) => row.topic || row.level || row.status !== 'Recorded').sort((left, right) => (left.level || 0) - (right.level || 0));
  const curriculumProgressMarkup = curriculumProgress.length
    ? table(['Level', 'Topic', 'Status'], curriculumProgress.map((row) => [text(row.level ?? '—'), text(row.topic || '—'), text(row.status)]), 'quick-note-table')
    : '<div class="empty-state">No curriculum progress records have been imported for this student yet.</div>';
  const historyMarkup = history.length
    ? `<div class="history-list"><div class="history-row history-head"><span>Date</span><span>Start</span><span>End</span><span>Topics Covered</span></div>${history.map((row) => {
        return `<div class="history-row"><span>${text(row.date)}</span><span>${text(row.startLevel ?? '—')}</span><span>${text(row.endLevel ?? '—')}</span><span>${text(row.topics.join(', ') || 'No curriculum topic mapped')}</span></div>`;
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
        ${dashboard.completedConcepts.length ? dashboard.completedConcepts.map((topic) => `<div class="roadmap-step completed"><span class="roadmap-icon">${icon('check')}</span><div><strong>${text(topic)}</strong><small>Completed</small></div></div>`).join('') : dashboard.isCodeMonkeyPart2 ? '' : `<div class="roadmap-step neutral"><span class="roadmap-icon">${icon('code')}</span><div><strong>Starting point</strong><small>Warm-up</small></div></div>`}
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
              <h2>${text(student.name)}${borrowingWarningMarkup(student)}</h2>${borrowingSummary(student).map((item) => `<div class="borrowing-details">${text(item)}</div>`).join('')}
              <div class="student-demographics"><span>YOB <strong>${text(demographics.yob)}</strong></span><span>AGE <strong>${text(demographics.age)}</strong></span></div>
            </div>
          </div>
          <div class="snapshot-grid">
            <div class="snapshot-item">
              <span class="snapshot-label">Programme</span>
              <strong>${text(studentProgramme(student) || 'Course not set')}</strong>${pathwayEditorButton(student, 'Coding')}
            </div>
            <div class="snapshot-item accent-item">
              <span class="snapshot-label">Current Level</span>
              <strong>${dashboard.curriculumUnavailable ? 'Not available' : dashboard.currentLevel}</strong>
            </div>
            <div class="snapshot-item accent-item">
              <span class="snapshot-label">Current Topic</span>
              <strong>${dashboard.curriculumUnavailable ? 'Not available' : text(dashboard.currentConcept)}</strong>
            </div>
            <div class="snapshot-item">
              <span class="snapshot-label">Progress</span>
              <strong>${dashboard.curriculumUnavailable ? 'Not available' : `${dashboard.finishedLevel} / ${dashboard.maxLevel} (${dashboard.progressPercent}%)`}</strong>
            </div>
            <div class="snapshot-item">
              <span class="snapshot-label">Last Lesson</span>
              <strong>${text(lessonSchedule.last)}</strong>
            </div>
            <div class="snapshot-item">
              <span class="snapshot-label">Next Lesson</span>
              ${nextLessonMarkup(lessonSchedule.next)}
            </div>
          </div>
        </div>
      </div>
      ${pathwayFor(student, 'Coding')?.startedOn ? '<p class="auth-help">Sheet lessons after the change date are assumed to belong to this programme. Earlier lessons remain in history.</p>' : ''}
      <div class="dashboard-grid">
        <div class="main-column">
          ${dashboard.curriculumUnavailable ? '<div class="empty-state">Select the student’s CodeCombat level using Update pathway to show the matching CS curriculum.</div>' : roadmapMarkup}
        </div>

        <div class="side-column">
          ${dashboard.curriculumUnavailable ? '' : `<div class="context-card">
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
          </div>`}

          <div class="history-card">
            <div class="section-header compact">
              <div>
                <span class="eyebrow">LESSON HISTORY</span>
                <h2>Recent lessons</h2>
              </div>
            </div>
            ${historyMarkup}
          </div>
        </div>
      </div>
      <div class="profile-panel quick-note-history"><div class="section-header compact"><div><span class="eyebrow">CURRICULUM PROGRESS</span><h2>Student progress records</h2></div></div>${curriculumProgressMarkup}</div>
      <div class="profile-panel quick-note-history"><div class="section-header compact"><div><span class="eyebrow">END-OF-DAY NOTES</span><h2>Quick Note History</h2></div></div>${quickNoteHistory.length ? table(['Date', 'Tutor', 'Note'], quickNoteHistory.map((record) => [text(record.date), text(record.tutor || 'Not recorded'), text(record.quickNotes || '—')]), 'quick-note-table') : '<div class="empty-state">No finalized quick notes for this student yet.</div>'}</div>
    </div>
  `;
  document.querySelector('#editPathway')?.addEventListener('click', () => openPathwayEditor(student, 'Coding', () => renderCodingProfile(student)));
  loadNextCalendarLesson(student, 'Coding');
}

function renderMathProfile(student) {
  const lessonSchedule = studentLessonSchedule(student, 'Math');
  const quickNoteHistory = finalizedQuickNotes(student, 'Math');
  const demographics = studentDemographics(student);
  const progressHistory = state.mathLessons.map((lesson) => {
    const source = lesson.sourceRow || {};
    const name = lessonStudentName(lesson['Student (Math)'] || source.Student || '');
    return {
      date: lessonDateKey(source['Lesson Date'] || lesson['Lesson Date'] || lesson['Lesson time']),
      tutor: lesson.Tutor || source['Tutor Name'] || '',
      topic: source.Progress || lesson.Progress || source.Topic || lesson.Topic || '',
      comment: source.Comment || lesson.Comment || '',
      matches: studentRecordMatches({ ...lesson, name }, student),
    };
  }).filter((lesson) => lesson.matches && (lesson.date || lesson.topic || lesson.comment))
    .sort((left, right) => right.date.localeCompare(left.date));
  const progressHistoryMarkup = progressHistory.length
    ? table(['Date', 'Tutor', 'Topic', 'Comment'], progressHistory.map((lesson) => [text(lesson.date || '—'), text(lesson.tutor || 'Not recorded'), text(lesson.topic || '—'), text(lesson.comment || '—')]), 'quick-note-table')
    : '<div class="empty-state">No progress or lesson records have been imported for this student yet.</div>';
  content.innerHTML = header(student.name, 'Math student profile.', button('← Math students', 'math-students', 'mini-button')) + `
    <div class="coding-dashboard math-dashboard">
      <div class="student-snapshot-card"><div class="student-summary"><div class="student-identity"><div class="student-avatar">${text(student.name).charAt(0).toUpperCase() || 'M'}</div><div><span class="eyebrow">MATH STUDENT</span><h2>${text(student.name)}${borrowingWarningMarkup(student)}</h2>${borrowingSummary(student).map((item) => `<div class="borrowing-details">${text(item)}</div>`).join('')}
              <div class="student-demographics"><span>YOB <strong>${text(demographics.yob)}</strong></span><span>AGE <strong>${text(demographics.age)}</strong></span></div></div></div>
        <div class="snapshot-grid">
          <div class="snapshot-item"><span class="snapshot-label">Programme</span><strong>${text(studentProgramme(student))}</strong>${pathwayEditorButton(student, 'Math')}</div>
          <div class="snapshot-item accent-item"><span class="snapshot-label">Last Topic</span><strong>${text(latestMathTopic(student))}</strong></div>
          <div class="snapshot-item"><span class="snapshot-label">Last Lesson</span><strong>${text(lessonSchedule.last)}</strong></div>
          <div class="snapshot-item"><span class="snapshot-label">Next Lesson</span>${nextLessonMarkup(lessonSchedule.next)}</div>
        </div>
      </div></div>
      <div class="profile-panel quick-note-history"><div class="section-header compact"><div><span class="eyebrow">MATH PROGRESS</span><h2>Progress history</h2></div></div>${progressHistoryMarkup}</div>
      <div class="profile-panel quick-note-history"><div class="section-header compact"><div><span class="eyebrow">END-OF-DAY NOTES</span><h2>Quick Note History</h2></div></div>${quickNoteHistory.length ? table(['Date', 'Tutor', 'Note'], quickNoteHistory.map((record) => [text(record.date), text(record.tutor || 'Not recorded'), text(record.quickNotes || '—')]), 'quick-note-table') : '<div class="empty-state">No finalized quick notes for this student yet.</div>'}</div>
    </div>`;
  document.querySelector('#editPathway')?.addEventListener('click', () => openPathwayEditor(student, 'Math', () => renderMathProfile(student)));
  loadNextCalendarLesson(student, 'Math');
}

function renderComponents() {
  const kit = activeInventoryKit;
  const inventory = services.InventoryService.getItems();
  const priceFor = (item) => item['Unit Price'] || services.LibraryService.getComponentLibrary().find((libraryItem) => libraryItem.Component === item.Component && libraryItem.Kit === item.Kit)?.['Unit Price'] || '';
  const filtered = inventory.filter((item) => kit === 'ALL' || item.Kit === kit);
  const kits = [...new Set(inventory.map((item) => item.Kit).filter(Boolean))].sort();
  const inventoryRows = filtered.map((item) => { const index = inventory.indexOf(item); const itemPrice = priceFor(item); const sourceInventory = state.inventory.find((row) => row.Component === item.Component && row.Kit === item.Kit); const libraryItem = services.LibraryService.getComponentLibrary().find((row) => row.Component === item.Component && row.Kit === item.Kit); const levelAppeared = item['Appears in'] || item['Level appeared'] || sourceInventory?.['Appears in'] || libraryItem?.['Appears in'] || libraryItem?.['Appears in levels'] || libraryItem?.Levels || '—'; return [item.Component, itemPrice ? `HK$${itemPrice}` : 'Not priced', levelAppeared, `<input class="inline-input inventory-qty-input" type="number" min="0" data-center-inventory-qty="${index}" value="${escapeHtml(item['Total center qty'] || '0')}">`, `<input class="inline-input inventory-date-input" type="date" data-center-inventory-date="${index}" value="${escapeHtml(item['Last counted'] || '')}">`, `<textarea class="inventory-note-input" data-center-inventory-note="${index}" rows="2" placeholder="Add note">${escapeHtml(item.Notes || '')}</textarea>`]; });
  const kitTabs = ['ALL', ...kits].map((value) => `<button class="tab-button ${activeInventoryKit === value ? 'active' : ''}" data-action="inventory-kit:${value}">${value === 'ALL' ? 'All Kits' : text(value)}</button>`).join('');
  content.innerHTML = header('Center Inventory', 'Centre-owned stock ledger, separate from student component requirements.') + `<div class="library-tabs inventory-kit-tabs">${kitTabs}</div><div class="inventory-summary"><strong>${filtered.length}</strong><span>${activeInventoryKit === 'ALL' ? 'All centre components' : `${activeInventoryKit} centre components`}</span></div>${table(['Component', 'Price', 'Level appeared', 'Centre qty', 'Last counted', 'Notes'], inventoryRows)}`;
  document.querySelectorAll('[data-center-inventory-qty]').forEach((input) => input.onchange = async () => { await services.InventoryService.updateItem(`${inventory[Number(input.dataset.centerInventoryQty)].Kit}:${inventory[Number(input.dataset.centerInventoryQty)].Component}`, { 'Total center qty': input.value }); });
  document.querySelectorAll('[data-center-inventory-date]').forEach((input) => input.onchange = async () => { await services.InventoryService.updateItem(`${inventory[Number(input.dataset.centerInventoryDate)].Kit}:${inventory[Number(input.dataset.centerInventoryDate)].Component}`, { 'Last counted': input.value }); });
  document.querySelectorAll('[data-center-inventory-note]').forEach((input) => input.onchange = async () => { await services.InventoryService.updateItem(`${inventory[Number(input.dataset.centerInventoryNote)].Kit}:${inventory[Number(input.dataset.centerInventoryNote)].Component}`, { Notes: input.value }); });
}

function renderLibraries(active = 'AIKIRO') {
  content.innerHTML = header('Libraries & curriculum', 'Robot programmes and coding curriculum.') + `<div class="library-tabs">${['Robot Library', 'Coding Curriculum'].map((name) => button(name, `library-section:${name}`, 'tab-button')).join('')}</div><div id="libraryTable"></div>`;
  showLibrarySection('Robot Library');
}
function showLibrarySection(section) {
  activeLibrarySection = section;
  const target = document.querySelector('#libraryTable');
  if (section === 'Robot Library') target.innerHTML = `<div class="library-tabs sub-tabs">${programmeVariants().map((name) => button(name, `library:${name}`, 'tab-button')).join('')}</div><div id="subLibraryTable"></div>`;
  if (section === 'Coding Curriculum') target.innerHTML = `<div class="library-tabs sub-tabs">${['CS1 curriculum','CS2 curriculum','CS3 curriculum','CS4 curriculum','CS5 curriculum','CodeMonkey Part 1','CodeMonkey Part 2'].map((name) => button(name, `library:${name}`, 'tab-button')).join('')}</div><div id="subLibraryTable"></div>`;
  if (section === 'Center Inventory') { target.innerHTML = '<div id="subLibraryTable"></div>'; showLibrary('Center inventory'); return; }
  const defaultTab = section === 'Coding Curriculum' ? 'CS1 curriculum' : programmeVariants()[0];
  showLibrary(defaultTab);
  document.querySelectorAll('#libraryTable > .library-tabs .tab-button').forEach((item) => {
    item.onclick = () => {
      const action = item.dataset.action || '';
      if (action.startsWith('library-section:')) showLibrarySection(action.slice(16));
      else if (action.startsWith('library:')) showLibrary(action.slice(8));
    };
  });
}
function showLibrary(name) {
  const target = document.querySelector('#subLibraryTable') || document.querySelector('#libraryTable');
  let headers = [], rows = [];
  if (activeLibrarySection === 'Robot Library' && programmeVariants().includes(name)) {
    const robotRows = Array.isArray(window.__ICC_LOCAL_STATE__?.robots) ? window.__ICC_LOCAL_STATE__.robots : services.LibraryService.getRobotLibrary();
    const exactRows = robotRows
      .filter((row) => String(row['Programme Name'] || '').trim().toLowerCase() === name.trim().toLowerCase())
      .map((row) => [row.Sequence, row['Robot name'], row.Level, row['Kit name']]);
    target.innerHTML = table(['Sequence', 'Robot', 'Level', 'Kit'], exactRows);
    return;
  }
  if (programmeVariants().includes(name)) {
    if (activeLibrarySection === 'Robot Library') {
      headers = ['Sequence', 'Robot', 'Level', 'Kit'];
      const match = name.match(/^(AIKIRO|ROBOKIT|UARO)\s+(Lv\d+(?:_[a-z]+)?)/i);
      const kitKey = match?.[1]?.toUpperCase() || '';
      const levelKey = match?.[2]?.toLowerCase() || '';
      const robotRows = Array.isArray(window.__ICC_LOCAL_STATE__?.robots) ? window.__ICC_LOCAL_STATE__.robots : services.LibraryService.getRobotLibrary();
      rows = robotRows.filter((row) => String(row['Programme Name'] || '').trim().toLowerCase() === name.trim().toLowerCase()).map((row) => [row.Sequence, row['Robot name'], row.Level, row['Kit name']]);
    } else {
      headers = ['Component', 'Unit price', 'Level appeared'];
      const match = name.match(/^(AIKIRO|ROBOKIT|UARO)\s+(Lv\d+(?:_[a-z]+)?)/i);
      const kitKey = match?.[1]?.toUpperCase() || '';
      const levelKey = match?.[2]?.toLowerCase().replace(/_original|_additional/, '') || '';
      const componentKit = kitKey === 'UARO' ? 'URAO' : kitKey;
      const unique = services.LibraryService.getComponentLibrary().filter((row) => String(row.Kit).toUpperCase() === componentKit && Number(row[levelKey.replace('lv', 'Lv')] || 0) > 0);
      rows = unique.map((row) => [row.Component, price(row['Unit Price']), `${name} · ${row['Appears in'] || row['Appears in levels'] || row.Levels || '—'}`]);
    }
  }
  if (/^CS[1-5] curriculum$/.test(name)) {
    const programme = name.replace(' curriculum', '').toLowerCase();
    headers = ['Item', 'Level', 'Topic', 'Program'];
    rows = services.LibraryService.getCurriculum()
      .filter((row) => String(row['Program name'] || row.programme_id).toLowerCase() === programme)
      .map((row) => [row.Item || row.item, row.Level || row.level, row.Topic || row.topic, row['Program name'] || row.programme_id]);
  }
  if (name === 'CodeMonkey Part 1' || name === 'CodeMonkey Part 2') {
    const partTwo = name === 'CodeMonkey Part 2';
    headers = ['Item', 'Level', 'Topic', 'Program'];
    rows = services.LibraryService.getCurriculum()
      .filter((row) => {
        const programme = String(row['Program name'] || row.programme_id).toLowerCase();
        const level = Number(row.Level || row.level);
        return programme.startsWith('codemonkey') && (partTwo ? level >= 88 : level < 88);
      })
      .map((row) => [row.Item || row.item, row.Level || row.level, row.Topic || row.topic, row['Program name'] || row.programme_id]);
  }
  if (name === 'Center inventory') {
    headers = ['Component ID', 'Component', 'Tier', 'Kit', 'Expected qty', 'Centre qty', 'Result'];
    rows = services.InventoryService.getItems().map((row) => {
      const expected = row['Required Qty'] || row['Demo qty'] || '0';
      const actual = row['Total center qty'] || '0';
      return [row['Component ID'], row.Component, row.Tier, row.Kit, expected, actual, quantityResult(expected, actual)];
    });
  }
  target.innerHTML = table(headers, rows);
}

function renderOperations() {
  content.innerHTML = header('Borrowing log', 'Track borrowed components, returns, kits, and student ownership.') + '<div id="operationTable"></div>';
  showOperation('Borrowing');
}
function showOperation(name) {
  const target = document.querySelector('#operationTable');
  if (name === 'Borrowing') {
    target.innerHTML = `<div class="section-header compact"><div><span class="eyebrow">STUDENT BORROWING</span><h2>Current records</h2></div>${button('Log borrowing +', 'new-borrowing', 'primary-button')}</div>` + table(['Date', 'Student', 'Borrowed component', 'Qty', 'Status', 'Return date'], services.BorrowingService.getBorrowingLogs().map((row, index) => [text(row.sourceRow?.['Borrowed on'] || today()), text(row.borrower || row.sourceRow?.Student), text(row.item), text(row.sourceRow?.Quantity), `<button class="status-button borrowing-status" data-borrowing="${index}">${text(row.status)}</button>`, row.status === 'Returned' || row.sourceRow?.['Returned on'] ? text(row.sourceRow?.['Returned on'] || 'Returned') : `<input class="inline-input borrowing-return-date" type="date" data-borrowing-return-date="${index}" aria-label="Return date">`]));
    document.querySelectorAll('[data-borrowing]').forEach((item) => item.onclick = () => { services.BorrowingService.returnBorrowedItem(item.dataset.borrowing); showOperation('Borrowing'); });
    document.querySelectorAll('[data-borrowing-return-date]').forEach((input) => input.onchange = () => {
      const row = services.BorrowingService.getBorrowingLogs()[Number(input.dataset.borrowingReturnDate)];
      if (!row) return;
      row.status = 'Returned';
      row.sourceRow = { ...(row.sourceRow || {}), Status: 'Returned', 'Returned on': input.value };
      state.borrowings = services.BorrowingService.getBorrowingLogs();
      save('borrowings', state.borrowings);
      showOperation('Borrowing');
    });
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
  document.querySelector('#recordForm').onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const checklist = state.componentItems.filter((row) => row.student === data.student);
    const component = checklist.find((row) => row.item === data.component);
    if (!component) return;
    await services.BorrowingService.createBorrowingLog({ item: component.item, borrower: data.student, status: 'Still borrowing', sourceRow: { Student: data.student, Component: component.item, Quantity: data.quantity, Kit: component.kit, Status: 'Still borrowing', 'Borrowed on': today(), 'Returned on': '' } });
    state.borrowings = services.BorrowingService.getBorrowingLogs();
    save('borrowings', state.borrowings);
    document.querySelector('#modalBackdrop').hidden = true;
    showOperation('Borrowing');
  };
}

function createProgrammeRecords(studentName, program) {
  const programLabel = display(program);
  const normalizedProgramLabel = programLabel.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const kit = programLabel.match(/^(AIKIRO|ROBOKIT|UARO)/i)?.[1]?.toUpperCase() || '';
  const robotKit = kit;
  const componentKit = kit;
  const level = programLabel.match(/Lv\d+(?:_[a-z]+)?/i)?.[0] || '';
  const levelNumberValue = levelNumber(level) || 1;
  const progress = state.robots
    .filter((robot) => String(robot['Programme Name'] || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() === normalizedProgramLabel.toLowerCase())
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
  const checklist = state.inventory
    .filter((component) => String(component.Kit).toUpperCase() === componentKit)
    .map((component) => {
      const required = Number(component[`Lv${levelNumberValue} total`] ?? Array.from({ length: levelNumberValue }, (_, index) => Number(component[`Lv${index + 1}`] || 0)).reduce((sum, quantity) => sum + quantity, 0));
      return { component, required: Number(required) || 0 };
    })
    .filter(({ required }) => required > 0)
    .map(({ component, required }) => ({
      item: component.Component,
      componentId: component['Component ID'],
      tier: component.Tier || '',
      requiredQty: String(required),
      studentQty: '',
      quantityStatus: 'Missing',
      student: studentName,
      kit: kit,
      level,
      unitPrice: component['Unit Price'] ? price(component['Unit Price']) : '',
      priceOptions: component['Unit Price'] ? [price(component['Unit Price'])] : [],
      sourcePath: 'Generated from component inventory',
      sourceRow: { 'Component ID': component['Component ID'], Item: component.Component, Tier: component.Tier || '', 'Required Qty': String(required), 'Student Qty': '', 'Qty status': 'Missing', Notes: '' },
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
    if (pathwayFor(student, 'Robot')) return;
    const hasProgress = state.robotProgress.some((row) => display(row.Student || row['Student (linked)']) === student.name);
    const studentItems = state.componentItems.filter((row) => row.student === student.name);
    const hasChecklist = studentItems.length > 0;
    const hasLegacyChecklist = studentItems.some((row) => !row.componentId);
    if (!hasProgress || !hasChecklist || hasLegacyChecklist) {
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
  if (action === 'math-students') { activeView = 'Math Students'; render(); }
  if (action === 'finalize-today') { finalizeToday(); renderTodaysStudents(); }
  if (action === 'check-system-status') checkSystemStatus();
  if (action === 'refresh-calendar' && calendarEnabled) refreshLocalCalendar();
  if (action === "today-students") { activeView = "Today's Students"; renderTodaysStudents(); }
  if (action.startsWith('inventory-kit:')) { activeInventoryKit = action.slice(14); renderComponents(); }
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

document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) handleAction(action);
});
content.addEventListener('click', (event) => {
  const profile = event.target.closest('[data-profile]');
  if (profile) { selectedStudent = state.robotStudents[Number(profile.dataset.profile)].name; renderStudentProfile(); }
  const todayProfile = event.target.closest('[data-today-profile]');
  if (todayProfile) {
    selectedStudent = todayProfile.dataset.todayProfile;
    if (todayProfile.dataset.todayType === 'Coding') renderCodingProfile(state.codingStudents.find((row) => row.name === selectedStudent));
    else if (todayProfile.dataset.todayType === 'Math') renderMathProfile(state.mathStudents.find((row) => row.name === selectedStudent));
    else renderStudentProfile();
  }
  const action = event.target.closest('[data-action]');
  if (action?.dataset.studentName) {
    selectedStudent = action.dataset.studentName;
    if (action.dataset.action === 'checklist') renderStudentChecklist();
    if (action.dataset.action === 'coding-profile') renderCodingProfile(state.codingStudents.find((row) => row.name === selectedStudent));
    if (action.dataset.action === 'math-profile') renderMathProfile(state.mathStudents.find((row) => row.name === selectedStudent));
  }
});
content.addEventListener('change', (event) => {
  if (event.target.matches('[data-coding-start], [data-coding-end], [data-topic-learnt]')) {
    const name = event.target.dataset.codingStart || event.target.dataset.codingEnd || event.target.dataset.topicLearnt;
    const row = todayLessonRows().find((item) => item.type === 'Coding' && item.name === name);
    if (row) {
      const startLevel = event.target.dataset.codingStart ? event.target.value : row.startingLevel;
      const endLevel = event.target.dataset.codingEnd ? event.target.value : row.endingLevel;
      const learntTopic = event.target.dataset.topicLearnt ? event.target.value : row.learntTopic;
      saveDailyLessonDraft(row, { startingLevel: startLevel, endingLevel: endLevel, learntTopic });
      const output = document.querySelector(`[data-coding-topics="${CSS.escape(name)}"]`);
      if (output) output.textContent = codingTopicsForRange(row.student, startLevel, endLevel).join(', ') || 'Enter levels';
    }
  }
  if (event.target.matches('[data-carry-status]')) {
    const student = state.robotStudents.find((row) => row.name === selectedStudent);
    if (student) { student.carryStatus = event.target.value; save('robot-students', state.robotStudents); renderStudentProfile(); }
  }
  if (event.target.matches('[data-carry-status-student]')) {
    const student = state.robotStudents.find((row) => row.name === event.target.dataset.carryStatusStudent);
    if (student) {
      student.carryStatus = event.target.value;
      const row = todayLessonRows().find((item) => item.type === 'Robot' && item.name === student.name && (!event.target.dataset.calendarEvent || item.calendarEventId === event.target.dataset.calendarEvent));
      if (row) saveDailyLessonDraft(row, { carryStatus: event.target.value, quickNotes: row.notes });
      save('robot-students', state.robotStudents);
    }
  }
  if (event.target.matches('[data-tutor-student]')) {
    const name = event.target.dataset.tutorStudent;
    const robot = state.robotStudents.find((row) => row.name === name);
    const coding = state.codingStudents.find((row) => row.name === name);
    if (robot) { robot.tutor = event.target.value; robot.sourceRow.Tutor = event.target.value; save('robot-students', state.robotStudents); }
    if (coding) { coding.tutor = event.target.value; save('coding-students', state.codingStudents); }
  }
  if (event.target.matches('[data-lesson-notes]')) {
    const row = todayLessonRows().find((item) => item.name === event.target.dataset.lessonNotes && (!event.target.dataset.calendarEvent || item.calendarEventId === event.target.dataset.calendarEvent));
    if (row?.lesson) {
      row.lesson.Remarks = event.target.value;
      saveDailyLessonDraft(row, { quickNotes: event.target.value, ...(row.type === 'Robot' ? { carryStatus: row.carryStatus } : {}) });
      if (!row.calendarEventId) {
        row.student.sourceRow = { ...(row.student.sourceRow || {}), Remarks: event.target.value };
        save(row.type === 'Robot' ? 'robot-lessons' : row.type === 'Coding' ? 'coding-lessons' : 'math-lessons', row.type === 'Robot' ? state.robotLessons : row.type === 'Coding' ? state.codingLessons : state.mathLessons);
        save(row.type === 'Math' ? 'math-students' : row.type === 'Coding' ? 'coding-students' : 'robot-students', row.type === 'Math' ? state.mathStudents : row.type === 'Coding' ? state.codingStudents : state.robotStudents);
      }
    }
  }
  if (event.target.matches('[data-checklist-qty]')) {
    const row = state.componentItems[Number(event.target.dataset.checklistQty)];
    row.studentQty = event.target.value; row.quantityStatus = quantityResult(row.requiredQty, event.target.value); row.sourceRow['Student Qty'] = event.target.value; row.sourceRow['Qty status'] = row.quantityStatus; save('component-items', state.componentItems); renderStudentChecklist();
  }
  if (event.target.matches('[data-checklist-note]')) { state.componentItems[Number(event.target.dataset.checklistNote)].sourceRow.Notes = event.target.value; save('component-items', state.componentItems); }
  if (event.target.matches('.universal-sort-field, .universal-sort-direction')) refreshUniversalTable(event.target.closest('.universal-table'));
});
content.addEventListener('input', (event) => { if (event.target.matches('.universal-search')) refreshUniversalTable(event.target.closest('.universal-table')); });
content.addEventListener('click', (event) => { if (event.target.matches('.universal-clear')) { const container = event.target.closest('.universal-table'); container.querySelector('.universal-search').value = ''; container.querySelectorAll('.universal-sort-field').forEach((field, index) => { field.value = index === 0 ? String(universalTableRegistry.get(container.dataset.universalId)?.sortIndex || 0) : ''; }); container.querySelectorAll('.universal-sort-direction').forEach((field) => { field.value = 'asc'; }); refreshUniversalTable(container); } });
document.querySelector('#closeModal').onclick = () => { document.querySelector('#modalBackdrop').hidden = true; };
document.querySelector('#modalBackdrop').onclick = (event) => { if (event.target.id === 'modalBackdrop') document.querySelector('#modalBackdrop').hidden = true; };
document.querySelector('#closeAuth').onclick = hideAuth;
document.querySelector('#authBackdrop').onclick = (event) => { if (event.target.id === 'authBackdrop') hideAuth(); };
authButton.onclick = () => {
  if (localDemoEnabled && localDemoSignedIn) {
    sessionStorage.removeItem(localDemoSessionKey);
    window.location.reload();
    return;
  }
  if (getAccessToken()) {
    setAccessToken('');
    if (!localWorkspaceAllowed) window.location.reload();
    return;
  }
  showAuth();
};
authForm.onsubmit = handlePasswordSignIn;
updateAuthButton();
if (localDemoEnabled) {
  document.querySelector('.auth-help').textContent = 'Local demo only: this screen does not protect student data. Do not use this password on a public website.';
  document.querySelector('#closeAuth').hidden = !localDemoSignedIn;
  document.querySelector('.app-shell').hidden = !localDemoSignedIn;
  if (!localDemoSignedIn) showAuth();
  if (localGoogleSignInEnabled && !localDemoSignedIn) setupLocalGoogleSignIn();
}
scheduleAutomaticFinalization();
const sidebar = document.querySelector('.sidebar');
const toggleSidebar = () => {
  if (window.innerWidth <= 760) sidebar?.classList.toggle('open');
  else sidebar?.classList.toggle('collapsed');
};
document.querySelector('#menuButton').onclick = toggleSidebar;
document.querySelector('#sidebarToggle').onclick = toggleSidebar;
document.addEventListener('click', (event) => {
  if (window.innerWidth <= 760 && sidebar?.classList.contains('open') && !sidebar.contains(event.target) && !event.target.closest('#menuButton')) sidebar.classList.remove('open');
});
document.querySelector('#exportButton').onclick = () => exportWorkspace();
document.querySelector('#globalSearch').oninput = (event) => {
  const query = event.target.value.trim().toLowerCase();
  if (!query) return render();
  const rows = state.robotStudents.filter((student) => JSON.stringify(student).toLowerCase().includes(query));
  activeView = 'Students';
  renderNav();
  document.querySelector('#breadcrumb').textContent = `Students · ${rows.length} matches`;
  content.innerHTML = header('Student search', `${rows.length} matching student profiles.`) + table(['Student', 'Programme', 'Next robot', 'Completion', 'Check'], rows.map((student) => [text(student.name), text(studentProgramme(student)), text(nextRobotForStudent(student)), text(robotCompletion(student)), text(student.sourceRow?.Check)]));
};
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelector('.sidebar')?.classList.remove('open'); });

function renderDataLoadError(error) {
  activeView = 'System Status';
  renderNav();
  document.querySelector('#breadcrumb').textContent = activeView;
  content.innerHTML = header('Workspace unavailable', `The local workspace could not be loaded: ${error.message}`);
}

const workspaceData = localDemoEnabled && !localDemoSignedIn
  ? Promise.resolve({})
  : localWorkspaceAllowed
  ? fetch(`./workspace-db.json?v=${Date.now()}`, { cache: 'no-store' }).then((response) => {
    if (!response.ok) throw new Error(`Local workspace data request returned ${response.status}`);
    return response.json();
  })
  : (getAccessToken() || iapAuthEnabled) && getApiBaseUrl()
    ? apiRequest('/workspace/bootstrap')
    : iapAuthEnabled ? Promise.reject(new Error('The same-origin /api route is not configured for this IAP deployment.'))
    : Promise.resolve({});
if (!localWorkspaceAllowed && !getAccessToken() && !iapAuthEnabled) {
  services = window.createServices();
  if (!getApiBaseUrl()) {
    authError.hidden = false;
    authError.textContent = 'Sign-in is not configured. Contact the workspace administrator.';
  }
  showAuth();
}
if (!localWorkspaceAllowed && iapAuthEnabled && !getApiBaseUrl()) {
  content.innerHTML = header('Workspace unavailable', 'The same-origin /api route is not configured for this IAP deployment.');
}
workspaceData.then(async (value) => {
  const { sharedEdits: savedEdits = {}, ...workspace } = value;
  sharedEdits = savedEdits;
  for (const [key, edit] of Object.entries(sharedEdits)) sharedEditVersions[key] = edit.version;
  Object.assign(state, workspace);
  if (liveSheetsMode) {
    localLiveSheetsReady = true;
    const sidebarUpdate = document.querySelector('#liveSheetsUpdate');
    sidebarUpdate.hidden = false;
    sidebarUpdate.textContent = 'Google Sheet: live';
    liveSheetsStatus = { message: 'Roster and lesson progress loaded from Google Sheets.', details: null };
  }
  if (localWorkspaceAllowed) window.ICCLocalPathways.validateRobotReviews(state.robotPathwayReviews, state.robotProgressReviews);
  window.__ICC_LOCAL_STATE__ = { ...state };
  services = window.createServices();
  const savedStudents = load('robot-students', []);
  if (localWorkspaceAllowed) state.robotStudents = window.ICCLocalLiveSheets.preserveIncludedRobotStudents(state.robotStudents, savedStudents);
  else if (liveSheetsMode && savedStudents.length) state.robotStudents = mergeSharedStudentEdits(state.robotStudents, savedStudents);
  const savedCodingStudents = load('coding-students', []);
  if (savedCodingStudents.length) state.codingStudents = liveSheetsMode
    ? mergeSharedStudentEdits(state.codingStudents, savedCodingStudents) : savedCodingStudents;
  const savedMathStudents = load('math-students', []);
  if (savedMathStudents.length) state.mathStudents = liveSheetsMode
    ? mergeSharedStudentEdits(state.mathStudents, savedMathStudents) : savedMathStudents;
  const savedLessons = load('robot-lessons', []);
  if (!liveSheetsMode && savedLessons.length) state.robotLessons = savedLessons;
  const savedCodingLessons = load('coding-lessons', []);
  if (!liveSheetsMode && savedCodingLessons.length) state.codingLessons = savedCodingLessons;
  const savedMathLessons = load('math-lessons', []);
  if (!liveSheetsMode && savedMathLessons.length) state.mathLessons = savedMathLessons;
  const savedItems = load('component-items', []);
  const savedByKey = new Map(savedItems.map((row) => [`${row.student}:${row.item}`, row]));
  if (localWorkspaceAllowed && state.localBorrowingResetVersion) {
    const resetKey = 'icc-local-borrowing-reset-version';
    if (localStorage.getItem(resetKey) !== state.localBorrowingResetVersion) {
      localStorage.removeItem('icc-borrowings');
      localStorage.setItem(resetKey, state.localBorrowingResetVersion);
    }
    const savedBorrowings = load('borrowings', null);
    if (Array.isArray(savedBorrowings)) state.borrowings = savedBorrowings;
  }
  state.componentItems = state.componentItems.map((row) => { const saved = savedByKey.get(`${row.student}:${row.item}`); return saved ? { ...row, studentQty: saved.studentQty, quantityStatus: quantityResult(row.requiredQty, saved.studentQty), sourceRow: { ...row.sourceRow, Notes: saved.sourceRow?.Notes || row.sourceRow?.Notes || '' } } : row; });
  const savedInventory = localWorkspaceAllowed ? load('inventory', []) : []; const savedInventoryByKey = new Map(savedInventory.map((row) => [`${row.Kit}:${row.Component}`, row]));
  state.inventory = state.inventory.map((row) => { const saved = savedInventoryByKey.get(`${row.Kit}:${row.Component}`); return saved ? { ...row, 'Total center qty': saved['Total center qty'], 'Last counted': saved['Last counted'] || row['Last counted'], Notes: saved.Notes || row.Notes } : row; });
  const savedProgress = load('robot-progress', []);
  if (savedProgress.length && (!liveSheetsMode || localWorkspaceAllowed)) state.robotProgress = savedProgress;
  if (localWorkspaceAllowed) state.robotProgress = window.ICCLocalPathways.applyRobotProgressRemovals(state.robotProgress, state.localRobotProgressRemovals, localStorage);
  state.starterProgress = load('starter-progress', []);
  progressFinishDates = load('progress-finish-dates', {});
  if (localWorkspaceAllowed && (!localDemoEnabled || localDemoSignedIn)) {
    repairStudentLinks();
    localStorage.setItem(localWorkspaceDataVersionKey, 'james-paid-v1');
  }
  if (localLiveSheetsEnabled && (!localDemoEnabled || localDemoSignedIn)) {
    const sidebarUpdate = document.querySelector('#liveSheetsUpdate');
    sidebarUpdate.hidden = false;
    sidebarUpdate.textContent = 'Google Sheet: loading…';
    liveSheetsStatus = { message: 'Loading live data…', details: null };
    try {
      const response = await fetch('./secrets/local-sheets.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Local Sheet configuration is unavailable.');
      const config = await response.json();
      const sheets = await window.ICCLocalLiveSheets.read(config.spreadsheetId);
      const { warnings, warningDetails, ...liveData } = window.ICCLocalLiveSheets.merge(state, sheets, {
        includeRobotProgressUpdate: (student, row) => !window.ICCLocalPathways.afterPathwayChange(lessonDateKey(row.Date), pathwayFor(student, 'Robot')),
        robotProgrammeForStudent: (student) => studentProgramme(student),
        lessonDate: (row) => lessonDateKey(row.Date),
        reviewMatchesCurrentRobot: (student, review) => programmeTemplate(student).robotSequence.filter((row) =>
          window.ICCLocalPathways.robotNameKey(row['Robot name'], studentProgramme(student))
            === window.ICCLocalPathways.robotNameKey(review.robot, studentProgramme(student))).length === 1,
      });
      Object.assign(state, liveData);
      localLiveSheetsReady = true;
      const updatedAt = new Date().toLocaleTimeString();
      sidebarUpdate.textContent = `Google Sheet: updated ${updatedAt}`;
      liveSheetsStatus = { message: `Updated ${updatedAt}. Students shown but not in local roster: ${warnings.unmatchedStudents}; unmatched lessons: ${warnings.unmatchedLogs}; unmatched robot updates: ${warnings.unmatchedRobots}. Reload to refresh.`, details: warningDetails };
    } catch (error) {
      console.error('Live Sheet refresh failed:', error);
      sidebarUpdate.textContent = 'Google Sheet: refresh failed';
      liveSheetsStatus = { message: `Could not refresh; showing local data, which may be outdated. ${error.message}`, details: null };
    }
  }
  if (calendarEnabled && (!localDemoEnabled || localDemoSignedIn)) await refreshLocalCalendar();
  window.__ICC_LOCAL_STATE__ = { ...state };
  services.LibraryService.hydrateFromState(state);
  services.InventoryService.hydrateFromState(state);
  services.BorrowingService.hydrateFromState(state);
  const hasApi = Boolean(getApiBaseUrl() && (getAccessToken() || iapAuthEnabled));
  if (!hasApi) { render(); return null; }
  return services.load().catch((error) => {
    console.error('Unable to refresh workspace services:', error);
    setSaveStatus(`Some workspace data could not refresh: ${error.message}`, true);
    services.LibraryService.hydrateFromState(state);
    services.InventoryService.hydrateFromState(state);
    services.BorrowingService.hydrateFromState(state);
  });
}).then(() => { if (applyStatusTestRoute()) return; render(); }).catch((error) => { console.error('Unable to load workspace data:', error); if (localWorkspaceAllowed) { renderDataLoadError(error); return; } content.innerHTML = header('Workspace unavailable', 'The protected backend data could not be loaded. Please try again later or contact the workspace administrator.'); });
