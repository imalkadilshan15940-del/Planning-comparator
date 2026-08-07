// ui/changedStyles.js
// The main working screen. Matching/calculation happens at Style No +
// Tracking No + Line level. Every style+tracking+line is compared against
// a baseline in its own prior history for its factory — by default the
// immediately previous report, but configurable (N reports back, or "All")
// via the same reportsLookback setting used on the Reports page.

import { getAllReports, getChangedStylesAcrossLatestReports, getChangedStylesForReport, getStyleTimeline } from '../storage/snapshotRepo.js';
import { getDeliveryCorrectionsMeta } from '../storage/deliveryCorrectionsRepo.js';
import { showCommentHistoryModal } from './commentHistoryModal.js';
import { buildCommentCountIndex, getCommentCount } from '../storage/commentHistoryRepo.js';
import { dbGet } from '../storage/db.js';
import { el, toast, showLoading, hideLoading } from './shell.js';
import { clearReportDataCache, convertAllPdfsToJson } from '../storage/reportDataRepo.js';
import { formatDateShort } from '../shared/dateUtils.js';
import { buildProductionTimelineChart } from './ganttChart.js';
import { downloadCsv } from '../export/csvExport.js';
import { makeTableResizable } from './resizableTable.js';
import { renderDelDateSwitchHtml, wireDelDateSwitch } from '../shared/delDateSwitch.js';
import { loadSettings, saveSettings } from '../settings/settingsManager.js';
import { applyColumnOrder, makeColumnsReorderable } from '../shared/columnOrder.js';
import { renderFilterRow, wireFilterRow, applyColumnFilters, clearFilters } from '../shared/columnFilters.js';
import { rowMatchesQuery } from '../shared/searchMatch.js';
import { saveHistoryRecord } from '../storage/changedStyleHistoryRepo.js';

const CS_COLUMNS = [
  { key: 'styleNo', label: 'Style No' },
  { key: 'trackingNumber', label: 'Tracking No' },
  { key: 'acc', label: 'Acc' },
  { key: 'factoryLine', label: 'Line' },
  { key: 'similarBody', label: 'Similar Body' },
  { key: 'garmentType', label: 'Garment Type' },
  { key: 'washType', label: 'Wash Type' },
  { key: 'stDate', label: 'ST' },
  { key: 'fiDate', label: 'FI' },
  { key: 'prdDys', label: 'PRD DYS' },
  { key: 'avgEffi', label: 'Avg Effi' },
  { key: 'tgtCut', label: 'TGT CUT', filterType: 'date' },
  { key: 'tgt', label: 'TRG/H' },
  { key: 'delDate', label: 'Delivery' },
  { key: 'delDate2nd', label: '2nd Del' },
  { key: 'gapFiDel', label: 'GAP OF FI & DEL' },
  { key: 'planQtyTotal', label: 'Plan Qty', filterType: 'none' },
  { key: 'movementDaysPSD', label: 'CHE. DAYS-PSD' },
  { key: 'styleMovement', label: 'MOVEMENT' },
  { key: 'qtyShiftType', label: 'Qty Shift', filterType: 'text' },
  { key: 'statusPSD', label: 'STATUS-PSD' },
  { key: 'statusDEL', label: 'STATUS-DEL' },
  { key: 'comment', label: 'Comments', filterType: 'none' },
  { key: 'reportHistory', label: 'Report History', filterType: 'none' },
];
const CS_DEFAULT_HIDDEN = new Set(['acc', 'similarBody', 'garmentType', 'prdDys', 'avgEffi', 'tgtCut', 'tgt', 'movementDaysPSD']);

let state = {
  factory: 'ALL', changedOnly: true, search: '', groupBy: 'line',
  columnWidths: {}, hidden: new Set(CS_DEFAULT_HIDDEN), columnFilters: {},
};
let cachedRows = [];
let viewingReports = []; // the specific report(s) whose data is currently shown, for the "source PDF" bar
let qtyShiftColors = { full: '#B8791A', balance: '#B03040', increased: '#1E6690' };
let statusColors = {
  'TIGH PRO-PSD': '#B03040',
  'CHANGED-FI/DEL': '#B8791A',
  'UNCHANGED-PSD': '#8494A2',
  'NOT PRE DATA': '#1E6690',
  'NEW': '#2E7D5B',
};
let statusDelColors = { 'SAFE': '#2E7D5B', 'CRITICAL-DEL': '#B03040' };
let effectiveColumns = CS_COLUMNS;

