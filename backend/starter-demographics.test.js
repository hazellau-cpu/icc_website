const test = require('node:test');
const assert = require('node:assert/strict');
const { readStarterDemographics } = require('./starter-demographics');
const { applyStarterBirthYears } = require('../local-live-sheets');

function reader(tabs) {
  return readStarterDemographics({
    spreadsheetId: 'test-sheet',
    getAccessToken: async () => 'test-token',
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (String(url).includes('values:batchGet')) {
        const ranges = new URL(url).searchParams.getAll('ranges');
        return { ok: true, json: async () => ({ valueRanges: ranges.map((range) => {
          const tab = tabs.find((entry) => range === `'${entry.name.replace(/'/g, "''")}'!A3:E`);
          assert.ok(tab, `Unexpected range: ${range}`);
          return { values: tab.rows };
        }) }) };
      }
      return { ok: true, json: async () => ({ sheets: tabs.map((tab) => ({ properties: { title: tab.name } })) }) };
    },
  });
}

const header = ['Student ID (James)', 'Student Name', 'Robot', 'Status', 'Year of Birth'];

test('reads birth years by Sheet ID and applies them without replacing other students', async () => {
  const records = await reader([
    { name: 'First', rows: [header, ['ST1', 'A', '', '', '2020'], ['ST2', 'B']] },
    { name: 'Second', rows: [header, ['ST1', 'A', '', '', '2020'], ['ST3', 'C', '', '', '2019']] },
  ]);
  const original = [{ jamesStudentId: 'st1', name: 'A' }, { jamesStudentId: 'ST2', name: 'B' }];
  const result = applyStarterBirthYears(original, records);
  assert.deepEqual(result, { students: [{ ...original[0], yob: '2020' }, original[1]], unmatched: 1 });
  assert.equal(original[0].yob, undefined);
});

test('ignores dashboard storage tabs while retaining starter demographics', async () => {
  assert.deepEqual(await reader([
    { name: 'First', rows: [header, ['ST1', 'A', '', '', '2020']] },
    { name: 'Dashboard Library', rows: [['Collection', 'Record']] },
    { name: 'Dashboard State', rows: [['Key', 'Version']] },
  ]), [{ studentId: 'ST1', yearOfBirth: '2020' }]);
  await assert.rejects(reader([{ name: 'Dashboard Library', rows: [] }, { name: 'Dashboard State', rows: [] }]), /no student tabs/);
});

test('rejects invalid, conflicting, or unidentifiable birth years', async () => {
  await assert.rejects(reader([{ name: 'First', rows: [header, ['', '', '', '', '2020']] }]), /invalid student ID or year/);
  await assert.rejects(reader([{ name: 'First', rows: [header, ['ST1', '', '', '', 'twenty']] }]), /invalid student ID or year/);
  await assert.rejects(reader([{ name: 'First', rows: [header, ['ST1', '', '', '', '2020'], ['ST1', '', '', '', '2019']] }]), /conflicting/);
  await assert.rejects(reader([{ name: 'First', rows: [['Wrong']] }]), /missing.*header/);
  assert.throws(() => applyStarterBirthYears([{ jamesStudentId: 'ST1' }, { jamesStudentId: 'st1' }], [{ studentId: 'ST1', yearOfBirth: '2020' }]), /same Sheet student ID/);
});
