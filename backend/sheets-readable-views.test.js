const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, 'sheets-readable-views.gs'), 'utf8');
const context = vm.createContext({});
vm.runInContext(script, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('library view presents all record fields as columns', () => {
  const rows = [
    ['Collection', 'Record'],
    ['robots', JSON.stringify({ Name: 'Robot', Level: 1 })],
    ['robots', JSON.stringify({ Name: 'Next', Variant: 'A' })],
    ['curriculum', '{}'],
    ['', ''],
  ];
  assert.deepEqual(plain(context.ICC_LIBRARY_VIEW(rows, 'robots')), [
    ['Name', 'Level', 'Variant'], ['Robot', 1, ''], ['Next', '', 'A'],
  ]);
  assert.throws(() => context.ICC_LIBRARY_VIEW(rows, 'missing'), /No library records/);
});

test('edits view distinguishes unsaved, empty and nested data', () => {
  const rows = [
    ['Key', 'Version', 'Updated By'],
    ['borrowings', 0, ''],
    ['student-pathways', 1, 'editor', JSON.stringify([{ name: 'Student', source: { level: 2 } }])],
    ['inventory', 2, 'editor', '[]'],
  ];
  assert.deepEqual(plain(context.ICC_EDITS_VIEW(rows)), [
    ['Area', 'Record', 'Field', 'Value'],
    ['borrowings', '', 'Status', 'No saved dashboard edits'],
    ['student-pathways', '', 'Version', '1'],
    ['student-pathways', '', 'Updated by', 'editor'],
    ['student-pathways', 1, 'name', 'Student'],
    ['student-pathways', 1, 'source.level', '2'],
    ['inventory', '', 'Version', '2'],
    ['inventory', '', 'Updated by', 'editor'],
    ['inventory', '', 'Status', '(empty list)'],
  ]);
});

test('edits view joins stored chunks and surfaces malformed data', () => {
  const header = ['Key', 'Version', 'Updated By'];
  assert.deepEqual(plain(context.ICC_EDITS_VIEW([header, ['borrowings', 1, 'editor', '[{"note":', '"ok"}]']])).slice(-1),
    [['borrowings', 1, 'note', 'ok']]);
  assert.throws(() => context.ICC_EDITS_VIEW([header, ['borrowings', 1, 'editor', 'not json']]));
  assert.throws(() => context.ICC_EDITS_VIEW([header, ['borrowings', 1, 'editor', '{}']]), /Invalid saved data/);
});

test('long text remains intact when an emoji crosses a display chunk boundary', () => {
  const text = `${'a'.repeat(39999)}😀b`;
  const rows = [['Key', 'Version', 'Updated By'], ['borrowings', 1, 'editor', JSON.stringify([{ text }])]];
  const result = plain(context.ICC_EDITS_VIEW(rows)).filter((row) => row[2].startsWith('text'));
  assert.equal(result.map((row) => row[3]).join(''), text);
  assert.equal(result.length, 2);
});