const QTY_SHIFT_LABEL_TEXT = { full: 'Full Shift', balance: 'Balance Shift', increased: 'Qty Increased' };
const STATUS_TOOLTIPS = {
  'TIGH PRO-PSD': 'ST moved beyond the ST threshold and Delivery has not extended enough to compensate — lead time is genuinely tight.',
  'CHANGED-FI/DEL': 'Finish Date or Delivery Date changed (ST is evaluated separately via STYLE MOVEMENT / thresholds).',
  'UNCHANGED-PSD': 'Nothing that matters has moved since this style+tracking+line\'s last appearance.',
  'NOT PRE DATA': 'No prior report exists yet for this factory — nothing to compare against.',
  'NEW': 'This style+tracking+line is appearing for the first time in this factory\'s history.',
};

function getReportIdFromUrl() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  return q.get('report') ? Number(q.get('report')) : null;
}

export async function renderChangedStyles(container) {
  // TEMPORARY DIAGNOSTIC — run window.__csDebug() in the console before
  // and after clicking the toggle, to see exactly what the live state
  // actually is. Safe to leave in; does nothing unless called manually.
  window.__csDebug = () => ({
    changedOnly: state.changedOnly,
    totalCachedRows: cachedRows.length,
    changedRowCount: cachedRows.filter((r) => r.isChanged).length,
    unchangedRowCount: cachedRows.filter((r) => !r.isChanged).length,
    toggleButtons: [...document.querySelectorAll('#cs-toggle button')].map((b) => ({ text: b.textContent, active: b.classList.contains('active'), mode: b.dataset.mode })),
    visibleRowsInDom: document.querySelectorAll('#cs-body tbody tr').length,
  });

  // Search text and the factory dropdown reset on every fresh visit — see
  // the same fix in All Styles for why.
  state.search = '';
  state.factory = 'ALL';
  clearFilters(state.columnFilters);

  const [dcMeta, settings] = await Promise.all([getDeliveryCorrectionsMeta(), loadSettings()]);
  if (Array.isArray(settings.changedStylesHiddenColumns)) state.hidden = new Set(settings.changedStylesHiddenColumns);
  if (dcMeta.count === 0) state.hidden.add('delDate2nd');
  else state.hidden.delete('delDate2nd');

  if (settings.qtyShiftColors) qtyShiftColors = { ...qtyShiftColors, ...settings.qtyShiftColors };
  if (settings.statusColors) statusColors = { ...statusColors, ...settings.statusColors };
  if (settings.statusDelColors) statusDelColors = { ...statusDelColors, ...settings.statusDelColors };
  effectiveColumns = applyColumnOrder(CS_COLUMNS, settings.changedStylesColumnOrder);
  state.columnWidths = { ...(settings.changedStylesColumnWidths || {}) };
  const lookback = settings.reportsLookback || { mode: 'count', count: 1 };
  const lookbackArg = lookback.mode === 'all' ? 'all' : (lookback.count || 1);
  const lookbackLabel = lookback.mode === 'all' ? 'all previous reports' : `${lookback.count || 1} previous report${(lookback.count || 1) === 1 ? '' : 's'} back`;

  const reports = await getAllReports();
  const factories = [...new Set(reports.map((r) => r.factory).filter(Boolean))].sort();
  const singleReportId = getReportIdFromUrl();

  container.innerHTML = `
    <div class="topbar">
      <h1>Changed Styles</h1>
      <div style="color:var(--slate); font-size:13px;">Matched at Style + Tracking + Line &middot; compared against <b>${lookbackLabel}</b> — <a href="#/reports" style="color:var(--brand-blue);">change in Reports</a></div>
    </div>

    <div style="margin-bottom:14px;">${renderDelDateSwitchHtml(settings.delDateCalcMode || 'loading')}</div>

    ${reports.length === 0 ? `
      <div class="empty-state card"><h3>No reports yet</h3></div>
    ` : `
      <div id="cs-source-bar" class="card" style="margin-bottom:14px; padding:10px 16px;"></div>

      <div class="btn-row" style="margin-bottom:14px; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="btn-row" style="flex-wrap:wrap; align-items:center;">
          ${singleReportId ? `<button class="btn" id="cs-clear-single">← Latest across all factories</button>` : `
            <select id="cs-factory" class="btn"><option value="ALL">All factories</option>${factories.map((f) => `<option value="${f}">${f}</option>`).join('')}</select>
          `}
          <div class="toggle-group" id="cs-toggle">
            <button data-mode="changed" class="active">Changed only</button>
            <button data-mode="all">All styles</button>
          </div>
          <span style="font-size:12px; color:var(--slate); margin-left:4px;">Group by:</span>
          <div class="toggle-group" id="cs-groupby">
            <button data-group="line" class="active">Line</button>
            <button data-group="style">Style</button>
            <button data-group="factory">Factory</button>
          </div>
          <div class="search-box" style="min-width:200px;"><input id="cs-search" type="text" placeholder="Search style…"></div>
          <button class="btn" id="cs-columns-toggle">Columns ▾</button>
          <button class="btn" id="cs-clear-filters">Clear Filters</button>
        </div>
        <div class="btn-row">
          <button class="btn" id="cs-save-history" disabled title="Save to History is only available when viewing exactly one report — pick a specific factory, or open a report from Reports.">Save to History</button>
          <button class="btn" id="cs-save-layout">Save Layout</button>
          <button class="btn" id="cs-refresh">⟳ Refresh Data</button>
          <button class="btn" id="cs-export-csv">Export CSV</button>
        </div>
      </div>

      <div id="cs-columns-panel" class="card" style="display:none; margin-bottom:14px;">
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px;">
          ${effectiveColumns.map((c) => `
            <label style="display:flex; align-items:center; gap:6px; font-size:12.5px;">
              <input type="checkbox" data-cs-col="${c.key}" ${state.hidden.has(c.key) ? '' : 'checked'}> ${c.label}
            </label>
          `).join('')}
        </div>
      </div>

      <div id="cs-body"></div>
    `}
  `;

  if (reports.length === 0) return;

  wireDelDateSwitch(container, () => renderChangedStyles(container));

  container.querySelector('#cs-clear-single')?.addEventListener('click', () => {
    location.hash = '#/changed-styles';
  });
  container.querySelector('#cs-factory')?.addEventListener('change', (e) => {
    state.factory = e.target.value; loadAndRender(container, lookbackArg, singleReportId);
  });
  container.querySelectorAll('#cs-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.changedOnly = btn.dataset.mode === 'changed';
      container.querySelectorAll('#cs-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
      renderBody(container);
    });
  });
  container.querySelectorAll('#cs-groupby button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.groupBy = btn.dataset.group;
      container.querySelectorAll('#cs-groupby button').forEach((b) => b.classList.toggle('active', b === btn));
      renderBody(container);
    });
  });
  container.querySelector('#cs-search').addEventListener('input', (e) => {
    state.search = e.target.value; renderBody(container);
  });
  container.querySelector('#cs-columns-toggle').addEventListener('click', () => {
    const panel = container.querySelector('#cs-columns-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  container.querySelector('#cs-clear-filters').addEventListener('click', () => {
    clearFilters(state.columnFilters);
    renderBody(container);
  });
  container.querySelectorAll('#cs-columns-panel input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.hidden.delete(cb.dataset.csCol); else state.hidden.add(cb.dataset.csCol);
      renderBody(container);
    });
  });
  container.querySelector('#cs-export-csv').addEventListener('click', () => exportCsv());
  container.querySelector('#cs-save-history').addEventListener('click', () => saveCurrentViewToHistory());

  container.querySelector('#cs-save-layout').addEventListener('click', async () => {
    const s = await loadSettings();
    await saveSettings({
      ...s,
      changedStylesColumnOrder: effectiveColumns.map((c) => c.key),
      changedStylesColumnWidths: { ...state.columnWidths },
      changedStylesHiddenColumns: [...state.hidden].filter((k) => k !== 'delDate2nd'),
    });
    toast('Layout saved — column order, widths, and visibility will be remembered next time.', 'success');
  });

  container.querySelector('#cs-refresh').addEventListener('click', async () => {
    showLoading('Refreshing — clearing cache, re-converting PDFs, fetching documents…');
    try {
      await clearReportDataCache();
      await convertAllPdfsToJson();
    } finally {
      hideLoading();
    }
    document.getElementById('fetch-documents-btn')?.click();
  });

  await loadAndRender(container, lookbackArg, singleReportId);
}

