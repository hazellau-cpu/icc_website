const fs = require('node:fs');

const fields = {
  robotPrograms: ['programme_id', 'programme_name', 'programme_type', 'kit_id', 'level', 'Program name'],
  curriculum: ['item_id', 'programme_id', 'level', 'item_name', 'Program name', 'Program', 'Item', 'item', 'Level', 'Topic', 'topic'],
  robots: ['item_id', 'Robot name', 'Kit name', 'Level', 'Sequence', 'Programme ID', 'Programme Name', 'Variant'],
  componentLibrary: ['item_id', 'programme_id', 'programme_name', 'variant', 'kit_id', 'level', 'sequence', 'item_name', 'Kit', 'Component', 'Item', 'Tier', 'Unit Price', 'Level', 'Lv1', 'Lv2', 'Lv3', 'Lv4', 'Lv5', 'Lv6', 'kit_name'],
  inventory: ['Component ID', 'Kit', 'Component', 'Appears in', 'Unit Price', 'Tier', ...Array.from({ length: 8 }, (_, index) => `Lv${index + 1}`), ...Array.from({ length: 8 }, (_, index) => `Lv${index + 1} total`), 'Required Qty'],
};

function extractLibraries(workspace) {
  const libraries = {};
  for (const [collection, allowedFields] of Object.entries(fields)) {
    if (!Array.isArray(workspace[collection])) throw new Error(`Missing library collection: ${collection}`);
    libraries[collection] = workspace[collection].map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid ${collection} record at index ${index}`);
      const selected = {};
      for (const field of allowedFields) {
        if (!Object.hasOwn(row, field)) continue;
        const value = row[field];
        if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
          throw new Error(`Invalid ${collection} field ${field} at index ${index}`);
        }
        selected[field] = value;
      }
      return selected;
    });
  }
  return libraries;
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) {
    console.error('Usage: node backend/export-libraries.js INPUT_WORKSPACE_JSON OUTPUT_JSON');
    process.exitCode = 1;
  } else {
    try {
      const workspace = JSON.parse(fs.readFileSync(input, 'utf8'));
      fs.writeFileSync(output, `${JSON.stringify(extractLibraries(workspace), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      console.log('Library export created. Review its contents before sharing.');
    } catch (error) {
      console.error(`Library export failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { extractLibraries };
