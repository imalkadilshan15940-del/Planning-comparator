// ui/shell.js

const NAV_ITEMS = [
  { hash: '#/reports', label: 'Reports', icon: '&#128196;' },
  { hash: '#/dashboard', label: 'Dashboard', icon: '&#128202;' },
  { hash: '#/all-styles', label: 'All Styles', icon: '&#128203;' },
  { hash: '#/changed-styles', label: 'Changed Styles', icon: '&#9888;' },
  { hash: '#/changed-style-history', label: 'Changed Style History', icon: '&#128193;' },
  { hash: '#/settings', label: 'Settings', icon: '&#9881;' },
];

export function renderShell() {
  document.getElementById('app-root').innerHTML = `
    <div class="shell">
      <nav class="sidebar">
        <div class="brand-row">
          <img src="assets/logo.png" alt="Star Garments" class="brand-logo">
          <span class="brand-title-text">Planning Comparator</span>
        </div>
        <button class="fetch-btn" id="fetch-documents-btn">⟳ Fetch Documents</button>
        <div class="nav-links" id="nav-links">
          ${NAV_ITEMS.map((n) => `<a href="${n.hash}" data-hash="${n.hash}">${n.label}</a>`).join('')}
        </div>
        <div class="folder-status" id="folder-status">Checking folder access…</div>
        <div class="data-status-row" id="data-availability-status"></div>
        <a href="#/help" class="help-link" id="help-nav-link">&#10067; Guide &amp; Features</a>
        <div class="sidebar-footer">
          <img src="assets/logo.png" alt="Star Garments" class="sidebar-logo">
          <span>Central IE tool</span>
        </div>
      </nav>
      <main class="content" id="app-content"></main>
    </div>
    <div class="zoom-bar">
      <span>Zoom</span>
      <input type="range" id="zoom-slider" min="60" max="150" step="5" value="100">
      <span class="zoom-value" id="zoom-value">100%</span>
      <button class="zoom-reset" id="zoom-reset">Reset</button>
      <div class="h-scroll-control" id="h-scroll-control" style="display:none;">
        <span>◀</span>
        <div class="h-scroll-track" id="h-scroll-track"><div class="h-scroll-thumb" id="h-scroll-thumb"></div></div>
        <span>▶</span>
      </div>
    </div>
    <div class="fetch-overlay" id="fetch-overlay">
      <div class="spin"></div>
      <div class="msg" id="fetch-overlay-msg">Checking for new documents…</div>
      <div class="sub">This usually takes a few seconds</div>
    </div>
  `;
}

export function applyFontSettings(fontSettings) {
  if (!fontSettings) return;
  const root = document.documentElement.style;
  const set = (key, group) => {
    if (fontSettings[group]) {
      root.setProperty(`--font-${key}`, fontSettings[group].family);
      root.setProperty(`--font-${key}-size`, `${fontSettings[group].size}px`);
    }
  };
  set('title', 'title');
  set('header', 'header');
  set('sidebar', 'sidebar');
  set('data', 'data');
}

export function initZoomBar(onChange) {
  const slider = document.getElementById('zoom-slider');
  const value = document.getElementById('zoom-value');
  const reset = document.getElementById('zoom-reset');
  const target = () => document.querySelector('.shell');
  const apply = (level) => {
    const el = target();
    if (el) el.style.zoom = `${level}%`;
    value.textContent = `${level}%`;
    slider.value = level;
  };
  slider.addEventListener('input', () => {
    apply(Number(slider.value));
    onChange(Number(slider.value));
  });
  reset.addEventListener('click', () => {
    apply(100);
    onChange(100);
  });
  return apply;
}

