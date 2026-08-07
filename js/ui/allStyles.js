// ui/allStyles.js
// "All Styles" — every Style+Tracking No+Line record from every ingested
// PDF, shown together in one continuous list (no pagination). Calculation
// happens at Style+Tracking+Line level (not raw Cont/MRP detail) — the same
// level and the same comparison logic Changed Styles uses, so Status/Style
// Movement here always agree with what Changed Styles shows for the same
// document.

import { getAllStyleTrackingRecordsAcrossReports, getAllReports } from '../storage/snapshotRepo.js';
import { getDeliveryCorrectionsMeta } from '../storage/deliveryCorrectionsRepo.js';
import { showCommentHistoryModal } from './commentHistoryModal.js';
import { buildCommentEntriesIndex, getCutoffCommentCount } from '../storage/commentHistoryRepo.js';
import { el, showLoading, hideLoading, toast } from './shell.js';
import { clearReportDataCache, convertAllPdfsToJson } from '../storage/reportDataRepo.js';
import { downloadCsv } from '../export/csvExport.js';
import { makeTableResizable } from './resizableTable.js';
import { parsePrintedDate, formatDateShort } from '../shared/dateUtils.js';
import { renderDelDateSwitchHtml, wireDelDateSwitch } from '../shared/delDateSwitch.js';
import { showFactoryLineMovementChart } from './factoryLineMovementModal.js';
import { loadSettings, saveSettings } from '../settings/settingsManager.js';
import { rowMatchesQuery } from '../shared/searchMatch.js';
import { applyColumnOrder, makeColumnsReorderable } from '../shared/columnOrder.js';
import { renderFilterRow, wireFilterRow, applyColumnFilters, hasActiveFilters, clearFilters } from '../shared/columnFilters.js';

const ALL_COLUMNS = [
  { key: 'reportFactory', label: 'Factory' },
  { key: 'reportPrintedDate', label: 'Printed' },
  { key: 'reportFilename', label: 'Source PDF' },
  { key: 'styleNo', label: 'Style No' },
  { key: 'acc', label: 'Acc' },
  { key: 'trackingNumber', label: 'Tracking' },
  { key: 'similarBody', label: 'Similar Body' },
  { key: 'factoryLine', label: 'Line' },
  { key: 'garmentType', label: 'Garment Type' },
  { key: 'washType', label: 'Wash Type' },
  { key: 'prdDys', label: 'PRD DYS' },
  { key: 'avgEffi', label: 'Avg Effi' },
  { key: 'tgtCut', label: 'TGT CUT', filterType: 'date' },
  { key: 'tgt', label: 'TRG/H' },
  { key: 'stDate', label: 'ST' },
  { key: 'fiDate', label: 'FI' },
  { key: 'delDate', label: 'Delivery' },
  { key: 'delDate2nd', label: '2nd Del' },
  { key: 'gapFiDel', label: 'GAP OF FI & DEL' },
  { key: 'planQtyTotal', label: 'Plan Qty', filterType: 'none' },
  { key: 'movementDaysPSD', label: 'CHE. DAYS-PSD' },
  { key: 'styleMovement', label: 'MOVEMENT' },
  { key: 'statusPSD', label: 'STATUS-PSD' },
  { key: 'statusDEL', label: 'STATUS-DEL' },
  { key: 'comment', label: 'Comments', filterType: 'none' },
];
const DATE_KEYS = new Set(['reportPrintedDate', 'stDate', 'fiDate', 'delDate', 'delDate2nd']);
const STATUS_FILTER_OPTIONS = ['ALL', 'UNCHANGED-PSD', 'CHANGED-FI/DEL', 'TIGH PRO-PSD', 'NEW', 'NOT PRE DATA'];
const STATUS_DEL_FILTER_OPTIONS = ['ALL', 'SAFE', 'CRITICAL-DEL'];
const WASH_FILTER_OPTIONS = ['ALL', 'Wash', 'Non Wash'];
const DEFAULT_HIDDEN = new Set(['reportFilename', 'acc', 'similarBody', 'prdDys', 'avgEffi', 'tgtCut', 'tgt', 'movementDaysPSD']);

