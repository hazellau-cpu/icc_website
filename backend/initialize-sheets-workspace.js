const fs = require('node:fs');
const { extractLibraries } = require('./export-libraries');
const { createSheetsWorkspaceStore } = require('./sheets-workspace-store');

async function main() {
  const [spreadsheetId, libraryFile] = process.argv.slice(2);
  if (!spreadsheetId || !libraryFile || process.argv.length !== 4) {
    throw new Error('Usage: node backend/initialize-sheets-workspace.js DASHBOARD_SPREADSHEET_ID LIBRARY_JSON');
  }
  const libraries = extractLibraries(JSON.parse(fs.readFileSync(libraryFile, 'utf8')));
  const store = createSheetsWorkspaceStore({ spreadsheetId });
  await store.initialize(libraries);
  console.log('Dashboard Sheets initialized.');
}

main().catch((error) => {
  console.error(`Dashboard Sheets initialization failed: ${error.message}`);
  process.exitCode = 1;
});
