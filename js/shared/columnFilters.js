// shared/columnFilters.js
//
// Adds an Excel-style filter row under any table's header: one control per
// column, all combinable (AND) with each other and with whatever other
// search/dropdown filters a page already has.
//
// Filter type (text/number/date/none) is inferred from the column key by
// default, but any column can override it explicitly via `filterType` on
// its column definition — e.g. `{ key: 'qtyShiftType', filterType: 'text' }`
// to force text matching on a key that would otherwise infer as numeric
// (it contains "qty"), or `{ key: 'planQtyTotal', filterType: 'none' }` to
// skip filtering that column entirely (still gets a blank aligned cell).
//
// Date and number filters render as a compact trigger button rather than
// two inputs side by side — the earlier from/to pair crammed into one
// column was the "excessive width" problem; the actual From/To (or Min/Max)
// inputs live in a small popover opened on click. Text filters reuse the
// same partial/exact (%) logic as the main search box.
//
// Like search text, filter values are NOT meant to persist across a fresh
// page visit — callers should reset the filters object to {} at the top
// of their render function, same as they already do for search text.

import { matchesQuery } from './searchMatch.js';
import { parsePrintedDate } from './dateUtils.js';

const DATE_KEY_HINTS = ['date', 'printed', 'savedat'];
const NUMBER_KEY_HINTS = ['qty', 'gap', 'days', 'effi', 'prddys', 'tgt', 'count', 'total'];

function inferFilterTypeFromKey(key) {
  const k = key.toLowerCase();
  if (DATE_KEY_HINTS.some((h) => k.includes(h))) return 'date';
  if (NUMBER_KEY_HINTS.some((h) => k.includes(h))) return 'number';
  return 'text';
}

/** A column's effective filter type: its own explicit `filterType` if given, otherwise inferred from the key. */
export function resolveFilterType(column) {
  if (column && column.filterType) return column.filterType;
  return inferFilterTypeFromKey(column?.key || '');
}

// Kept for any external code that only has a bare key (no column object).
export function inferFilterType(key) {
  return inferFilterTypeFromKey(key);
}

