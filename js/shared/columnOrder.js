// shared/columnOrder.js
// Reorders a base column-definition array according to a persisted list of
// keys (from Settings), appending any columns not yet in that saved order
// (e.g. a newly-added column) at the end so nothing silently disappears.

export function applyColumnOrder(baseColumns, savedOrderKeys) {
  if (!savedOrderKeys || savedOrderKeys.length === 0) return baseColumns;
  const byKey = new Map(baseColumns.map((c) => [c.key, c]));
  const ordered = [];
  for (const key of savedOrderKeys) {
    const col = byKey.get(key);
    if (col) { ordered.push(col); byKey.delete(key); }
  }
  // Anything left in byKey wasn't in the saved order (new column since last
  // save) — append in original order.
  for (const col of baseColumns) {
    if (byKey.has(col.key)) ordered.push(col);
  }
  return ordered;
}

/**
 * Adds drag-and-drop column reordering to a table's header row.
 * @param table      the <table> element
 * @param onReorder  (newFullOrderKeys: string[]) => void — persist this
 */
export function makeColumnsReorderable(table, onReorder) {
  if (!table) return;
  const headers = [...table.querySelectorAll('thead th')];
  let draggedKey = null;

  headers.forEach((th) => {
    const key = th.dataset.col || th.dataset.sort;
    if (!key) return;
    th.draggable = true;
    th.style.cursor = th.style.cursor || 'grab';

    // The resize handle uses mousedown (not native drag) and already stops
    // its own propagation, but explicitly excluding it from participating
    // in native drag keeps the two interactions fully independent.
    const handle = th.querySelector('.col-resize-handle');
    if (handle) handle.draggable = false;

    th.addEventListener('dragstart', (e) => {
      draggedKey = key;
      e.dataTransfer.effectAllowed = 'move';
      th.classList.add('col-dragging');
    });
    th.addEventListener('dragend', () => {
      th.classList.remove('col-dragging');
      headers.forEach((h) => h.classList.remove('col-drop-target'));
    });
    th.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (key !== draggedKey) th.classList.add('col-drop-target');
    });
    th.addEventListener('dragleave', () => th.classList.remove('col-drop-target'));
    th.addEventListener('drop', (e) => {
      e.preventDefault();
      th.classList.remove('col-drop-target');
      if (!draggedKey || draggedKey === key) return;

      const currentKeys = headers.map((h) => h.dataset.col || h.dataset.sort).filter(Boolean);
      const fromIdx = currentKeys.indexOf(draggedKey);
      const toIdx = currentKeys.indexOf(key);
      if (fromIdx === -1 || toIdx === -1) return;
      currentKeys.splice(fromIdx, 1);
      currentKeys.splice(toIdx, 0, draggedKey);
      onReorder(currentKeys);
    });
  });
}
