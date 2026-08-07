// ui/changedStyleHistory.js
// Two views in one page, switched by a ?id= query param:
//   - List (no id): every saved history record, grouped by Factory, then
//     by compared file name, newest first within each group.
//   - Viewer (?id=N): the frozen Changed Styles table exactly as it looked
//     when saved — every value read-only, except Comments, which uses the
//     same live, unified Style+Tracking+Line comment history as every
//     other page (not a separate frozen-per-record copy).

import {
  getAllHistoryRecords, getHistoryRecord, renameHistoryRecord, deleteHistoryRecord,
} from '../storage/changedStyleHistoryRepo.js';
import { el, toast } from './shell.js';
import { formatDateShort, parsePrintedDate } from '../shared/dateUtils.js';
import { loadSettings } from '../settings/settingsManager.js';
import { buildProductionTimelineChart } from './ganttChart.js';
import { rowMatchesQuery } from '../shared/searchMatch.js';
import { renderFilterRow, wireFilterRow, applyColumnFilters, clearFilters } from '../shared/columnFilters.js';
import { showCommentHistoryModal } from './commentHistoryModal.js';
import { getCommentHistory } from '../storage/commentHistoryRepo.js';
import { getStyleTimeline } from '../storage/snapshotRepo.js';
// (used by the Viewer's filter row below, not the List page — see renderViewer)

let statusColors = {
  'TIGH PRO-PSD': '#B03040', 'CHANGED-FI/DEL': '#B8791A', 'UNCHANGED-PSD': '#8494A2',
  'NOT PRE DATA': '#1E6690', 'NEW': '#2E7D5B',
};
let statusDelColors = { 'SAFE': '#2E7D5B', 'CRITICAL-DEL': '#B03040' };
let qtyShiftColors = { full: '#B8791A', balance: '#B03040', increased: '#1E6690' };
const QTY_SHIFT_LABEL_TEXT = { full: 'Full Shift', balance: 'Balance Shift', increased: 'Qty Increased' };

function statusBadge(label, colors) {
  if (!label) return '<span style="color:var(--slate);">—</span>';
  return `<span class="badge" style="background:${colors[label] || 'var(--slate-soft)'};">${label}</span>`;
}

export async function renderChangedStyleHistory(container) {
  const settings = await loadSettings();
  if (settings.statusColors) statusColors = { ...statusColors, ...settings.statusColors };
  if (settings.statusDelColors) statusDelColors = { ...statusDelColors, ...settings.statusDelColors };
  if (settings.qtyShiftColors) qtyShiftColors = { ...qtyShiftColors, ...settings.qtyShiftColors };

  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const id = params.get('id');
  if (id) await renderViewer(container, Number(id));
  else await renderList(container);
}

// ---------------- List ----------------

let listState = { search: '', sortKey: 'savedAt', sortDir: 'desc' };

async function renderList(container) {
  // Search resets on every fresh visit — see the same fix on All Styles.
  listState.search = '';
  const records = await getAllHistoryRecords();

  container.innerHTML = `
    <div class="topbar">
      <h1>Changed Style History</h1>
      <div style="color:var(--slate); font-size:13px;">${records.length} saved comparison${records.length === 1 ? '' : 's'}</div>
    </div>

    ${records.length === 0 ? `
      <div class="empty-state card">
        <h3>No saved history yet</h3>
        <p>Open a specific report's Changed Styles view and click <b>Save to History</b> to create your first record.</p>
      </div>
    ` : `
      <div class="btn-row" style="margin-bottom:14px; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div class="search-box" style="min-width:240px;"><input id="csh-search" type="text" placeholder="Search source name, compared file…"></div>
        <select id="csh-sort" class="btn">
          <option value="savedAt-desc">Newest first</option>
          <option value="savedAt-asc">Oldest first</option>
          <option value="sourceStylePdfName-asc">Source name (A–Z)</option>
          <option value="sourceStylePdfName-desc">Source name (Z–A)</option>
        </select>
      </div>
      <div id="csh-groups"></div>
    `}
  `;

  if (records.length === 0) return;

  container.querySelector('#csh-search').addEventListener('input', (e) => {
    listState.search = e.target.value;
    renderGroups(container, records);
  });
  container.querySelector('#csh-sort').addEventListener('change', (e) => {
    const [key, dir] = e.target.value.split('-');
    listState.sortKey = key; listState.sortDir = dir;
    renderGroups(container, records);
  });

  renderGroups(container, records);
}