export function initHorizontalScrollSync() {
  const control = document.getElementById('h-scroll-control');
  const track = document.getElementById('h-scroll-track');
  const thumb = document.getElementById('h-scroll-thumb');
  const content = document.getElementById('app-content');
  if (!control || !track || !thumb || !content) return;

  let wraps = [];
  let maxScrollable = 0; // max(scrollWidth - clientWidth) across tracked wraps
  let syncing = false; // guard against feedback loops between drag-sync and scroll-sync

  function rescan() {
    wraps = [...content.querySelectorAll('.table-wrap')];
    maxScrollable = Math.max(0, ...wraps.map((w) => w.scrollWidth - w.clientWidth));
    if (wraps.length === 0) {
      control.style.display = 'none';
      return;
    }
    control.style.display = 'flex';
    const trackWidth = track.clientWidth;
    const widestWrap = wraps.reduce((a, b) => (b.scrollWidth > a.scrollWidth ? b : a), wraps[0]);
    // Even with nothing to scroll, the thumb still fills the track fully
    // rather than being nonsensically wide — this keeps the bar visually
    // present and correct-looking, just not draggable, when there's no
    // overflow yet.
    const thumbWidth = maxScrollable <= 4
      ? trackWidth - 2
      : Math.max(30, Math.min(trackWidth - 4, (widestWrap.clientWidth / widestWrap.scrollWidth) * trackWidth));
    thumb.style.width = `${thumbWidth}px`;
    updateThumbFromScroll();
  }

  function updateThumbFromScroll() {
    if (maxScrollable <= 0 || wraps.length === 0) return;
    const current = wraps[0].scrollLeft;
    const ratio = Math.max(0, Math.min(1, current / maxScrollable));
    const trackWidth = track.clientWidth;
    const thumbWidth = thumb.offsetWidth;
    thumb.style.left = `${1 + ratio * (trackWidth - thumbWidth - 2)}px`;
  }

  function applyScrollFromThumbPosition(thumbLeftPx) {
    const trackWidth = track.clientWidth;
    const thumbWidth = thumb.offsetWidth;
    const ratio = Math.max(0, Math.min(1, thumbLeftPx / (trackWidth - thumbWidth - 2)));
    syncing = true;
    for (const w of wraps) w.scrollLeft = ratio * (w.scrollWidth - w.clientWidth);
    syncing = false;
    thumb.style.left = `${1 + ratio * (trackWidth - thumbWidth - 2)}px`;
  }

  // Drag the thumb directly.
  let dragStartX = 0, dragStartLeft = 0, dragging = false;
  thumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    dragStartX = e.clientX;
    dragStartLeft = parseFloat(thumb.style.left) || 0;
    document.body.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    applyScrollFromThumbPosition(dragStartLeft + (e.clientX - dragStartX));
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });

  // Click anywhere on the track to jump there.
  track.addEventListener('click', (e) => {
    if (e.target === thumb) return;
    const rect = track.getBoundingClientRect();
    applyScrollFromThumbPosition(e.clientX - rect.left - thumb.offsetWidth / 2);
  });

  // Trackpad/shift-wheel scroll directly on a table stays fully functional
  // (the native scrollbar is just visually hidden) — reflect it back onto
  // the relocated thumb so the two never disagree.
  content.addEventListener('scroll', (e) => {
    if (syncing || !e.target.classList || !e.target.classList.contains('table-wrap')) return;
    if (e.target !== wraps[0]) return; // wraps[0] is the sync leader
    updateThumbFromScroll();
  }, true);

  // Re-scan whenever the page's content changes shape (route change, table
  // re-render, filter/sort, column show/hide, resize, reorder...) — this is
  // what lets every page "just work" without each render function needing
  // to remember to call something.
  const observer = new MutationObserver(() => {
    clearTimeout(observer._t);
    observer._t = setTimeout(rescan, 120);
  });
  observer.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('resize', rescan);

  rescan();
}

export function showFetchOverlay(message) {
  const overlay = document.getElementById('fetch-overlay');
  if (!overlay) return;
  document.getElementById('fetch-overlay-msg').textContent = message || 'Checking for new documents…';
  overlay.classList.add('active');
}

export function hideFetchOverlay() {
  document.getElementById('fetch-overlay')?.classList.remove('active');
}

let _loadingShowTimer = null;
let _loadingDepth = 0; // supports nested/overlapping calls without one hiding the other's spinner early

/**
 * Shows the loading overlay. By default there's a short delay before it
 * actually appears, to avoid a flash for operations that finish almost
 * instantly (typing in a search box, a quick filter). Pass immediate:true
 * for anything the user should see feedback for right away — most
 * importantly page navigation, since large datasets can block the main
 * thread long enough that a delayed show would never even get painted.
 */
export function showLoading(message = 'Loading…', { delayMs = 200, immediate = false } = {}) {
  _loadingDepth++;
  clearTimeout(_loadingShowTimer);
  if (immediate) {
    showFetchOverlay(message);
  } else {
    _loadingShowTimer = setTimeout(() => {
      if (_loadingDepth > 0) showFetchOverlay(message);
    }, delayMs);
  }
}

export function hideLoading() {
  _loadingDepth = Math.max(0, _loadingDepth - 1);
  if (_loadingDepth === 0) {
    clearTimeout(_loadingShowTimer);
    hideFetchOverlay();
  }
}

/**
 * Yields to the browser for one paint frame. JS execution blocks painting,
 * so simply calling showLoading() and then immediately starting expensive
 * synchronous work (building thousands of table rows) can mean the overlay
 * is *told* to show but never actually gets drawn on screen before the
 * heavy work starts. Awaiting this after showLoading() guarantees the
 * overlay is genuinely visible first.
 */
export function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** Wraps an async function/promise with showLoading/hideLoading automatically, even if it throws. */
export async function withLoading(promiseOrFn, message) {
  showLoading(message);
  try {
    return typeof promiseOrFn === 'function' ? await promiseOrFn() : await promiseOrFn;
  } finally {
    hideLoading();
  }
}