function parseFilterDate(str) {
  if (!str) return null;
  // Filter inputs are native <input type="date">, which always give YYYY-MM-DD.
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

function summarizeSpec(type, spec) {
  if (!spec) return null;
  if (type === 'number') {
    if (spec.min !== undefined && spec.max !== undefined) return `${spec.min}–${spec.max}`;
    if (spec.min !== undefined) return `≥ ${spec.min}`;
    if (spec.max !== undefined) return `≤ ${spec.max}`;
  }
  if (type === 'date') {
    if (spec.from !== undefined && spec.to !== undefined) return `${spec.from} → ${spec.to}`;
    if (spec.from !== undefined) return `from ${spec.from}`;
    if (spec.to !== undefined) return `to ${spec.to}`;
  }
  return null;
}

/**
 * @param columns  array of {key, label, filterType?} — same shape each page already uses
 * @param filters  the persisted-for-this-session filter state object (caller owns it)
 */
export function renderFilterRow(columns, filters) {
  return `<tr class="col-filter-row">${columns.map((c) => {
    const type = resolveFilterType(c);
    const current = filters[c.key] || {};

    if (type === 'none') return `<td></td>`;

    if (type === 'number' || type === 'date') {
      const summary = summarizeSpec(type, filters[c.key]);
      const active = !!summary;
      return `<td>
        <button type="button" class="col-filter-trigger" data-filter-popover-trigger="${c.key}"
          style="width:100%; text-align:left; padding:3px 6px; border:1px solid ${active ? 'var(--brand-blue)' : 'var(--line)'}; border-radius:4px; font-size:11px; background:${active ? 'var(--brand-blue-tint)' : 'var(--panel)'}; color:${active ? 'var(--brand-blue-dark)' : 'var(--slate)'}; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${active ? summary : (type === 'date' ? 'Date range…' : 'Range…')}
        </button>
        <div class="col-filter-popover" data-filter-popover-panel="${c.key}" style="display:none; position:absolute; top:100%; left:0; z-index:20; margin-top:2px; background:var(--panel); border:1px solid var(--line); border-radius:6px; box-shadow:0 8px 20px rgba(0,0,0,.15); padding:8px; min-width:150px;">
          ${type === 'number' ? `
            <label style="font-size:10.5px; color:var(--slate); display:block; margin-bottom:2px;">Min</label>
            <input type="number" data-filter-key="${c.key}" data-filter-part="min" value="${current.min ?? ''}" style="width:100%; padding:4px 6px; border:1px solid var(--line); border-radius:4px; font-size:12px; margin-bottom:6px;">
            <label style="font-size:10.5px; color:var(--slate); display:block; margin-bottom:2px;">Max</label>
            <input type="number" data-filter-key="${c.key}" data-filter-part="max" value="${current.max ?? ''}" style="width:100%; padding:4px 6px; border:1px solid var(--line); border-radius:4px; font-size:12px;">
          ` : `
            <label style="font-size:10.5px; color:var(--slate); display:block; margin-bottom:2px;">From</label>
            <input type="date" data-filter-key="${c.key}" data-filter-part="from" value="${current.from ?? ''}" style="width:100%; padding:4px 6px; border:1px solid var(--line); border-radius:4px; font-size:12px; margin-bottom:6px;">
            <label style="font-size:10.5px; color:var(--slate); display:block; margin-bottom:2px;">To</label>
            <input type="date" data-filter-key="${c.key}" data-filter-part="to" value="${current.to ?? ''}" style="width:100%; padding:4px 6px; border:1px solid var(--line); border-radius:4px; font-size:12px;">
          `}
        </div>
      </td>`;
    }

    return `<td><input type="text" data-filter-key="${c.key}" data-filter-part="text" value="${(current.text ?? '').replace(/"/g, '&quot;')}" placeholder="Filter…" style="width:100%; padding:3px 6px; border:1px solid var(--line); border-radius:4px; font-size:11px;"></td>`;
  }).join('')}</tr>`;
}

/** Attaches input listeners and popover open/close behavior to a freshly-rendered filter row; calls onChange() after updating the shared `filters` object. */
export function wireFilterRow(rowEl, filters, onChange) {
  if (!rowEl) return;

  // Note: the filter row intentionally does NOT use position:sticky to
  // stay visible during vertical scroll — an earlier attempt at that
  // caused the date/number popover cells to render shoved down onto the
  // row below (a CSS specificity conflict between the sticky class rule
  // and each cell's own position:relative, needed to anchor its popover).
  // Given that's a real visible-data bug, this trades away "stays visible
  // while scrolling" for guaranteed-correct layout.

  // Popover triggers: open on click, close when clicking elsewhere.
  rowEl.querySelectorAll('[data-filter-popover-trigger]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.filterPopoverTrigger;
      const panel = rowEl.querySelector(`[data-filter-popover-panel="${key}"]`);
      const isOpen = panel.style.display !== 'none';
      // Close any other open popovers in this row first.
      rowEl.querySelectorAll('.col-filter-popover').forEach((p) => { p.style.display = 'none'; });
      panel.style.display = isOpen ? 'none' : 'block';
    });
  });
  if (!document._colFilterOutsideClickBound) {
    document.addEventListener('click', () => {
      document.querySelectorAll('.col-filter-popover').forEach((p) => { p.style.display = 'none'; });
    });
    document._colFilterOutsideClickBound = true;
  }
  rowEl.querySelectorAll('.col-filter-popover').forEach((panel) => {
    panel.addEventListener('click', (e) => e.stopPropagation()); // clicking inside the popover shouldn't close it
  });

  rowEl.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.filterKey;
      const part = input.dataset.filterPart;
      filters[key] = filters[key] || {};
      if (input.value === '') delete filters[key][part];
      else filters[key][part] = input.value;
      if (Object.keys(filters[key]).length === 0) delete filters[key];
      onChange();
    });
  });
}

export function hasActiveFilters(filters) {
  return Object.keys(filters).length > 0;
}

export function clearFilters(filters) {
  for (const key of Object.keys(filters)) delete filters[key];
}

/**
 * Applies every active column filter to one row (AND across columns).
 * @param columns  optional — pass the same column definitions used to
 *                 render the filter row so explicit filterType overrides
 *                 (e.g. Qty Shift forced to text) are honored here too.
 */
export function rowPassesFilters(row, filters, columns = []) {
  const columnByKey = new Map(columns.map((c) => [c.key, c]));
  for (const [key, spec] of Object.entries(filters)) {
    const type = resolveFilterType(columnByKey.get(key) || { key });
    if (type === 'none') continue;
    // Style No is matched against its display form (which includes the
    // jump-run suffix, e.g. "LN1234(J)") when present, so both a plain
    // search and an explicit suffix search work correctly — a plain
    // search still matches via substring, since "LN1234" is contained in
    // "LN1234(J)".
    const value = key === 'styleNo' ? (row.displayStyleNo || row.styleNo) : row[key];

    if (type === 'number') {
      const num = Number(value);
      if (spec.min !== undefined && (Number.isNaN(num) || num < Number(spec.min))) return false;
      if (spec.max !== undefined && (Number.isNaN(num) || num > Number(spec.max))) return false;
    } else if (type === 'date') {
      const rowDate = typeof value === 'string' ? parsePrintedDate(value) : (value instanceof Date ? value : null);
      if (spec.from !== undefined) {
        const from = parseFilterDate(spec.from);
        if (!rowDate || !from || rowDate < from) return false;
      }
      if (spec.to !== undefined) {
        const to = parseFilterDate(spec.to);
        if (!rowDate || !to || rowDate > to) return false;
      }
    } else {
      if (spec.text !== undefined && !matchesQuery(value, spec.text)) return false;
    }
  }
  return true;
}

export function applyColumnFilters(rows, filters, columns = []) {
  if (Object.keys(filters).length === 0) return rows;
  return rows.filter((r) => rowPassesFilters(r, filters, columns));
}