async function loadAndRender(container, lookbackArg, singleReportId) {
  container.querySelector('#cs-body').innerHTML = `<div class="empty-state card"><h3>Loading…</h3></div>`;

  if (singleReportId) {
    const report = await dbGet('reports', singleReportId);
    const rows = await getChangedStylesForReport(singleReportId, lookbackArg);
    cachedRows = rows.map((r) => ({ ...r, report }));
    viewingReports = report ? [report] : [];
  } else {
    cachedRows = await getChangedStylesAcrossLatestReports(state.factory === 'ALL' ? null : state.factory, lookbackArg);
    const seen = new Map();
    for (const r of cachedRows) if (r.report) seen.set(r.report.id, r.report);
    viewingReports = [...seen.values()];
  }

  renderSourceBar(container);
  renderBody(container);
}

function renderSourceBar(container) {
  const saveBtn = container.querySelector('#cs-save-history');
  if (saveBtn) saveBtn.disabled = viewingReports.length !== 1;

  const bar = container.querySelector('#cs-source-bar');
  if (!bar) return;
  if (viewingReports.length === 0) {
    bar.innerHTML = `<span style="color:var(--slate); font-size:13px;">No source document found.</span>`;
    return;
  }
  bar.innerHTML = `
    <div style="font-size:11px; text-transform:uppercase; letter-spacing:.3px; color:var(--slate); margin-bottom:6px;">Source PDF${viewingReports.length === 1 ? '' : 's'}</div>
    <div style="display:flex; flex-wrap:wrap; gap:8px;">
      ${viewingReports.map((r) => `
        <span class="pill" style="background:var(--brand-blue-tint); color:var(--brand-blue-dark); display:inline-flex; align-items:center; gap:6px;">
          <b class="mono">${r.filename}</b><span style="color:var(--slate);">${r.factory || '—'} &middot; ${formatDateShort(r.printedDate) || r.ingestedAt || '—'}</span>
        </span>
      `).join('')}
    </div>
  `;
}