export function showConfirmDialog({ title, message, yesLabel = 'Yes', noLabel = 'No' }, onYes, onNo) {
  const existing = document.getElementById('confirm-dialog-modal');
  if (existing) existing.remove();

  const modal = el(`
    <div class="modal-overlay" id="confirm-dialog-modal">
      <div class="modal-box" style="max-width:460px;">
        <h3 style="margin-bottom:8px;">${title}</h3>
        <p style="color:var(--slate); font-size:13.5px; margin-bottom:18px; white-space:pre-line;">${message}</p>
        <div class="btn-row" style="justify-content:flex-end;">
          <button class="btn" id="confirm-no">${noLabel}</button>
          <button class="btn btn-primary" id="confirm-yes">${yesLabel}</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#confirm-yes').addEventListener('click', () => { close(); onYes?.(); });
  modal.querySelector('#confirm-no').addEventListener('click', () => { close(); onNo?.(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) { close(); onNo?.(); } });
}

export function showFailedMatchPopup(failedStyles, onExport, options = {}) {
  const existing = document.getElementById('failed-match-modal');
  if (existing) existing.remove();

  const title = options.title || `Delivery Date: ${failedStyles.length} style${failedStyles.length === 1 ? '' : 's'} not matched`;
  const description = options.description || "These styles didn't find a match in your delivery corrections file (or none is loaded) — they're still showing the original PDF-extracted Delivery Date, marked orange.";

  const modal = el(`
    <div class="modal-overlay" id="failed-match-modal">
      <div class="modal-box">
        <h3 style="margin-bottom:8px;">${title}</h3>
        <p style="color:var(--slate); font-size:13px; margin-bottom:12px;">
          ${description}
        </p>
        <div class="modal-list">
          ${failedStyles.slice(0, 30).map((s) => `<div class="modal-list-row"><span class="mono">${s.styleNo}</span><span>${s.factoryLine}</span></div>`).join('')}
          ${failedStyles.length > 30 ? `<div style="padding:8px; color:var(--slate); font-size:12px;">…and ${failedStyles.length - 30} more. Export the full list below.</div>` : ''}
        </div>
        <div class="btn-row" style="margin-top:14px; justify-content:flex-end;">
          <button class="btn" id="failed-match-export">Export Failed List (CSV)</button>
          <button class="btn btn-primary" id="failed-match-close">Close</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(modal);
  modal.querySelector('#failed-match-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#failed-match-export').addEventListener('click', () => onExport(failedStyles));
}

export function highlightActiveNav(currentHash) {
  document.querySelectorAll('#nav-links a').forEach((a) => {
    const base = a.dataset.hash;
    a.classList.toggle('active', currentHash.startsWith(base));
  });
  document.getElementById('help-nav-link')?.classList.toggle('active', currentHash.startsWith('#/help'));
}

export function updateFolderStatus({ connected, folderName, watching }) {
  const el = document.getElementById('folder-status');
  if (!el) return;
  if (!connected) {
    el.innerHTML = `<div class="fs-row"><span class="dot-status dot-red"></span><b>No folder connected</b></div><div class="fs-sub">Go to Settings to connect</div>`;
  } else if (watching) {
    el.innerHTML = `<div class="fs-row"><span class="dot-status dot-green"></span><b>${folderName}</b></div><div class="fs-sub">Watching for new PDFs…</div>`;
  } else {
    el.innerHTML = `<div class="fs-row"><span class="dot-status dot-amber"></span><b>${folderName}</b></div><div class="fs-sub">Re-grant permission (Settings)</div>`;
  }
}

/**
 * Small sidebar indicators showing whether the Delivery Corrections file
 * and the Special Operations master data have ever been uploaded — the
 * same small-dot pattern as the folder connection status above, so a
 * glance at the sidebar answers "is this set up yet" for both.
 */
export function updateDataAvailabilityStatus({ deliveryCorrectionsCount, masterDataCount }) {
  const el = document.getElementById('data-availability-status');
  if (!el) return;
  const row = (label, count) => `
    <div class="fs-row" style="font-size:11px;">
      <span class="dot-status ${count > 0 ? 'dot-green' : 'dot-red'}"></span>
      <span>${label}${count > 0 ? ` (${count})` : ' — not uploaded'}</span>
    </div>`;
  el.innerHTML = row('Delivery Corrections', deliveryCorrectionsCount) + row('Wash Master Data', masterDataCount);
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

export function fmtDate(str) {
  return str || '—';
}

export function severityBadge(label, priority) {
  const colorByPriority = { 1: 'var(--critical)', 2: '#7A1F2B', 3: 'var(--warning)', 4: 'var(--brand-blue)', 5: '#6B3391' };
  const color = colorByPriority[priority] || 'var(--slate-soft)';
  return `<span class="badge" style="background:${color};">${label}</span>`;
}

export function toast(message, kind = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;gap:8px;z-index:1000;';
    document.body.appendChild(container);
  }
  const colors = { info: 'var(--brand-blue)', success: 'var(--success)', error: 'var(--critical)' };
  const node = el(`<div style="background:${colors[kind] || colors.info};color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 8px 20px rgba(0,0,0,.2);max-width:340px;">${message}</div>`);
  container.appendChild(node);
  setTimeout(() => node.remove(), 5000);
}
