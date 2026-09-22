(() => {
  function createServices(getState) {
    const read = () => getState();
    const persist = (key, value) => localStorage.setItem(`icc-${key}`, JSON.stringify(value));

    const LibraryService = {
      getProgrammes() {
        return [...new Set(read().robotPrograms.map((row) => row.Program).filter(Boolean))].sort();
      },
      getCurriculumByProgramme(id) {
        const programme = String(id || '').toLowerCase();
        return read().curriculum.filter((row) => String(row['Program name'] || '').toLowerCase() === programme || String(row['Program name'] || '').toLowerCase().startsWith(programme));
      },
      getTopicByLevel(programmeId, level) {
        return this.getCurriculumByProgramme(programmeId).filter((row) => String(row.Level) === String(level));
      },
      getRobotLibrary() { return read().robots; },
      getComponentLibrary() { return read().componentLibrary; },
    };

    const InventoryService = {
      getItems() {
        const state = read();
        const keys = new Set(state.inventory.map((item) => `${item.Kit}:${item.Component}`));
        state.componentLibrary.forEach((item) => {
          const key = `${item.Kit}:${item.Component}`;
          if (!keys.has(key)) {
            state.inventory.push({ Component: item.Component, Kit: item.Kit, Category: item.Category || '', Colour: item.Colour || '', Tier: item.Tier || '', 'Total center qty': '0', 'Last counted': '', Notes: '', 'Unit Price': item['Unit Price'] || '' });
            keys.add(key);
          }
        });
        return state.inventory;
      },
      getItemById(id) { return this.getItems().find((item) => item.inventory_id === id || `${item.Kit}:${item.Component}` === id); },
      createItem(item) { const state = read(); state.inventory.push(item); persist('inventory', state.inventory); return item; },
      updateItem(id, changes) { const item = this.getItemById(id); if (!item) return null; Object.assign(item, changes); persist('inventory', read().inventory); return item; },
      deleteItem(id) { const state = read(); const index = state.inventory.findIndex((item) => item.inventory_id === id || `${item.Kit}:${item.Component}` === id); if (index < 0) return false; state.inventory.splice(index, 1); persist('inventory', state.inventory); return true; },
    };

    const BorrowingService = {
      getBorrowingLogs() { return read().borrowings; },
      createBorrowingLog(log) { const state = read(); state.borrowings.push(log); persist('borrowings', state.borrowings); return log; },
      returnBorrowedItem(id) { const log = read().borrowings.find((row, index) => row.borrowing_id === id || index === Number(id)); if (!log) return null; log.status = 'Returned'; if (log.sourceRow) log.sourceRow['Returned on'] = new Date().toISOString().slice(0, 10); persist('borrowings', read().borrowings); return log; },
      getBorrowingHistory(studentId) { return read().borrowings.filter((row) => row.borrower === studentId || row.sourceRow?.Student === studentId || row.student_id === studentId); },
    };

    return { LibraryService, InventoryService, BorrowingService };
  }

  window.createServices = createServices;
})();