function groupRows(rows, mode) {
  if (mode === 'style') {
    return [[null, [...rows].sort((a, b) => (a.styleNo || '').localeCompare(b.styleNo || '', undefined, { numeric: true }))]];
  }
  const keyFn = mode === 'factory' ? (r) => r.report?.factory || 'Unknown' : (r) => r.factoryLine || 'Unassigned';
  const groups = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

function statusBadge(status) {
  const color = statusColors[status] || 'var(--slate-soft)';
  const tooltip = STATUS_TOOLTIPS[status] || '';
  return `<span class="badge" style="background:${color};" title="${tooltip}">${status}</span>`;
}

function renderCell(r, key) {
  switch (key) {
    case 'styleNo': return `<td class="mono">${r.displayStyleNo || r.styleNo || '—'}</td>`;
    case 'trackingNumber': return `<td class="mono">${r.trackingNumber ?? '—'}</td>`;
    case 'acc': return `<td class="mono">${r.acc ?? '—'}</td>`;
    case 'factoryLine': return `<td class="mono" style="font-size:11.5px;">${r.factoryLine ?? '—'}</td>`;
    case 'similarBody': return `<td class="mono">${r.similarBody ?? '—'}</td>`;
    case 'garmentType': return `<td>${r.garmentType ?? '—'}</td>`;
    case 'stDate': return `<td class="mono">${formatDateShort(r.stDate) || '—'}</td>`;
    case 'fiDate': return `<td class="mono">${formatDateShort(r.fiDate) || '—'}</td>`;
    case 'prdDys': return `<td class="mono">${r.prdDys ?? '—'}</td>`;
    case 'avgEffi': return `<td class="mono">${r.avgEffi != null ? `${r.avgEffi}%` : '—'}</td>`;
    case 'tgtCut': return `<td class="mono">${r.tgtCut ?? '—'}</td>`;
    case 'tgt': return `<td class="mono">${r.tgt != null && r.tgt !== '' ? `${r.tgt}` : '—'}</td>`;
    case 'delDate': return `<td class="mono">${formatDateShort(r.delDate) || '—'}</td>`;
    case 'delDate2nd': { const eff2nd = r.delDate2nd || r.delDate; const cls2nd = r.delDate2nd ? 'delivery-corrected' : 'delivery-original'; return `<td class="mono ${cls2nd}" title="${r.delDate2nd ? 'Revised — from the uploaded delivery date corrections file' : 'Not revised — showing the original PDF date (no correction on file for this row)'}">${eff2nd ? formatDateShort(eff2nd) : '—'}</td>`; }
    case 'washType': return `<td>${r.washType || '—'}</td>`;
    case 'gapFiDel': return `<td class="mono" style="${r.gapFiDel != null && r.gapFiDel < 0 ? 'color:var(--critical); font-weight:700;' : ''}">${r.gapFiDel != null ? r.gapFiDel : '—'}</td>`;
    case 'planQtyTotal': return `<td class="mono">${r.planQtyTotal != null ? Math.round(r.planQtyTotal).toLocaleString() : '—'}</td>`;
    case 'movementDaysPSD': {
      const v = r.movementDaysPSD;
      const text = v == null ? '—' : (v > 0 ? `+${v}d` : `${v}d`);
      return `<td class="mono" style="${v > 0 ? 'color:var(--critical); font-weight:700;' : ''}">${text}</td>`;
    }
    case 'styleMovement': {
      const color = r.styleMovement === 'Push Back' ? 'var(--critical)' : r.styleMovement === 'Advance' ? 'var(--success)' : 'var(--slate)';
      return `<td style="color:${color}; font-weight:600;">${r.styleMovement || '—'}</td>`;
    }
    case 'qtyShiftType': {
      const qtyBadge = r.qtyShiftType && QTY_SHIFT_LABEL_TEXT[r.qtyShiftType]
        ? `<span class="badge" style="background:${qtyShiftColors[r.qtyShiftType]};" title="Previous week's Plan Qty: ${r.prevPlanQtyTotal != null ? Math.round(r.prevPlanQtyTotal).toLocaleString() : '—'}${r.planQtyTotal != null ? ` → Now: ${Math.round(r.planQtyTotal).toLocaleString()}` : ''}">${QTY_SHIFT_LABEL_TEXT[r.qtyShiftType]}</span>`
        : '<span style="color:var(--slate);">—</span>';
      return `<td>${qtyBadge}</td>`;
    }
    case 'statusPSD': return `<td>${statusBadge(r.statusPSD)}</td>`;
    case 'statusDEL': {
      const color = statusDelColors[r.statusDEL] || 'var(--slate-soft)';
      const tooltip = r.statusDEL === 'CRITICAL-DEL'
        ? `Gap between FI and Delivery (${r.gapFiDel ?? '—'} days) is below the ${r.washType || 'Non Wash'} threshold.`
        : r.statusDEL === 'SAFE' ? 'Gap between FI and Delivery meets or exceeds the threshold for this Wash Type.' : 'FI or Delivery date missing — gap could not be calculated.';
      return `<td>${r.statusDEL ? `<span class="badge" style="background:${color};" title="${tooltip}">${r.statusDEL}</span>` : '<span style="color:var(--slate);">—</span>'}</td>`;
    }
    case 'reportHistory': {
      const datesList = (r.allPrintedDates || []).length
        ? `<span class="mono" style="font-size:11px; color:var(--slate); line-height:1.6;">${r.allPrintedDates.map(formatDateShort).join(' &middot; ')}</span>`
        : '<span style="color:var(--slate);">—</span>';
      return `<td>${datesList}</td>`;
    }
    case 'comment': {
      const count = r.commentCount || 0;
      const inner = count > 0
        ? `<span class="badge" style="background:var(--brand-blue);">💬 ${count}</span>`
        : `<span style="opacity:.35; font-size:15px;">💬</span>`;
      return `<td style="text-align:center;"><button type="button" class="comment-icon-btn" data-comment-style="${r.styleNo}" data-comment-tracking="${r.trackingNumber || ''}" data-comment-line="${r.factoryLine || ''}" data-report-filename="${(r.report?.filename || '').replace(/"/g, '&quot;')}" data-report-printed-date="${r.report?.printedDate || ''}" title="${count > 0 ? `${count} comment${count === 1 ? '' : 's'} — click to view` : 'No comments yet — click to add'}" style="background:none; border:none; cursor:pointer; padding:2px 4px; line-height:1; color:var(--ink);">${inner}</button></td>`;
    }
    default: return `<td>—</td>`;
  }
}

function renderBody(container) {
  const body = container.querySelector('#cs-body');
  // Groups are structural — determined by changedOnly + groupBy only, NOT
  // by search/column-filters. This keeps each group's section (and its
  // filter row) stable and always present even while heavily filtered, so
  // typing into a filter never destroys the input mid-word. If a group's
  // rows are all filtered out, its tbody shows an empty message but the
  // section itself (and its filter row) stays put.
  let structuralRows = cachedRows;
  if (state.changedOnly) structuralRows = structuralRows.filter((r) => r.isChanged);

  if (structuralRows.length === 0) {
    body.innerHTML = `<div class="empty-state card"><h3>${state.changedOnly ? 'No changed styles' : 'No styles'} match the current filters.</h3></div>`;
    return;
  }

  const cols = effectiveColumns.filter((c) => !state.hidden.has(c.key));
  const groups = groupRows(structuralRows, state.groupBy);
  body.innerHTML = '';

  const sectionEntries = []; // { section, groupName, groupRowsList }

  // Column filters are shared across every group's table, but each group
  // has its own separate filter-row DOM — so typing in one group's filter
  // must refresh every group's tbody (not just the one typed into), and
  // sync the same value into the other groups' matching inputs. The
  // actively-focused input is always skipped so it's never fought with
  // mid-keystroke.
  const refreshAll = () => {
    for (const entry of sectionEntries) renderGroupTbody(entry.section, entry.groupName, entry.groupRowsList, cols);
    for (const entry of sectionEntries) {
      entry.section.querySelectorAll('.col-filter-row input').forEach((input) => {
        if (input === document.activeElement) return;
        const key = input.dataset.filterKey, part = input.dataset.filterPart;
        const current = state.columnFilters[key]?.[part] ?? '';
        if (input.value !== current) input.value = current;
      });
    }
  };

  for (const [groupName, groupRowsList] of groups) {
    const section = el(`
      <div class="card" style="margin-bottom:16px; padding:0; overflow:hidden;">
        ${groupName !== null ? `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 18px; background:var(--brand-blue-tint); border-bottom:1px solid var(--line);" data-group-summary>
          </div>
        ` : ''}
        <div class="table-wrap" style="border:none; border-radius:0;">
          <table>
            <thead><tr>${cols.map((c) => `<th data-col="${c.key}">${c.label}</th>`).join('')}</tr>${renderFilterRow(cols, state.columnFilters)}</thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `);
    const tbody = section.querySelector('tbody');
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.comment-icon-btn');
      if (!btn) return;
      const identity = {
        styleNo: btn.dataset.commentStyle,
        trackingNumber: btn.dataset.commentTracking,
        factoryLine: btn.dataset.commentLine,
      };
      showCommentHistoryModal(identity, async () => {
        const countIndex = await buildCommentCountIndex();
        for (const r of cachedRows) {
          if (r.styleNo === identity.styleNo && r.trackingNumber === identity.trackingNumber && r.factoryLine === identity.factoryLine) {
            r.commentCount = getCommentCount(countIndex, r.styleNo, r.trackingNumber, r.factoryLine);
          }
        }
        refreshAll();
      }, { reportFilename: btn.dataset.reportFilename, reportPrintedDate: btn.dataset.reportPrintedDate });
    });

    body.appendChild(section);
    makeTableResizable(section.querySelector('table'), {
      widths: state.columnWidths,
      onResize: async (key, width) => {
        state.columnWidths[key] = width;
        const s = await loadSettings();
        await saveSettings({ ...s, changedStylesColumnWidths: { ...(s.changedStylesColumnWidths || {}), [key]: width } });
      },
    });
    makeColumnsReorderable(section.querySelector('table'), async (newVisibleOrder) => {
      const oldOrder = effectiveColumns.map((c) => c.key);
      const visibleQueue = [...newVisibleOrder];
      const finalOrder = oldOrder.map((key) => (state.hidden.has(key) ? key : visibleQueue.shift()));

      effectiveColumns = applyColumnOrder(CS_COLUMNS, finalOrder);
      const settings = await loadSettings();
      await saveSettings({ ...settings, changedStylesColumnOrder: finalOrder });
      renderBody(container);
    });
    wireFilterRow(section.querySelector('.col-filter-row'), state.columnFilters, refreshAll);

    sectionEntries.push({ section, groupName, groupRowsList });
    renderGroupTbody(section, groupName, groupRowsList, cols);
  }
}

