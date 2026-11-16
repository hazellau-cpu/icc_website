const test = require('node:test');
const assert = require('node:assert/strict');
const { createSheetsWorkspaceStore, STATE_KEYS, STATE_HEADER, LIBRARY_KEYS, LIBRARY_HEADER, WorkspaceConflictError } = require('./sheets-workspace-store');

function fixture() {
  const sheets = {
    "'Dashboard Library'": [LIBRARY_HEADER, ...LIBRARY_KEYS.map((key) => [key, JSON.stringify({ item: key })])],
    "'Dashboard State'": [STATE_HEADER, ...STATE_KEYS.map((key) => [key, 0])],
  };
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/values:batchGet')) {
      return { ok: true, json: async () => ({ valueRanges: url.searchParams.getAll('ranges').map((range) => ({
        values: structuredClone(sheets[range.split('!')[0]]),
      })) }) };
    }
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      const rowNumber = Number(body.range.match(/A(\d+)/)[1]);
      sheets["'Dashboard State'"][rowNumber - 1] = body.values[0];
      return { ok: true, json: async () => ({}) };
    }
    if (url.pathname.endsWith('/values:batchUpdate')) {
      const body = JSON.parse(options.body);
      for (const entry of body.data) sheets[entry.range.split('!')[0]] = entry.values;
      return { ok: true, json: async () => ({}) };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const store = createSheetsWorkspaceStore({
    spreadsheetId: 'private-test',
    authClientProvider: async () => ({ getAccessToken: async () => 'test-token' }),
    fetchImpl,
  });
  return { store, sheets };
}

test('stores large edits across cells and detects stale writes', async () => {
  const { store } = fixture();
  const value = [{ text: `${'a'.repeat(39999)}😀${'b'.repeat(60000)}` }];
  assert.deepEqual(await store.update('robot-students', value, 0, 'editor@example.test'), { key: 'robot-students', version: 1 });
  const { edits, libraries } = await store.read();
  assert.deepEqual(edits['robot-students'], { value, version: 1 });
  assert.equal(libraries.robots.length, 1);
  await assert.rejects(store.update('robot-students', [], 0, 'editor@example.test'), WorkspaceConflictError);
});

test('serializes competing writes in the same instance', async () => {
  const { store } = fixture();
  const results = await Promise.allSettled([
    store.update('borrowings', [1], 0, 'editor@example.test'),
    store.update('borrowings', [2], 0, 'editor@example.test'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason instanceof WorkspaceConflictError).length, 1);
});

test('refuses to initialize non-empty dashboard tabs', async () => {
  const { store } = fixture();
  await assert.rejects(store.initialize(Object.fromEntries(LIBRARY_KEYS.map((key) => [key, [{}]]))), /must both be empty/);
});

test('fails explicitly when the stored state is malformed', async () => {
  const { store, sheets } = fixture();
  sheets["'Dashboard State'"][1] = [STATE_KEYS[0], 1, 'editor', '{invalid'];
  await assert.rejects(store.read(), /invalid JSON/);
});

test('rejects an empty version and missing middle chunks', async () => {
  const { store, sheets } = fixture();
  sheets["'Dashboard State'"][1] = [STATE_KEYS[0], ''];
  await assert.rejects(store.read(), /invalid row/);
  sheets["'Dashboard State'"][1] = [STATE_KEYS[0], 1, 'editor', '{"x":', '', '1}'];
  await assert.rejects(store.read(), /invalid data chunks/);
});

test('rejects malformed saved values rather than using empty defaults', async () => {
  const { store, sheets } = fixture();
  sheets["'Dashboard State'"][1] = [STATE_KEYS[0], 1, 'editor', 'null'];
  await assert.rejects(store.read(), /invalid value/);
});

test('initializes empty tabs and reads them back', async () => {
  const { store, sheets } = fixture();
  sheets["'Dashboard Library'"] = [];
  sheets["'Dashboard State'"] = [];
  const libraries = Object.fromEntries(LIBRARY_KEYS.map((key) => [key, [{ key }]]));
  await store.initialize(libraries);
  assert.deepEqual(await store.read(), { libraries, edits: {} });
});
