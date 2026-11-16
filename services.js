(() => {
  const list = (value, key) => Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : [];

  const normalizeProgrammes = (rows) => rows.map((row) => {
    if (typeof row === 'string') return row;
    const name = row.programme_name || row['programme_name'] || row.name || row.Program || row['Program name'] || row.programme_id || row['programme_id'];
    if (!name) return null;
    return { ...row, programme_name: name, 'Program name': name, Program: name };
  }).filter(Boolean);

  const normalizeCurriculum = (rows) => rows.map((row) => {
    if (!row || typeof row === 'string') return row;
    const programme = row['Program name'] || row.programme_name || row.programme_id || row['programme_id'] || 'Unknown';
    const level = row.Level ?? row.level ?? row['Level'] ?? row['level'] ?? '';
    const item = row.Item || row.item_name || row['item_name'] || row.Topic || row['Topic'] || 'Unknown';
    return { ...row, 'Program name': programme, 'Program': programme, 'Item': item, item, 'Level': level, level, 'Topic': row.Topic || row['Topic'] || item, topic: row.Topic || row['Topic'] || item };
  });

  const normalizeComponents = (rows) => rows.map((row) => {
    if (!row || typeof row === 'string') return row;
    const kit = row.Kit || row.kit_id || row['kit_id'] || row['Kit name'] || '';
    const component = row.Component || row['Component'] || row.item_name || row['item_name'] || row.Item || row['Item'] || '';
    const level = row.Level ?? row.level ?? row['Level'] ?? row['level'] ?? '';
    const normalized = { ...row, Kit: kit, 'Kit': kit, Component: component, 'Component': component, 'Item': component, item: component };
    if (level !== '' && level !== null && level !== undefined) normalized['Level'] = level;
    if (level !== '' && level !== null && level !== undefined) {
      const numericLevel = Number(level);
      if (Number.isFinite(numericLevel) && numericLevel > 0) normalized[`Lv${numericLevel}`] = normalized[`Lv${numericLevel}`] || 1;
    }
    return normalized;
  });

  const normalizeRobots = (rows) => rows.map((row) => {
    if (!row || typeof row === 'string') return row;
    const kit = row['Kit name'] || row.kit_id || row['kit_id'] || row.Kit || row['Kit'] || '';
    const robot = row['Robot name'] || row.item_name || row['item_name'] || row.Robot || row['Robot'] || '';
    return { ...row, 'Kit name': kit, 'Robot name': robot, Kit: kit, Robot: robot, 'Programme ID': row['Programme ID'] || row.programme_id || '', 'Programme Name': row['Programme Name'] || row.programme_name || '', Variant: row.Variant || row.variant || '' };
  });

  function createServices() {
    const request = (endpoint, method = 'GET', body) => window.apiRequest(endpoint, method, body);
    const cache = { programmes: [], curriculum: [], robots: [], components: [], inventory: [], borrowings: [] };

    const hydrateFromState = (state) => {
      cache.programmes = normalizeProgrammes(Array.isArray(state.robotPrograms) ? state.robotPrograms : []);
      cache.curriculum = normalizeCurriculum(Array.isArray(state.curriculum) ? state.curriculum : []);
      cache.robots = normalizeRobots(Array.isArray(state.robots) ? state.robots : []);
      cache.components = normalizeComponents(Array.isArray(state.componentLibrary) ? state.componentLibrary : []);
      cache.inventory = Array.isArray(state.centerInventory) ? state.centerInventory : (Array.isArray(state.inventory) ? state.inventory : []);
      cache.borrowings = Array.isArray(state.borrowings) ? state.borrowings : [];
    };

    const LibraryService = {
      hydrateFromState,
      async load() {
        try {
          const [programmes, curriculum, robots, components] = await Promise.all([request('/programmes'), request('/curriculum'), request('/robots'), request('/components')]);
          cache.programmes = normalizeProgrammes(list(programmes, 'programmes')); cache.curriculum = normalizeCurriculum(list(curriculum, 'curriculum')); cache.robots = normalizeRobots(list(robots, 'robots')); cache.components = normalizeComponents(list(components, 'components'));
        } catch (error) {
          if (window.__ICC_SHEETS_WORKSPACE__) throw error;
          hydrateFromState(window.__ICC_LOCAL_STATE__ || { robotPrograms: [], curriculum: [], robots: [], componentLibrary: [], inventory: [], borrowings: [] });
        }
      },
      getProgrammes() { return cache.programmes.map((row) => typeof row === 'string' ? row : row.programme_name || row.name || row.Program || row['Program name']).filter(Boolean); },
      getCurriculum() { return cache.curriculum; },
      getCurriculumByProgramme(id) { return cache.curriculum.filter((row) => String(row.programme_id || row['Program name'] || '').toLowerCase() === String(id || '').toLowerCase()); },
      getTopicByLevel(programmeId, level) { return this.getCurriculumByProgramme(programmeId).filter((row) => String(row.level ?? row.Level) === String(level)); },
      getRobotLibrary() { return cache.robots; },
      getComponentLibrary() { return cache.components; },
    };

    const InventoryService = {
      hydrateFromState: (state) => { cache.inventory = Array.isArray(state.centerInventory) ? state.centerInventory : (Array.isArray(state.inventory) ? state.inventory : []); },
      async load() {
        try {
          cache.inventory = list(await request('/centre-inventory'), 'items');
        } catch (error) {
          if (window.__ICC_SHEETS_WORKSPACE__) throw error;
          cache.inventory = Array.isArray(window.__ICC_LOCAL_STATE__?.centerInventory) ? window.__ICC_LOCAL_STATE__.centerInventory : [];
        }
      },
      getItems() { return cache.inventory; },
      getItemById(id) { return cache.inventory.find((item) => item.inventory_id === id || `${item.Kit}:${item.Component}` === id); },
      async createItem(item) { const created = await request('/centre-inventory', 'POST', item); cache.inventory.push(created); return created; },
      async updateItem(id, changes) { const item = this.getItemById(id); if (!item) return null; const updated = await request(`/centre-inventory/${encodeURIComponent(item.inventory_id || id)}`, 'PATCH', changes); Object.assign(item, updated); return item; },
      async deleteItem(id) { const item = this.getItemById(id); if (!item) return false; await request(`/centre-inventory/${encodeURIComponent(item.inventory_id || id)}`, 'DELETE'); cache.inventory = cache.inventory.filter((row) => row !== item); return true; },
    };

    const BorrowingService = {
      hydrateFromState: (state) => { cache.borrowings = Array.isArray(state.borrowings) ? state.borrowings : []; },
      async load() {
        try {
          cache.borrowings = list(await request('/borrowings'), 'borrowings');
        } catch (error) {
          if (window.__ICC_SHEETS_WORKSPACE__) throw error;
          cache.borrowings = Array.isArray(window.__ICC_LOCAL_STATE__?.borrowings) ? window.__ICC_LOCAL_STATE__.borrowings : [];
        }
      },
      getBorrowingLogs() { return cache.borrowings; },
      async createBorrowingLog(log) {
        try {
          const created = await request('/borrowings', 'POST', log);
          cache.borrowings.push(created);
          return created;
        } catch (error) {
          if (window.__ICC_SHEETS_WORKSPACE__) throw error;
          const created = { borrowing_id: `local-${Date.now()}`, borrower: log.borrower, item: log.item, quantity: log.sourceRow?.Quantity || log.quantity || 1, status: log.status || 'Still borrowing', sourceRow: log.sourceRow || {} };
          cache.borrowings.push(created);
          return created;
        }
      },
      async returnBorrowedItem(id, date) { const updated = await request(`/borrowings/${encodeURIComponent(id)}/return`, 'POST', date ? { returned_on: date } : undefined); const index = cache.borrowings.findIndex((row) => row.borrowing_id === id); if (index >= 0) cache.borrowings[index] = updated; return updated; },
      async getBorrowingHistory(studentId) { return list(await request(`/students/${encodeURIComponent(studentId)}/borrowings`), 'borrowings'); },
    };

    return { LibraryService, InventoryService, BorrowingService, async load() { await Promise.all([LibraryService.load(), InventoryService.load(), BorrowingService.load()]); } };
  }

  window.createServices = createServices;
})();