/** Applies search + column filters to one group's rows and rebuilds only that group's tbody + summary line — never touches the header or filter row. */
function renderGroupTbody(section, groupName, groupRowsList, cols) {
  let rows = groupRowsList;
  if (state.search) rows = rows.filter((r) => rowMatchesQuery(r, ['styleNo', 'displayStyleNo', 'trackingNumber'], state.search));
  rows = applyColumnFilters(rows, state.columnFilters, cols);

  const summaryEl = section.querySelector('[data-group-summary]');
  if (summaryEl) {
    const criticalDelCount = rows.filter((r) => r.isCriticalDel).length;
    const changedCount = rows.filter((r) => r.isChanged).length;
    summaryEl.innerHTML = `
      <h3 style="margin:0; font-size:14.5px; color:var(--brand-blue-dark);">${state.groupBy === 'factory' ? 'Factory' : 'Line'} ${groupName}</h3>
      <div style="font-size:12px; color:var(--slate);">${rows.length} styles &middot; ${changedCount} changed ${criticalDelCount > 0 ? `&middot; <span style="color:var(--critical); font-weight:700;">${criticalDelCount} critical-del</span>` : ''}</div>
    `;
  }

  const tbody = section.querySelector('tbody');
  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.appendChild(el(`<tr><td colspan="${cols.length}" style="text-align:center; padding:20px; color:var(--slate);">No rows match the current filters.</td></tr>`));
    return;
  }

  for (const r of rows.sort((a, b) => (b.isCriticalDel - a.isCriticalDel) || (b.isChanged - a.isChanged))) {
    // Row background highlighting is driven entirely by STATUS-DEL, not
    // STATUS-PSD — STATUS-PSD still shows as its own badge/column, but no
    // longer affects the row's overall color.
    const rowClass = r.isCriticalDel ? 'row-critical' : '';
    const tr = el(`<tr class="${rowClass}" style="cursor:pointer;">${cols.map((c) => renderCell(r, c.key)).join('')}</tr>`);
    tr.addEventListener('click', async (e) => {
      if (e.target.closest('.comment-icon-btn')) return;
      const existing = tr.nextElementSibling;
      if (existing && existing.classList.contains('chart-row')) { existing.remove(); return; }
      const fullTimeline = await getStyleTimeline(r.styleKey);
      const chartRow = document.createElement('tr');
      chartRow.className = 'chart-row';
      const td = document.createElement('td');
      td.colSpan = cols.length;
      td.style.background = 'var(--paper)';
      td.style.padding = '16px 18px';
      td.innerHTML = `
        <div style="display:flex; gap:24px; align-items:flex-start;">
          <div>${buildProductionTimelineChart(fullTimeline, { width: 1100 })}</div>
          <div style="flex:1;"></div>
        </div>
      `;
      chartRow.appendChild(td);
      tr.after(chartRow);
    });
    tbody.appendChild(tr);
  }
}