function renderGroups(container, allRecords) {
  const host = container.querySelector('#csh-groups');
  let rows = allRecords;
  if (listState.search) {
    rows = rows.filter((r) => rowMatchesQuery(r, ['sourceStylePdfName', 'comparedFilename', 'previousFilename'], listState.search));
  }
  rows = [...rows].sort((a, b) => {
    const av = a[listState.sortKey] || '', bv = b[listState.sortKey] || '';
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return listState.sortDir === 'asc' ? cmp : -cmp;
  });

  host.innerHTML = '';
  if (rows.length === 0) {
    host.appendChild(el(`<div class="empty-state card"><h3>No records match your search.</h3></div>`));
    return;
  }

  // Factory >> compared file name >> data, per spec.
  const byFactory = new Map();
  for (const r of rows) {
    const list = byFactory.get(r.factory || 'Unknown') || [];
    list.push(r);
    byFactory.set(r.factory || 'Unknown', list);
  }

  for (const [factory, factoryRows] of [...byFactory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const section = el(`
      <div class="card" style="margin-bottom:16px; padding:0; overflow:hidden;">
        <div style="padding:12px 18px; background:var(--brand-blue-tint); border-bottom:1px solid var(--line);">
          <h3 style="margin:0; font-size:14.5px; color:var(--brand-blue-dark);">Factory ${factory}</h3>
        </div>
        <div class="table-wrap" style="border:none; border-radius:0;">
          <table>
            <thead><tr>
              <th>Source Style PDF Name</th><th>Compared File</th><th>Previous File Printed Date</th><th>Comparison Date &amp; Time</th><th></th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `);
    const tbody = section.querySelector('tbody');
    for (const r of factoryRows) {
      const tr = el(`
        <tr>
          <td class="mono">${r.sourceStylePdfName}</td>
          <td class="mono" style="font-size:11.5px; color:var(--slate);">${r.comparedFilename}</td>
          <td class="mono">${r.previousPrintedDate ? formatDateShort(r.previousPrintedDate) : '<span style="color:var(--slate);">— no prior report —</span>'}</td>
          <td class="mono">${new Date(r.savedAt).toLocaleString()}</td>
          <td style="white-space:nowrap;">
            <a href="#/changed-style-history?id=${r.id}" class="btn" style="text-decoration:none; display:inline-block;">Open →</a>
            <button class="btn" data-rename="${r.id}">Rename</button>
            <button class="btn" data-delete="${r.id}" style="color:var(--critical);">Delete</button>
          </td>
        </tr>
      `);
      tbody.appendChild(tr);
    }
    host.appendChild(section);
  }

  host.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.rename);
      const rec = allRecords.find((r) => r.id === id);
      const next = prompt('Rename the Source Style PDF name (the original file on disk is never touched):', rec?.sourceStylePdfName || '');
      if (next == null || next.trim() === '') return;
      await renameHistoryRecord(id, next.trim());
      toast('Renamed.', 'success');
      renderList(container);
    });
  });
  host.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.delete);
      if (!confirm('Delete this history record? This cannot be undone.')) return;
      await deleteHistoryRecord(id);
      toast('History record deleted.', 'success');
      renderList(container);
    });
  });
}

// ---------------- Viewer ----------------

