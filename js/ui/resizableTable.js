// ui/resizableTable.js
// Adds a drag handle to each <th> so columns can be resized freely (no
// minimum beyond a small usability floor, no maximum). Because table views
// rebuild their <thead>/<tbody> from scratch on every re-render (search,
// filter, sort...), a resize has to be persisted externally and reapplied
// every time — a plain inline-style width set once would otherwise be
// wiped out by the very next re-render.

function suppressNextClick(table) {
  const blocker = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  table.addEventListener('click', blocker, { capture: true, once: true });
}

/**
 * @param table       the <table> element to make resizable
 * @param widths      map of columnKey -> pixel width, persisted by the caller
 * @param onResize    (columnKey, newWidthPx) => void — caller stores this in `widths`
 * @param keyFor       (th) => columnKey, defaults to the th's data-col/data-sort attribute
 */
export function makeTableResizable(table, { widths = {}, onResize = () => {}, keyFor } = {}) {
  if (!table) return;
  const getKey = keyFor || ((th) => th.dataset.col || th.dataset.sort || th.textContent.trim());

  table.classList.add('resizable-table');
  const headers = table.querySelectorAll('thead th');

  headers.forEach((th) => {
    const key = getKey(th);

    // Reapply any previously-set width every render, so it survives rebuilds.
    if (widths[key]) {
      th.style.width = `${widths[key]}px`;
      th.style.minWidth = `${widths[key]}px`;
      th.style.maxWidth = `${widths[key]}px`;
    }

    if (th.querySelector('.col-resize-handle')) return;
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    th.appendChild(handle);

    let startX = 0, startWidth = 0, dragged = false;

    const onMouseMove = (e) => {
      dragged = true;
      const newWidth = Math.max(4, startWidth + (e.clientX - startX)); // 4px only guards against zero/negative width breaking layout math — not a meaningful restriction
      th.style.width = `${newWidth}px`;
      th.style.minWidth = `${newWidth}px`;
      th.style.maxWidth = `${newWidth}px`;
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      if (dragged) {
        onResize(key, th.offsetWidth);
        suppressNextClick(table); // stop the sort-toggle click that a mousedown+mouseup sequence would otherwise fire
      }
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startWidth = th.offsetWidth;
      dragged = false;
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}
