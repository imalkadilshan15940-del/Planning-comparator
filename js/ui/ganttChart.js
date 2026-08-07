// ui/ganttChart.js
//
// Replaces the old ST/FI/Delivery line chart entirely. Built as HTML/CSS
// (not SVG) — a real scrollable grid is what makes a sticky Y-axis column,
// a sticky calendar header, and native hover tooltips all reliably
// possible at once; SVG has no native equivalent for any of the three.
//
// Layout: one row per FR printed date (oldest at top, per the docx sketch
// this was built from), calendar dates along the X-axis. Each row shows a
// production bar (ST → FI) and a vertical tick marking Delivery Date —
// deliberately not a connecting bar to FI, since Delivery is sometimes
// scheduled before Finish (an advanced Delivery meeting a pushed-back FI),
// and a plain marker has no "direction" to go wrong the way a bar would.

import { parsePrintedDate, formatDateShort, formatIsoDateShort } from '../shared/dateUtils.js';

const ROW_HEIGHT = 46;
const DAY_WIDTH = 30;
const YAXIS_WIDTH = 96;
const HEADER_HEIGHT = 34;
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * @param timeline        the style's existing timeline array (same shape
 *                         already fed to the old chart — each entry has
 *                         stDate/fiDate/delDate, report.printedDate, etc.)
 * @param options.width    total available width (left portion of the
 *                         canvas — this chart never spans full width, by
 *                         design, leaving room on the right for later).
 */