function renderRowCells(r) {
  const movementColor = r.styleMovement === 'Push Back' ? 'var(--critical)' : r.styleMovement === 'Advance' ? 'var(--success)' : 'var(--slate)';
  const effDelDate2nd = r.delDate2nd || r.delDate;
  const delDate2ndClass = r.delDate2nd ? 'delivery-corrected' : 'delivery-original';
  const qtyBadge = r.qtyShiftType && QTY_SHIFT_LABEL_TEXT[r.qtyShiftType]
    ? `<span class="badge" style="background:${qtyShiftColors[r.qtyShiftType]};">${QTY_SHIFT_LABEL_TEXT[r.qtyShiftType]}</span>` : '<span style="color:var(--slate);">—</span>';
  return `
    <td class="mono">${r.displayStyleNo || r.styleNo || '—'}</td>
    <td class="mono">${r.trackingNumber ?? '—'}</td>
    <td class="mono" style="font-size:11.5px;">${r.factoryLine ?? '—'}</td>
    <td>${r.washType || '—'}</td>
    <td class="mono">${formatDateShort(r.stDate) || '—'}</td>
    <td class="mono">${formatDateShort(r.fiDate) || '—'}</td>
    <td class="mono">${r.prdDys != null ? r.prdDys : '—'}</td>
    <td class="mono">${r.avgEffi != null ? `${r.avgEffi}%` : '—'}</td>
    <td class="mono">${formatDateShort(r.tgtCut) || '—'}</td>
    <td class="mono">${r.tgt != null && r.tgt !== '' ? r.tgt : '—'}</td>
    <td class="mono">${formatDateShort(r.delDate) || '—'}</td>
    <td class="mono ${delDate2ndClass}" title="${r.delDate2nd ? 'Revised — from the uploaded delivery date corrections file' : 'Not revised — showing the original PDF date (no correction on file for this row)'}">${effDelDate2nd ? formatDateShort(effDelDate2nd) : '—'}</td>
    <td class="mono">${r.gapFiDel != null ? r.gapFiDel : '—'}</td>
    <td class="mono">${r.planQtyTotal != null ? Math.round(r.planQtyTotal).toLocaleString() : '—'}</td>
    <td class="mono" style="${r.movementDaysPSD > 0 ? 'color:var(--critical); font-weight:700;' : ''}">${r.movementDaysPSD == null ? '—' : (r.movementDaysPSD > 0 ? `+${r.movementDaysPSD}d` : `${r.movementDaysPSD}d`)}</td>
    <td style="color:${movementColor}; font-weight:600;">${r.styleMovement || '—'}</td>
    <td>${qtyBadge}</td>
    <td>${statusBadge(r.statusPSD, statusColors)}</td>
    <td>${statusBadge(r.statusDEL, statusDelColors)}</td>
  `;
}

const VIEWER_COLUMNS = [
  { key: 'styleNo', label: 'Style No' },
  { key: 'trackingNumber', label: 'Tracking No' },
  { key: 'factoryLine', label: 'Line' },
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
];