let state = {
  search: '',
  factory: 'ALL',
  reportId: 'ALL',
  status: 'ALL',
  statusDel: 'ALL',
  washType: 'ALL',
  sortKey: 'reportPrintedDate',
  sortDir: 'asc', // oldest to newest by default
  hidden: new Set(DEFAULT_HIDDEN),
  columnWidths: {},
  columnFilters: {},
};
let statusColors = {
  'TIGH PRO-PSD': '#B03040',
  'CHANGED-FI/DEL': '#B8791A',
  'UNCHANGED-PSD': '#8494A2',
  'NOT PRE DATA': '#1E6690',
  'NEW': '#2E7D5B',
};
let statusDelColors = { 'SAFE': '#2E7D5B', 'CRITICAL-DEL': '#B03040' };
let effectiveColumns = ALL_COLUMNS;

export async function renderAllStyles(container) {
  // Search text and active filters reset on every fresh visit to this page
  // — otherwise a search from a previous visit silently keeps filtering
  // the data even though the (freshly-rendered) search box looks empty.
  // Column widths/order are display preferences and are NOT reset here.
  state.search = '';
  state.factory = 'ALL';
  state.reportId = 'ALL';
  state.status = 'ALL';
  state.statusDel = 'ALL';
  state.washType = 'ALL';
  clearFilters(state.columnFilters);

  const [dcMeta, settings] = await Promise.all([getDeliveryCorrectionsMeta(), loadSettings()]);
  if (Array.isArray(settings.allStylesHiddenColumns)) state.hidden = new Set(settings.allStylesHiddenColumns);
  if (dcMeta.count === 0) state.hidden.add('delDate2nd');
  else state.hidden.delete('delDate2nd');

  if (settings.statusColors) statusColors = { ...statusColors, ...settings.statusColors };
  if (settings.statusDelColors) statusDelColors = { ...statusDelColors, ...settings.statusDelColors };
  effectiveColumns = applyColumnOrder(ALL_COLUMNS, settings.allStylesColumnOrder);
  state.columnWidths = { ...(settings.allStylesColumnWidths || {}) };
  const lookback = settings.reportsLookback || { mode: 'count', count: 1 };
  const lookbackArg = lookback.mode === 'all' ? 'all' : (lookback.count || 1);

  const [rawRecords, reports] = await Promise.all([getAllStyleTrackingRecordsAcrossReports(lookbackArg), getAllReports()]);
  // Flatten the attached report object into the flat reportXxx fields the
  // rest of this view expects (filters, sorting, export).
  const records = rawRecords.map((r) => ({
    ...r,
    reportId: r.report?.id,
    reportFactory: r.report?.factory,
    reportPrintedDate: r.report?.printedDate || r.report?.ingestedAt,
    reportFilename: r.report?.filename,
  }));
  // All Styles shows one row per (style, report) — unlike Changed Styles,
  // which is always "current", a row here can represent an older report.
  // So comments here follow the same point-in-time rule as Changed Style
  // History: only what existed by that row's own report date, not the
  // complete unfiltered thread.
  const commentEntriesIndex = await buildCommentEntriesIndex();
  for (const r of records) {
    r.commentCount = getCutoffCommentCount(commentEntriesIndex, r.styleNo, r.trackingNumber, r.factoryLine, r.reportPrintedDate);
  }
  const factories = [...new Set(records.map((r) => r.reportFactory).filter(Boolean))].sort();

  container.innerHTML = `
    <div class="topbar">
      <h1>All Styles</h1>
      <div style="color:var(--slate); font-size:13px;">${records.length.toLocaleString()} records across ${reports.length} report${reports.length === 1 ? '' : 's'} &middot; matched at Style + Tracking + Line level</div>
    </div>

    <div style="margin-bottom:14px;">${renderDelDateSwitchHtml(settings.delDateCalcMode || 'loading')}</div>

    ${records.length === 0 ? `
      <div class="empty-state card"><h3>No data yet</h3><p>Connect a folder and ingest at least one PDF to see records here.</p></div>
    ` : `
      <div class="btn-row" style="margin-bottom:14px; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="btn-row" style="flex-wrap:wrap;">
          <div class="search-box" style="min-width:220px;"><input id="as-search" type="text" placeholder="Search style, tracking…" value="${state.search}"></div>
          <select id="as-factory" class="btn"><option value="ALL">All factories</option>${factories.map((f) => `<option value="${f}" ${state.factory === f ? 'selected' : ''}>${f}</option>`).join('')}</select>
          <select id="as-report" class="btn"><option value="ALL">All reports</option>${reports.map((r) => `<option value="${r.id}" ${String(state.reportId) === String(r.id) ? 'selected' : ''}>${r.factory || '—'} · ${r.filename}</option>`).join('')}</select>
          <select id="as-status" class="btn">${STATUS_FILTER_OPTIONS.map((s) => `<option value="${s}" ${state.status === s ? 'selected' : ''}>${s === 'ALL' ? 'All STATUS-PSD' : s}</option>`).join('')}</select>
          <select id="as-status-del" class="btn">${STATUS_DEL_FILTER_OPTIONS.map((s) => `<option value="${s}" ${state.statusDel === s ? 'selected' : ''}>${s === 'ALL' ? 'All STATUS-DEL' : s}</option>`).join('')}</select>
          <select id="as-wash-type" class="btn">${WASH_FILTER_OPTIONS.map((s) => `<option value="${s}" ${state.washType === s ? 'selected' : ''}>${s === 'ALL' ? 'All Wash Types' : s}</option>`).join('')}</select>
          <button class="btn" id="as-columns-toggle">Columns ▾</button>
          <button class="btn" id="as-clear-filters">Clear Filters</button>
        </div>
        <div class="btn-row">
          <span style="font-size:11.5px; color:var(--slate); align-self:center;">Drag a column edge to resize</span>
          <button class="btn" id="as-save-layout">Save Layout</button>
          <button class="btn" id="as-refresh">⟳ Refresh Data</button>
          <button class="btn" id="as-export">Export CSV</button>
        </div>
      </div>

      <div id="as-columns-panel" class="card" style="display:none; margin-bottom:14px;">
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px;">
          ${effectiveColumns.map((c) => `
            <label style="display:flex; align-items:center; gap:6px; font-size:12.5px;">
              <input type="checkbox" data-col="${c.key}" ${state.hidden.has(c.key) ? '' : 'checked'}> ${c.label}
            </label>
          `).join('')}
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead id="as-thead-wrap"></thead>
          <tbody id="as-tbody"></tbody>
        </table>
      </div>
      <div style="text-align:center; padding:14px; color:var(--slate); font-size:12px;" id="as-count"></div>
    `}
  `;

  if (records.length === 0) return;

  wireDelDateSwitch(container, () => renderAllStyles(container));

  let flmSearchDebounce = null;
  container.querySelector('#as-search').addEventListener('input', (e) => {
    state.search = e.target.value; renderTbodyOnly(container, records);
    clearTimeout(flmSearchDebounce);
    const term = e.target.value;
    flmSearchDebounce = setTimeout(() => showFactoryLineMovementChart(term), 650);
  });
  container.querySelector('#as-factory').addEventListener('change', (e) => {
    state.factory = e.target.value; renderTbodyOnly(container, records);
  });
  container.querySelector('#as-report').addEventListener('change', (e) => {
    state.reportId = e.target.value; renderTbodyOnly(container, records);
  });
  container.querySelector('#as-status').addEventListener('change', (e) => {
    state.status = e.target.value; renderTbodyOnly(container, records);
  });
  container.querySelector('#as-status-del').addEventListener('change', (e) => {
    state.statusDel = e.target.value; renderTbodyOnly(container, records);
  });
  container.querySelector('#as-wash-type').addEventListener('change', (e) => {
    state.washType = e.target.value; renderTbodyOnly(container, records);
  });
  container.querySelector('#as-columns-toggle').addEventListener('click', () => {
    const panel = container.querySelector('#as-columns-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  container.querySelector('#as-clear-filters').addEventListener('click', () => {
    clearFilters(state.columnFilters);
    renderTable(container, records);
  });
  container.querySelectorAll('#as-columns-panel input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.hidden.delete(cb.dataset.col); else state.hidden.add(cb.dataset.col);
      renderTable(container, records);
    });
  });
  container.querySelector('#as-export').addEventListener('click', () => {
    const filtered = filterAndSort(records);
    downloadCsv(toCsv(filtered), 'all-styles-export.csv');
  });

  container.querySelector('#as-save-layout').addEventListener('click', async () => {
    const s = await loadSettings();
    await saveSettings({
      ...s,
      allStylesColumnOrder: effectiveColumns.map((c) => c.key),
      allStylesColumnWidths: { ...state.columnWidths },
      allStylesHiddenColumns: [...state.hidden].filter((k) => k !== 'delDate2nd'), // that column's visibility is automatic, not a user preference to save
    });
    toast('Layout saved — column order, widths, and visibility will be remembered next time.', 'success');
  });

  container.querySelector('#as-refresh').addEventListener('click', async () => {
    showLoading('Refreshing — clearing cache, re-converting PDFs, fetching documents…');
    try {
      await clearReportDataCache();
      await convertAllPdfsToJson();
    } finally {
      hideLoading();
    }
    // Fetch Documents lives in app.js as a module-private function — this
    // triggers the same sidebar button's own handler rather than a direct
    // import, which would create a circular dependency (app.js already
    // imports renderAllStyles from this very file).
    document.getElementById('fetch-documents-btn')?.click();
  });

  container.querySelector('#as-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('.comment-icon-btn');
    if (!btn) return;
    const identity = {
      styleNo: btn.dataset.commentStyle,
      trackingNumber: btn.dataset.commentTracking,
      factoryLine: btn.dataset.commentLine,
    };
    showCommentHistoryModal(identity, async () => {
      const entriesIndex = await buildCommentEntriesIndex();
      for (const row of records) {
        if (row.styleNo === identity.styleNo && row.trackingNumber === identity.trackingNumber && row.factoryLine === identity.factoryLine) {
          row.commentCount = getCutoffCommentCount(entriesIndex, row.styleNo, row.trackingNumber, row.factoryLine, row.reportPrintedDate);
        }
      }
      renderTbodyOnly(container, records);
    }, { reportFilename: btn.dataset.reportFilename, reportPrintedDate: btn.dataset.reportPrintedDate, cutoffDate: btn.dataset.reportPrintedDate });
  });

  renderTable(container, records);
}

