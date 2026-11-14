const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const databasePath = path.join(root, 'workspace-db.json');
if (!fs.existsSync(databasePath)) throw new Error('Missing workspace-db.json');
const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
const requiredCollections = ['robotStudents', 'codingStudents', 'curriculum', 'robots', 'inventory', 'robotPrograms'];
for (const collection of requiredCollections) {
  if (!Array.isArray(database[collection]) || database[collection].length === 0) throw new Error(`Generated database is missing ${collection}`);
}
if (!Array.isArray(database.files) || database.files.length < 10) throw new Error('workspace-db.json is missing embedded source records.');

console.log(`Preflight passed: ${database.robotStudents.length} robot students, ${database.codingStudents.length} coding students, ${database.robots.length} robots, ${database.inventory.length} inventory rows.`);