async function renderViewer(container, id) {
  const rec = await getHistoryRecord(id);
  if (!rec) {
    container.innerHTML = `<div class="empty-state card"><h3>History record not found.</h3><p>It may have been deleted. <a href="#/changed-style-history">← Back to Changed Style History</a></p></div>`;
    return;
  }

  const columnFilters = {}; // resets fresh every time this record is opened

  function drawStructure() {
    container.innerHTML = `
      <div class="topbar">
        <h1>${rec.sourceStylePdfName}</h1>
        <div style="color:var(--slate); font-size:13px;"><a href="#/changed-style-history" style="color:var(--brand-blue);">← Back to Changed Style History</a></div>
      </div>

      <div class="card" style="margin-bottom:14px; padding:12px 18px;">
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; font-size:13px;">
          <div><div style="color:var(--slate); font-size:11px; text-transform:uppercase;">Factory</div>${rec.factory || '—'}</div>
          <div><div style="color:var(--slate); font-size:11px; text-transform:uppercase;">Compared File</div><span class="mono">${rec.comparedFilename}</span></div>
          <div><div style="color:var(--slate); font-size:11px; text-transform:uppercase;">Previous File</div><span class="mono">${rec.previousFilename || '— none —'}</span></div>
          <div><div style="color:var(--slate); font-size:11px; text-transform:uppercase;">Saved</div>${new Date(rec.savedAt).toLocaleString()}</div>
        </div>
      </div>

      <p style="color:var(--slate); font-size:12px; margin-bottom:10px;">Read-only snapshot — every value here is frozen as it looked when saved, except Comments, which is the same live, ongoing history shown everywhere else for this style.</p>

      <div class="btn-row" style="margin-bottom:14px;">
        <button class="btn" id="csh-clear-filters">Clear Filters</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Style No</th><th>Tracking No</th><th>Line</th><th>Wash Type</th><th>ST</th><th>FI</th>
            <th>PRD DYS</th><th>Avg Effi</th><th>TGT CUT</th><th>TRG/H</th><th>Delivery</th>
            <th>GAP OF FI &amp; DEL</th><th>Plan Qty</th><th>CHE. DAYS-PSD</th><th>MOVEMENT</th><th>Qty Shift</th>
            <th>STATUS-PSD</th><th>STATUS-DEL</th><th>Comments</th>
          </tr>${renderFilterRow(VIEWER_COLUMNS, columnFilters)}</thead>
          <tbody id="csh-viewer-tbody"></tbody>
        </table>
      </div>
    `;

    wireFilterRow(container.querySelector('.col-filter-row'), columnFilters, drawTbody);
    container.querySelector('#csh-clear-filters').addEventListener('click', () => {
      clearFilters(columnFilters);
      drawStructure(); // filter row's own displayed values need resetting too
    });

    drawTbody();
  }

  async function drawTbody() {
    const rows = applyColumnFilters(rec.rows, columnFilters, VIEWER_COLUMNS);
    const tbody = container.querySelector('#csh-viewer-tbody');
    tbody.innerHTML = '';

    if (rows.length === 0) {
      tbody.appendChild(el(`<tr><td colspan="19" style="text-align:center; padding:20px; color:var(--slate);">No rows match the current filters.</td></tr>`));
      return;
    }

    // Comments are looked up live (not from the frozen snapshot) — the
    // whole point of unifying this is that the same up-to-date history
    // shows here as everywhere else, not whatever it was at save-time.
    // Cutoff-aware, per row: a per-record bulk index would give the wrong
    // (unfiltered) count here, out of step with what the popup itself
    // shows once opened.
    const cutoffDate = rec.comparedPrintedDate;

    for (const r of rows) {
      const rowHistory = await getCommentHistory(r.styleNo, r.trackingNumber, r.factoryLine, cutoffDate);
      const count = rowHistory.length;
      const commentInner = count > 0
        ? `<span class="badge" style="background:var(--brand-blue);">💬 ${count}</span>`
        : `<span style="opacity:.35; font-size:15px;">💬</span>`;
      const commentCell = `<td style="text-align:center;"><button type="button" class="comment-icon-btn" data-comment-style="${r.styleNo}" data-comment-tracking="${r.trackingNumber || ''}" data-comment-line="${r.factoryLine || ''}" title="${count > 0 ? `${count} comment${count === 1 ? '' : 's'} — click to view` : 'No comments yet — click to add'}" style="background:none; border:none; cursor:pointer; padding:2px 4px; line-height:1;">${commentInner}</button></td>`;

      const tr = el(`<tr style="cursor:pointer;">${renderRowCells(r)}${commentCell}</tr>`);
      tr.addEventListener('click', async (e) => {
        if (e.target.closest('.comment-icon-btn')) return;
        const existing = tr.nextElementSibling;
        if (existing && existing.classList.contains('chart-row')) { existing.remove(); return; }
        const fullTimeline = await getStyleTimeline(r.styleKey);
        const cutoff = parsePrintedDate(cutoffDate);
        const chartTimeline = cutoff
          ? fullTimeline.filter((e) => {
              const entryDate = parsePrintedDate(e.report?.printedDate || e.report?.ingestedAt);
              return !entryDate || entryDate <= cutoff; // no date on record — show it rather than risk hiding it
            })
          : fullTimeline;
        const chartRow = document.createElement('tr');
        chartRow.className = 'chart-row';
        const td = document.createElement('td');
        td.colSpan = 20;
        td.style.background = 'var(--paper)';
        td.style.padding = '16px 18px';
        td.innerHTML = `
          <div style="display:flex; gap:24px; align-items:flex-start;">
            <div>${buildProductionTimelineChart(chartTimeline, { width: 1100 })}</div>
            <div style="flex:1;"></div>
          </div>
        `;
        chartRow.appendChild(td);
        tr.after(chartRow);
      });
      tbody.appendChild(tr);
    }

    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.comment-icon-btn');
      if (!btn) return;
      const identity = {
        styleNo: btn.dataset.commentStyle,
        trackingNumber: btn.dataset.commentTracking,
        factoryLine: btn.dataset.commentLine,
      };
      showCommentHistoryModal(identity, () => drawTbody(), {
        reportFilename: rec.comparedFilename,
        reportPrintedDate: rec.comparedPrintedDate,
        cutoffDate: rec.comparedPrintedDate,
      });
    });
  }

  drawStructure();
}
