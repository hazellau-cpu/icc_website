(() => {
  const list = (value, key) => Array.isArray(value) ? value : Array.isArray(value?.[key]) ? value[key] : [];

  function createServices() {
    const request = (endpoint, method = 'GET', body) => window.apiRequest(endpoint, method, body);
    const cache = { programmes: [], curriculum: [], robots: [], components: [], inventory: [], borrowings: [] };

    const LibraryService = {
      async load() {
        const [programmes, curriculum, robots, components] = await Promise.all([request('/programmes'), request('/curriculum'), request('/robots'), request('/components')]);
        cache.programmes = list(programmes, 'programmes'); cache.curriculum = list(curriculum, 'curriculum'); cache.robots = list(robots, 'robots'); cache.components = list(components, 'components');
      },
      getProgrammes() { return cache.programmes.map((row) => typeof row === 'string' ? row : row.programme_name || row.name || row.Program || row['Program name']).filter(Boolean); },
      getCurriculum() { return cache.curriculum; },
      getCurriculumByProgramme(id) { return cache.curriculum.filter((row) => String(row.programme_id || row['Program name'] || '').toLowerCase() === String(id || '').toLowerCase()); },
      getTopicByLevel(programmeId, level) { return this.getCurriculumByProgramme(programmeId).filter((row) => String(row.level ?? row.Level) === String(level)); },
      getRobotLibrary() { return cache.robots; },
      getComponentLibrary() { return cache.components; },
    };

    const InventoryService = {
      async load() { cache.inventory = list(await request('/centre-inventory'), 'items'); },
      getItems() { return cache.inventory; },
      getItemById(id) { return cache.inventory.find((item) => item.inventory_id === id || `${item.Kit}:${item.Component}` === id); },
      async createItem(item) { const created = await request('/centre-inventory', 'POST', item); cache.inventory.push(created); return created; },
      async updateItem(id, changes) { const item = this.getItemById(id); if (!item) return null; const updated = await request(`/centre-inventory/${encodeURIComponent(item.inventory_id || id)}`, 'PATCH', changes); Object.assign(item, updated); return item; },
      async deleteItem(id) { const item = this.getItemById(id); if (!item) return false; await request(`/centre-inventory/${encodeURIComponent(item.inventory_id || id)}`, 'DELETE'); cache.inventory = cache.inventory.filter((row) => row !== item); return true; },
    };

    const BorrowingService = {
      async load() { cache.borrowings = list(await request('/borrowings'), 'borrowings'); },
      getBorrowingLogs() { return cache.borrowings; },
      async createBorrowingLog(log) { const created = await request('/borrowings', 'POST', log); cache.borrowings.push(created); return created; },
      async returnBorrowedItem(id) { const updated = await request(`/borrowings/${encodeURIComponent(id)}/return`, 'POST'); const index = cache.borrowings.findIndex((row) => row.borrowing_id === id); if (index >= 0) cache.borrowings[index] = updated; return updated; },
      async getBorrowingHistory(studentId) { return list(await request(`/students/${encodeURIComponent(studentId)}/borrowings`), 'borrowings'); },
    };

    return { LibraryService, InventoryService, BorrowingService, async load() { await Promise.all([LibraryService.load(), InventoryService.load(), BorrowingService.load()]); } };
  }

  window.createServices = createServices;
})();