function compareValues(av, bv, isDate) {
  if (isDate) {
    const da = parsePrintedDate(av), db = parsePrintedDate(bv);
    if (!da && !db) return 0;
    if (!da) return -1;
    if (!db) return 1;
    return da.getTime() - db.getTime();
  }
  return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
}

function filterAndSort(records) {
  let rows = records;
  if (state.factory !== 'ALL') rows = rows.filter((r) => r.reportFactory === state.factory);
  if (state.reportId !== 'ALL') rows = rows.filter((r) => String(r.reportId) === String(state.reportId));
  if (state.status !== 'ALL') rows = rows.filter((r) => r.statusPSD === state.status);
  if (state.statusDel !== 'ALL') rows = rows.filter((r) => r.statusDEL === state.statusDel);
  if (state.washType !== 'ALL') rows = rows.filter((r) => r.washType === state.washType);
  if (state.search) {
    rows = rows.filter((r) => rowMatchesQuery(r, ['styleNo', 'displayStyleNo', 'trackingNumber'], state.search));
  }
  rows = applyColumnFilters(rows, state.columnFilters, ALL_COLUMNS);
  const isDate = DATE_KEYS.has(state.sortKey);
  rows = [...rows].sort((a, b) => {
    const cmp = compareValues(a[state.sortKey], b[state.sortKey], isDate);
    return state.sortDir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function toCsv(rows) {
  const cols = effectiveColumns.filter((c) => !state.hidden.has(c.key));
  const lines = [cols.map((c) => c.label).join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => {
      let raw;
      if (c.key === 'comment') raw = r.commentCount > 0 ? `${r.commentCount} comment${r.commentCount === 1 ? '' : 's'}` : '';
      else if (c.key === 'styleNo') raw = r.displayStyleNo || r.styleNo;
      else raw = DATE_KEYS.has(c.key) ? formatDateShort(r[c.key]) : r[c.key];
      const v = raw == null ? '' : String(raw);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','));
  }
  return lines.join('\n');
}

function statusBadge(label, colors) {
  const color = colors[label] || 'var(--slate-soft)';
  return `<span class="badge" style="background:${color};">${label}</span>`;
}

function renderTbodyOnly(container, allRecords) {
  const filtered = filterAndSort(allRecords);
  const cols = effectiveColumns.filter((c) => !state.hidden.has(c.key));

  const tbody = container.querySelector('#as-tbody');
  tbody.innerHTML = '';
  if (filtered.length === 0) {
    tbody.appendChild(el(`<tr><td colspan="${cols.length}" style="text-align:center; padding:30px; color:var(--slate);">No records match the current filters.</td></tr>`));
  } else {
    for (const r of filtered) {
      const rowClass = r.statusDEL === 'CRITICAL-DEL' ? 'row-critical' : '';
      tbody.appendChild(el(`<tr class="${rowClass}">${cols.map((c) => {
        if (c.key === 'styleNo') return `<td class="mono">${r.displayStyleNo || r.styleNo || '—'}</td>`;
        if (c.key === 'statusPSD') return `<td>${statusBadge(r.statusPSD, statusColors)}</td>`;
        if (c.key === 'statusDEL') return `<td>${r.statusDEL ? statusBadge(r.statusDEL, statusDelColors) : '<span style="color:var(--slate);">—</span>'}</td>`;
        if (c.key === 'washType') return `<td>${r.washType || '—'}</td>`;
        if (c.key === 'comment') {
          const count = r.commentCount || 0;
          const inner = count > 0
            ? `<span class="badge" style="background:var(--brand-blue);">💬 ${count}</span>`
            : `<span style="opacity:.35; font-size:15px;">💬</span>`;
          return `<td style="text-align:center;"><button type="button" class="comment-icon-btn" data-comment-style="${r.styleNo}" data-comment-tracking="${r.trackingNumber || ''}" data-comment-line="${r.factoryLine || ''}" data-report-filename="${(r.reportFilename || '').replace(/"/g, '&quot;')}" data-report-printed-date="${r.reportPrintedDate || ''}" title="${count > 0 ? `${count} comment${count === 1 ? '' : 's'} — click to view` : 'No comments yet — click to add'}" style="background:none; border:none; cursor:pointer; padding:2px 4px; line-height:1; color:var(--ink);">${inner}</button></td>`;
        }
        if (c.key === 'delDate2nd') { const eff = r.delDate2nd || r.delDate; const cls = r.delDate2nd ? 'delivery-corrected' : 'delivery-original'; return `<td class="mono ${cls}" title="${r.delDate2nd ? 'Revised — from the uploaded delivery date corrections file' : 'Not revised — showing the original PDF date (no correction on file for this row)'}">${eff ? formatDateShort(eff) : '—'}</td>`; }
        if (c.key === 'gapFiDel') return `<td class="mono" style="${r.gapFiDel != null && r.gapFiDel < 0 ? 'color:var(--critical); font-weight:700;' : ''}">${r.gapFiDel != null ? r.gapFiDel : '—'}</td>`;
        if (c.key === 'styleMovement') return `<td>${r.styleMovement || '—'}</td>`;
        if (c.key === 'movementDaysPSD') {
          const v = r.movementDaysPSD;
          const text = v == null ? '—' : (v > 0 ? `+${v}d` : `${v}d`);
          return `<td class="mono" style="${v > 0 ? 'color:var(--critical); font-weight:700;' : ''}">${text}</td>`;
        }
        if (c.key === 'planQtyTotal') return `<td class="mono">${r.planQtyTotal != null ? Math.round(r.planQtyTotal).toLocaleString() : '—'}</td>`;
        if (c.key === 'avgEffi') return `<td class="mono">${r.avgEffi != null ? `${r.avgEffi}%` : '—'}</td>`;
        if (c.key === 'tgt') return `<td class="mono">${r.tgt != null && r.tgt !== '' ? `${r.tgt}` : '—'}</td>`;
        if (c.key === 'prdDys') return `<td class="mono">${r.prdDys != null ? r.prdDys : '—'}</td>`;
        if (c.key === 'delDate') return `<td class="mono">${formatDateShort(r.delDate) ?? '—'}</td>`;
        if (c.key === 'delDate2nd') { const eff = r.delDate2nd || r.delDate; const cls = r.delDate2nd ? 'delivery-corrected' : 'delivery-original'; return `<td class="mono ${cls}" title="${r.delDate2nd ? 'Revised — from the uploaded delivery date corrections file' : 'Not revised — showing the original PDF date (no correction on file for this row)'}">${eff ? formatDateShort(eff) : '—'}</td>`; }
        const isMono = ['stDate', 'fiDate', 'delDate', 'styleNo', 'trackingNumber', 'acc', 'similarBody', 'tgtCut', 'tgt'].includes(c.key);
        if (DATE_KEYS.has(c.key)) return `<td class="${isMono ? 'mono' : ''}">${formatDateShort(r[c.key]) ?? '—'}</td>`;
        return `<td class="${isMono ? 'mono' : ''}">${r[c.key] ?? '—'}</td>`;
      }).join('')}</tr>`));
    }
  }

  container.querySelector('#as-count').textContent = `${filtered.length.toLocaleString()} record${filtered.length === 1 ? '' : 's'}`;

  // The comment-icon click listener lives on the persistent #as-tbody node
  // itself (attached once in renderAllStyles), so it's unaffected by this
  // function replacing the rows inside it.
}

function renderTable(container, allRecords) {
  const cols = effectiveColumns.filter((c) => !state.hidden.has(c.key));

  const theadWrap = container.querySelector('#as-thead-wrap');
  const headerRowHtml = `<tr id="as-thead">${cols.map((c) => `
    <th data-sort="${c.key}" data-col="${c.key}" style="cursor:pointer; user-select:none;">${c.label} ${state.sortKey === c.key ? (state.sortDir === 'asc' ? '↑' : '↓') : ''}</th>
  `).join('')}</tr>`;
  theadWrap.innerHTML = headerRowHtml + renderFilterRow(cols, state.columnFilters);

  const thead = theadWrap; // keep the variable name used just below
  thead.querySelectorAll('th').forEach((th) => {
    th.addEventListener('click', (e) => {
      if (e.target.classList.contains('col-resize-handle')) return;
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      renderTable(container, allRecords);
    });
  });

  // The filter row is built once here (structure only changes when columns
  // themselves change — reorder, show/hide, sort-click) — typing into it
  // only calls renderTbodyOnly below, never rebuilding this row itself, so
  // the input the user is actively typing into is never destroyed/recreated
  // and never loses focus mid-word.
  const filterRow = theadWrap.querySelector('.col-filter-row');
  wireFilterRow(filterRow, state.columnFilters, () => renderTbodyOnly(container, allRecords));

  renderTbodyOnly(container, allRecords);

  makeTableResizable(container.querySelector('table'), {
    widths: state.columnWidths,
    onResize: async (key, width) => {
      state.columnWidths[key] = width;
      const s = await loadSettings();
      await saveSettings({ ...s, allStylesColumnWidths: { ...(s.allStylesColumnWidths || {}), [key]: width } });
    },
  });
  makeColumnsReorderable(container.querySelector('table'), async (newVisibleOrder) => {
    // Walk the current full order; hidden columns stay exactly where they
    // were, visible columns get replaced in sequence by the freshly
    // dragged order.
    const oldOrder = effectiveColumns.map((c) => c.key);
    const visibleQueue = [...newVisibleOrder];
    const finalOrder = oldOrder.map((key) => (state.hidden.has(key) ? key : visibleQueue.shift()));

    effectiveColumns = applyColumnOrder(ALL_COLUMNS, finalOrder);
    const settings = await loadSettings();
    await saveSettings({ ...settings, allStylesColumnOrder: finalOrder });
    renderTable(container, allRecords);
  });
}