export function buildProductionTimelineChart(timeline, { width = 700 } = {}) {
  const rows = timeline
    .map((e) => ({
      printedDate: parsePrintedDate(e.report?.printedDate || e.report?.ingestedAt),
      printedDateLabel: e.report?.printedDate || e.report?.ingestedAt,
      st: parsePrintedDate(e.stDate),
      fi: parsePrintedDate(e.fiDate),
      del: parsePrintedDate(e.delDate),
      del2nd: parsePrintedDate(e.delDate2nd),
      stDate: e.stDate,
      fiDate: e.fiDate,
      delDate: e.delDate,
      delDate2nd: e.delDate2nd,
      changedFromPrev: e.changedFromPrev || {},
    }))
    .filter((r) => r.printedDate && (r.st || r.fi || r.del))
    .sort((a, b) => a.printedDate - b.printedDate); // oldest first, per the sketch (rows stack upward chronologically)

  if (rows.length === 0) {
    return `<div style="padding:20px; color:var(--slate); font-size:12.5px; text-align:center;">Not enough weeks of history yet to chart this style.</div>`;
  }

  const allDates = rows.flatMap((r) => [r.st, r.fi, r.del]).filter(Boolean);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
  minDate.setHours(0, 0, 0, 0);
  maxDate.setHours(0, 0, 0, 0);
  const totalDays = daysBetween(minDate, maxDate) + 1;
  const calendarWidth = totalDays * DAY_WIDTH;

  const xFor = (date) => daysBetween(minDate, date) * DAY_WIDTH;

  // --- Calendar header cells, one per day, month boundaries labeled ---
  let headerCells = '';
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(minDate);
    d.setDate(d.getDate() + i);
    const isMonthStart = d.getDate() === 1 || i === 0;
    headerCells += `
      <div style="position:absolute; left:${i * DAY_WIDTH}px; top:0; width:${DAY_WIDTH}px; height:${HEADER_HEIGHT}px; border-right:1px solid var(--line); box-sizing:border-box; font-size:9.5px; color:var(--slate); text-align:center; padding-top:4px; font-family:'IBM Plex Mono',monospace;">
        ${isMonthStart ? `<div style="font-weight:700; color:var(--ink);">${MONTH_ABBR[d.getMonth()]}</div>` : ''}
        <div>${d.getDate()}</div>
      </div>`;
  }

  // --- Data rows ---
  let bodyRows = '';
  rows.forEach((r) => {
    const parts = [];

    // Production bar: ST -> FI, green.
    if (r.st && r.fi) {
      const x1 = xFor(r.st), x2 = xFor(r.fi);
      const prodDays = daysBetween(r.st, r.fi);
      parts.push(`
        <div style="position:absolute; left:${x1}px; top:14px; width:${Math.max(2, x2 - x1)}px; height:8px; background:var(--success); border-radius:4px;" title="Production: ${formatDateShort(r.stDate)} → ${formatDateShort(r.fiDate)} (${prodDays} day${prodDays === 1 ? '' : 's'})"></div>
        ${(x2 - x1) > 24 ? `<div style="position:absolute; left:${x1}px; width:${x2 - x1}px; top:24px; text-align:center; font-size:9px; color:var(--success); font-weight:600;">${prodDays}d</div>` : ''}
      `);
    }

    // Delivery Date: a vertical short line, not a bar connecting to FI —
    // Delivery can land before FI (an advanced Delivery meeting a
    // pushed-back Finish), which a plain marker has no trouble showing
    // correctly regardless of which side of FI it falls on.
    if (r.del) {
      const xd = xFor(r.del);
      const gapLabel = r.fi ? daysBetween(r.fi, r.del) : null;
      parts.push(`
        <div style="position:absolute; left:${xd - 1}px; top:8px; width:2px; height:20px; background:var(--brand-blue);" title="Original Delivery (PDF): ${formatDateShort(r.delDate)}${gapLabel != null ? ` (${gapLabel >= 0 ? '+' : ''}${gapLabel}d vs FI)` : ''}"></div>
        ${gapLabel != null ? `<div style="position:absolute; left:${xd - 14}px; width:28px; top:28px; text-align:center; font-size:9px; color:var(--brand-blue); font-weight:600;">${gapLabel >= 0 ? '+' : ''}${gapLabel}d</div>` : ''}
      `);
    }

    // 2nd DEL: always shown alongside the original, regardless of which
    // calculation mode is currently active — the chart's whole purpose
    // here is letting the two be compared visually. Offset a couple
    // pixels right so both stay distinguishable even when they land on
    // the exact same calendar day.
    if (r.del2nd) {
      const xd2 = xFor(r.del2nd) + 3;
      const gapLabel2 = r.fi ? daysBetween(r.fi, r.del2nd) : null;
      parts.push(`
        <div style="position:absolute; left:${xd2 - 1}px; top:8px; width:2px; height:20px; background:var(--success);" title="2nd DEL (revised): ${formatDateShort(r.delDate2nd)}${gapLabel2 != null ? ` (${gapLabel2 >= 0 ? '+' : ''}${gapLabel2}d vs FI)` : ''}"></div>
      `);
    }

    // ST/FI milestone markers — drawn last so they sit on top of the bar.
    [['st', r.st], ['fi', r.fi]].forEach(([key, date]) => {
      if (!date) return;
      const changed = r.changedFromPrev[`${key}Date`];
      const x = xFor(date);
      parts.push(`<div style="position:absolute; left:${x - 4}px; top:13px; width:9px; height:9px; border-radius:50%; background:${changed ? 'var(--critical)' : 'var(--brand-blue-dark)'}; border:1.5px solid var(--panel);"></div>`);
    });

    const rowLabel = r.printedDateLabel ? (formatDateShort(r.printedDateLabel) !== r.printedDateLabel ? formatDateShort(r.printedDateLabel) : (formatIsoDateShort(r.printedDateLabel) || r.printedDateLabel)) : '—';
    const tooltipParts = [
      `FR Printed: ${rowLabel}`,
      r.stDate ? `Start: ${formatDateShort(r.stDate)}` : null,
      r.fiDate ? `Finish: ${formatDateShort(r.fiDate)}` : null,
      r.delDate ? `Delivery: ${formatDateShort(r.delDate)}` : null,
      r.st && r.fi ? `Production: ${daysBetween(r.st, r.fi)} days` : null,
      r.fi && r.del ? `Delivery vs Finish: ${daysBetween(r.fi, r.del)} days` : null,
    ].filter(Boolean).join('\n');

    bodyRows += `
      <div style="position:relative; height:${ROW_HEIGHT}px; border-bottom:1px solid var(--line);" title="${tooltipParts.replace(/"/g, '&quot;')}">
        <div style="position:sticky; left:0; z-index:1; float:left; width:${YAXIS_WIDTH}px; height:${ROW_HEIGHT}px; background:var(--panel); border-right:1px solid var(--line); display:flex; align-items:center; padding-left:10px; box-sizing:border-box; font-size:11px; font-family:'IBM Plex Mono',monospace; color:var(--ink);">
          ${rowLabel}
        </div>
        <div style="position:relative; margin-left:${YAXIS_WIDTH}px; height:${ROW_HEIGHT}px; width:${calendarWidth}px;">
          ${parts.join('')}
        </div>
      </div>`;
  });

  const totalGridWidth = YAXIS_WIDTH + calendarWidth;

  return `
    <div style="max-width:${width}px;">
      <div style="display:flex; gap:14px; align-items:center; font-size:11px; color:var(--slate); margin-bottom:8px; flex-wrap:wrap;">
        <span><span style="display:inline-block; width:10px; height:10px; background:var(--success); border-radius:2px; vertical-align:middle;"></span> Production (ST → FI)</span>
        <span><span style="display:inline-block; width:2px; height:12px; background:var(--brand-blue); vertical-align:middle;"></span> Original Delivery (PDF)</span>
        <span><span style="display:inline-block; width:2px; height:12px; background:var(--success); vertical-align:middle;"></span> 2nd DEL (revised)</span>
        <span><span style="display:inline-block; width:9px; height:9px; background:var(--brand-blue-dark); border-radius:50%; vertical-align:middle;"></span> ST / FI Milestone</span>
      </div>
      <div class="gantt-scroll-container" style="border:1px solid var(--line); border-radius:8px; overflow:scroll; max-height:${HEADER_HEIGHT + ROW_HEIGHT * Math.min(rows.length, 14) + 10}px; max-width:100%;">
        <div style="width:${totalGridWidth}px;">
          <div style="position:sticky; top:0; z-index:2; height:${HEADER_HEIGHT}px; background:var(--panel);">
            <div style="position:sticky; left:0; z-index:3; float:left; width:${YAXIS_WIDTH}px; height:${HEADER_HEIGHT}px; background:var(--brand-blue-tint); border-right:1px solid var(--line); border-bottom:1px solid var(--line); display:flex; align-items:center; padding-left:10px; box-sizing:border-box; font-size:10px; font-weight:700; color:var(--brand-blue-dark); text-transform:uppercase;">
              FR Printed
            </div>
            <div style="position:relative; margin-left:${YAXIS_WIDTH}px; height:${HEADER_HEIGHT}px; width:${calendarWidth}px; background:var(--panel); border-bottom:1px solid var(--line);">
              ${headerCells}
            </div>
          </div>
          ${bodyRows}
        </div>
      </div>
    </div>
  `;
}
