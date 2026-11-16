/**
 * Presents dashboard library records as a table.
 * @customfunction
 */
function ICC_LIBRARY_VIEW(rows, collection) {
  if (!Array.isArray(rows) || !rows.length || rows[0][0] !== 'Collection' || rows[0][1] !== 'Record') {
    throw new Error('Dashboard Library has an invalid header');
  }
  const records = [];
  const fields = [];
  for (const row of rows.slice(1)) {
    if (!row[0] && !row[1]) continue;
    if (row[0] !== collection) continue;
    const record = JSON.parse(row[1]);
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('Invalid library record in ' + collection);
    }
    records.push(record);
    for (const field of Object.keys(record)) {
      if (!fields.includes(field)) fields.push(field);
    }
  }
  if (!records.length || !fields.length) throw new Error('No library records found for ' + collection);
  return [fields, ...records.map((record) => fields.map((field) => {
    const value = record[field];
    if (value == null) return '';
    if (typeof value === 'object') throw new Error('Unexpected nested library field: ' + field);
    return value;
  }))];
}

/**
 * Presents saved dashboard edits without changing their storage.
 * @customfunction
 */
function ICC_EDITS_VIEW(rows) {
  if (!Array.isArray(rows) || !rows.length || rows[0][0] !== 'Key'
      || rows[0][1] !== 'Version' || rows[0][2] !== 'Updated By') {
    throw new Error('Dashboard State has an invalid header');
  }
  const output = [['Area', 'Record', 'Field', 'Value']];
  const append = (area, record, field, value) => {
    const text = value == null ? '(null)' : String(value);
    for (let offset = 0; offset < Math.max(text.length, 1); offset += 40000) {
      if (output.length >= 10000) throw new Error('Readable edits exceed 9,999 rows');
      const start = offset > 0 && /[\uD800-\uDBFF]/.test(text[offset - 1])
        && /[\uDC00-\uDFFF]/.test(text[offset]) ? offset - 1 : offset;
      const end = /[\uD800-\uDBFF]/.test(text[offset + 39999])
        && /[\uDC00-\uDFFF]/.test(text[offset + 40000]) ? offset + 39999 : offset + 40000;
      output.push([area, record, offset ? field + ' (continued)' : field, text.slice(start, end)]);
    }
  };
  const flatten = (area, record, path, value) => {
    if (value === null || typeof value !== 'object') {
      append(area, record, path || 'Value', value);
      return;
    }
    const entries = Object.entries(value);
    if (!entries.length) {
      append(area, record, path || 'Value', Array.isArray(value) ? '(empty list)' : '(empty object)');
      return;
    }
    for (const [key, child] of entries) {
      flatten(area, record, path ? path + '.' + key : key, child);
    }
  };
  for (const row of rows.slice(1)) {
    if (!row[0] && row[1] === '') continue;
    const [area, version, actor, ...chunks] = row;
    if (!area || !Number.isSafeInteger(Number(version)) || Number(version) < 0 || version === '') {
      throw new Error('Invalid dashboard state row');
    }
    if (Number(version) === 0) {
      if (chunks.some(Boolean)) throw new Error('Unexpected data for ' + area);
      append(area, '', 'Status', 'No saved dashboard edits');
      continue;
    }
    if (!actor || !chunks.some(Boolean)) throw new Error('Missing saved data for ' + area);
    const value = JSON.parse(chunks.join(''));
    if (area === 'progress-finish-dates' ? !value || typeof value !== 'object' || Array.isArray(value) : !Array.isArray(value)) {
      throw new Error('Invalid saved data for ' + area);
    }
    append(area, '', 'Version', version);
    append(area, '', 'Updated by', actor);
    if (Array.isArray(value)) {
      if (!value.length) append(area, '', 'Status', '(empty list)');
      value.forEach((item, index) => flatten(area, index + 1, '', item));
    } else {
      flatten(area, '', '', value);
    }
  }
  return output;
}