function exportCsv() {
  let rows = cachedRows;
  if (state.changedOnly) rows = rows.filter((r) => r.isChanged);
  const cols = effectiveColumns.filter((c) => !state.hidden.has(c.key));
  const headerLabelFor = { statusPSD: 'STATUS-PSD', statusDEL: 'STATUS-DEL', qtyShiftType: 'Qty Shift Type', movementDaysPSD: 'CHE. DAYS-PSD', planQtyTotal: 'Plan Qty', reportHistory: 'All Report Print Dates', styleMovement: 'MOVEMENT', gapFiDel: 'GAP OF FI & DEL', washType: 'Wash Type' };
  const headers = cols.map((c) => headerLabelFor[c.key] || c.label);
  const lines = [headers.join(',')];
  for (const r of rows) {
    const valueFor = {
      styleNo: r.displayStyleNo || r.styleNo, trackingNumber: r.trackingNumber, acc: r.acc, factoryLine: r.factoryLine, similarBody: r.similarBody,
      garmentType: r.garmentType, washType: r.washType || '', stDate: formatDateShort(r.stDate), fiDate: formatDateShort(r.fiDate), prdDys: r.prdDys,
      avgEffi: r.avgEffi, tgtCut: r.tgtCut, tgt: r.tgt, delDate: formatDateShort(r.delDate), delDate2nd: r.delDate2nd ? formatDateShort(r.delDate2nd) : '', gapFiDel: r.gapFiDel ?? '',
      planQtyTotal: r.planQtyTotal != null ? Math.round(r.planQtyTotal) : '',
      movementDaysPSD: r.movementDaysPSD ?? '', styleMovement: r.styleMovement || '',
      qtyShiftType: QTY_SHIFT_LABEL_TEXT[r.qtyShiftType] || '',
      statusPSD: r.statusPSD || '', statusDEL: r.statusDEL || '',
      comment: r.commentCount > 0 ? `${r.commentCount} comment${r.commentCount === 1 ? '' : 's'}` : '',
      reportHistory: (r.allPrintedDates || []).map(formatDateShort).join(' | '),
    };
    lines.push(cols.map((c) => valueFor[c.key] ?? '')
      .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','));
  }
  downloadCsv(lines.join('\n'), 'changed-styles.csv');
}

async function saveCurrentViewToHistory() {
  if (viewingReports.length !== 1) {
    toast('Save to History needs exactly one report in view — pick a specific factory, or open a report from Reports.', 'error');
    return;
  }
  const report = viewingReports[0];
  const baseline = cachedRows.find((r) => r.changedSinceReport)?.changedSinceReport || null;

  const record = {
    factory: report.factory || 'UNKNOWN',
    comparedFilename: report.filename,
    comparedPrintedDate: report.printedDate || report.ingestedAt,
    previousFilename: baseline ? baseline.filename : null,
    previousPrintedDate: baseline ? (baseline.printedDate || baseline.ingestedAt) : null,
    reportId: report.id,
    sourceStylePdfName: report.filename,
    // Deep-clone so later edits to the live view can never leak into this
    // frozen snapshot.
    rows: JSON.parse(JSON.stringify(cachedRows)),
  };

  const result = await saveHistoryRecord(record);
  if (result.exported) {
    toast('Saved to History (and exported to the History folder).', 'success');
  } else {
    toast(`Saved to History. Folder export skipped: ${result.reason}`, 'success');
  }
}
