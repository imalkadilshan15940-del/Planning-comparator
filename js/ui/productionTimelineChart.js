// ui/productionTimelineChart.js
//
// A true calendar-positioned Gantt-style timeline: one row per FR printed
// date, with ST/FI/Delivery plotted at their actual calendar positions
// (not just index order), connected by a green "production" segment
// (ST→FI) and an orange/red "buffer" segment (FI→Delivery). Replaces the
// old index-based line chart entirely.
//
// Rendered directly into a container (not returned as an SVG string) since
// it needs real interactivity: the printed-date column stays fixed while
// the calendar scrolls horizontally, the calendar's date header stays
// fixed while the whole thing scrolls vertically, and hovering a row shows
// a real DOM tooltip with full detail.

const ROW_HEIGHT = 46;
const HEADER_HEIGHT = 34;
const LABEL_COL_WIDTH = 92;
const MIN_PX_PER_DAY = 16;
const MAX_CHART_HEIGHT = 420; // vertical scroll kicks in beyond this many px

function parseLocalDate(s) {
  if (!s) return null;
  const parts = String(s).split('/').map(Number);
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  return new Date(y < 100 ? 2000 + y : y, m - 1, d);
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function formatShort(d) {
  if (!d) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function tickIntervalDays(spanDays) {
  if (spanDays <= 21) return 1;
  if (spanDays <= 60) return 3;
  if (spanDays <= 120) return 7;
  return 14;
}

function formatTickLabel(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}`;
}

/**
 * @param container         element to render into (its content is fully replaced)
 * @param timeline          array of {report, stDate, fiDate, delDate, ...} — same shape already used elsewhere
 * @param options           { washType, washThresholdDays, nonWashThresholdDays }
 */
export function renderProductionTimelineChart(container, timeline, options = {}) {
  const { washType, washThresholdDays = 7, nonWashThresholdDays = 5 } = options;
  const bufferThreshold = washType === 'Wash' ? washThresholdDays : nonWashThresholdDays;

  const rows = timeline
    .map((e) => ({
      printedDate: parseLocalDate(e.report?.printedDate) || (e.report?.ingestedAt ? new Date(e.report.ingestedAt) : null),
      printedLabel: e.report?.printedDate || (e.report?.ingestedAt ? formatShort(new Date(e.report.ingestedAt)) : '—'),
      st: parseLocalDate(e.stDate),
      fi: parseLocalDate(e.fiDate),
      del: parseLocalDate(e.delDate),
      entry: e,
    }))
    .filter((r) => r.st || r.fi || r.del)
    .sort((a, b) => (a.printedDate?.getTime() || 0) - (b.printedDate?.getTime() || 0));

  if (rows.length === 0) {
    container.innerHTML = `<div style="padding:20px; color:var(--slate); font-size:12.5px; text-align:center;">Not enough date history yet to chart this style.</div>`;
    return;
  }

  const allDates = rows.flatMap((r) => [r.st, r.fi, r.del]).filter(Boolean);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
  minDate.setDate(minDate.getDate() - 1); // a day of breathing room on each side
  maxDate.setDate(maxDate.getDate() + 1);
  const totalDays = Math.max(1, daysBetween(minDate, maxDate));

  const plotWidth = Math.max(320, totalDays * MIN_PX_PER_DAY);
  const pxPerDay = plotWidth / totalDays;
  const xFor = (d) => daysBetween(minDate, d) * pxPerDay;

  const tickEvery = tickIntervalDays(totalDays);
  const ticks = [];
  for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + tickEvery)) {
    ticks.push(new Date(d));
  }

  const chartHeight = rows.length * ROW_HEIGHT;
  const needsVerticalScroll = chartHeight > MAX_CHART_HEIGHT;

  // ---------- Calendar header (date ticks) ----------
  const headerTicksHtml = ticks.map((d) => `
    <div style="position:absolute; left:${xFor(d).toFixed(1)}px; top:0; height:100%; border-left:1px solid var(--line); padding-left:3px; font-size:9.5px; color:var(--slate); white-space:nowrap;">${formatTickLabel(d)}</div>
  `).join('');

  // ---------- Per-row SVG content (bars, markers, labels) ----------
  const rowsSvg = rows.map((r, i) => {
    const y = i * ROW_HEIGHT + ROW_HEIGHT / 2;
    const parts = [];

    if (r.st && r.fi) {
      const x1 = xFor(r.st), x2 = xFor(r.fi);
      const prodDays = daysBetween(r.st, r.fi);
      parts.push(`<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="#2E7D5B" stroke-width="6" stroke-linecap="round"/>`);
      parts.push(`<text x="${((x1 + x2) / 2).toFixed(1)}" y="${y - 8}" font-size="10" text-anchor="middle" fill="#2E7D5B" font-family="Inter, sans-serif" font-weight="600">${prodDays}d</text>`);
    }
    if (r.fi && r.del) {
      const x1 = xFor(r.fi), x2 = xFor(r.del);
      const bufferDays = daysBetween(r.fi, r.del);
      const critical = bufferDays < bufferThreshold;
      const color = critical ? '#B03040' : '#B8791A';
      const xLeft = Math.min(x1, x2), xRight = Math.max(x1, x2);
      parts.push(`<line x1="${xLeft.toFixed(1)}" y1="${y}" x2="${xRight.toFixed(1)}" y2="${y}" stroke="${color}" stroke-width="6" stroke-linecap="round" ${critical ? 'stroke-dasharray="2,3"' : ''}/>`);
      parts.push(`<text x="${((x1 + x2) / 2).toFixed(1)}" y="${y - 8}" font-size="10" text-anchor="middle" fill="${color}" font-family="Inter, sans-serif" font-weight="700">${bufferDays}d</text>`);
    }
    // Markers drawn last so they sit on top of both segments.
    [['st', r.st, '#123047'], ['fi', r.fi, '#2E7D5B'], ['del', r.del, '#B8791A']].forEach(([key, d, color]) => {
      if (!d) return;
      parts.push(`<circle class="ptc-marker" data-row="${i}" data-key="${key}" cx="${xFor(d).toFixed(1)}" cy="${y}" r="5" fill="${color}" stroke="var(--panel)" stroke-width="1.5" style="cursor:pointer;"/>`);
    });

    // A faint alternating row background, drawn behind everything, for readability across many rows.
    const rowBg = i % 2 === 1 ? `<rect x="0" y="${i * ROW_HEIGHT}" width="${plotWidth}" height="${ROW_HEIGHT}" fill="var(--paper)" opacity="0.5"/>` : '';
    return rowBg + parts.join('');
  }).join('');

  // ---------- Fixed label column ----------
  const labelsHtml = rows.map((r) => `
    <div class="ptc-label-row" data-row-label style="height:${ROW_HEIGHT}px; display:flex; align-items:center; padding:0 8px; font-size:11px; font-family:'IBM Plex Mono', monospace; color:var(--ink); border-bottom:1px solid var(--line);">${r.printedLabel}</div>
  `).join('');

  container.innerHTML = `
    <div class="ptc-legend" style="display:flex; gap:16px; align-items:center; font-size:11px; color:var(--ink); margin-bottom:8px; flex-wrap:wrap;">
      <span><span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#2E7D5B; margin-right:4px;"></span>Production (ST → FI)</span>
      <span><span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#B8791A; margin-right:4px;"></span>Buffer (FI → Delivery)</span>
      <span><span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#B03040; margin-right:4px;"></span>Critical Buffer (below ${bufferThreshold}d)</span>
      <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--slate); margin-right:4px;"></span>Milestone</span>
    </div>
    <div class="ptc-body" style="display:flex; border:1px solid var(--line); border-radius:8px; overflow:hidden; max-height:${needsVerticalScroll ? MAX_CHART_HEIGHT : chartHeight + HEADER_HEIGHT}px;">
      <div class="ptc-label-col" style="flex:none; width:${LABEL_COL_WIDTH}px; overflow-y:auto; background:var(--panel); border-right:1px solid var(--line);">
        <div style="height:${HEADER_HEIGHT}px; border-bottom:1px solid var(--line); display:flex; align-items:center; padding:0 8px; font-size:10px; color:var(--slate); text-transform:uppercase; position:sticky; top:0; background:var(--panel); z-index:2;">FR Printed</div>
        <div class="ptc-label-rows">${labelsHtml}</div>
      </div>
      <div class="ptc-scroll-col" style="flex:1; overflow:auto; position:relative;">
        <div style="width:${plotWidth}px; position:relative;">
          <div class="ptc-header" style="height:${HEADER_HEIGHT}px; position:sticky; top:0; background:var(--panel); border-bottom:1px solid var(--line); z-index:1;">${headerTicksHtml}</div>
          <svg width="${plotWidth}" height="${chartHeight}" style="display:block;">${rowsSvg}</svg>
        </div>
      </div>
    </div>
  `;

  // Keep the fixed label column and the scrollable calendar moving together vertically.
  const labelCol = container.querySelector('.ptc-label-col');
  const scrollCol = container.querySelector('.ptc-scroll-col');
  let syncing = false;
  labelCol.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true; scrollCol.scrollTop = labelCol.scrollTop; syncing = false;
  });
  scrollCol.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true; labelCol.scrollTop = scrollCol.scrollTop; syncing = false;
  });

  // Hover tooltip — a single shared floating element repositioned on hover,
  // rather than relying on native SVG <title> (too limited to show the
  // full detail this needs).
  let tooltip = document.getElementById('ptc-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'ptc-tooltip';
    tooltip.style.cssText = 'position:fixed; display:none; z-index:1000; background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:8px 10px; font-size:11.5px; box-shadow:0 8px 20px rgba(0,0,0,.15); pointer-events:none; max-width:240px;';
    document.body.appendChild(tooltip);
  }
  container.querySelectorAll('.ptc-marker').forEach((marker) => {
    marker.addEventListener('mouseenter', (e) => {
      const i = Number(marker.dataset.row);
      const r = rows[i];
      const prodDays = r.st && r.fi ? daysBetween(r.st, r.fi) : null;
      const bufferDays = r.fi && r.del ? daysBetween(r.fi, r.del) : null;
      const critical = bufferDays != null && bufferDays < bufferThreshold;
      tooltip.innerHTML = `
        <div style="font-weight:700; margin-bottom:4px;">FR Printed: ${r.printedLabel}</div>
        <div>Production Start: <span class="mono">${formatShort(r.st)}</span></div>
        <div>Production Finish: <span class="mono">${formatShort(r.fi)}</span></div>
        <div>Delivery Date: <span class="mono">${formatShort(r.del)}</span></div>
        <div style="margin-top:4px;">Production Days: <b>${prodDays ?? '—'}</b></div>
        <div>Buffer Days: <b style="color:${critical ? 'var(--critical)' : 'inherit'};">${bufferDays ?? '—'}${critical ? ' (critical)' : ''}</b></div>
      `;
      tooltip.style.display = 'block';
    });
    marker.addEventListener('mousemove', (e) => {
      tooltip.style.left = `${e.clientX + 14}px`;
      tooltip.style.top = `${e.clientY + 14}px`;
    });
    marker.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  });
}
