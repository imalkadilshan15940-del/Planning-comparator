// ui/factoryLineMovementModal.js
//
// Factory & Line Movement Chart — a popup triggered from All Styles'
// search box. Shows the full history of which factory and line a style
// has run on, across every planning report on record (not lookback-
// limited), so a genuine relocation pattern is visible even if it
// happened many weeks ago.

import { getFactoryLineMovementHistory } from '../storage/snapshotRepo.js';
import { formatDateShort } from '../shared/dateUtils.js';

const MOVEMENT_STYLE = {
  first: { color: 'var(--slate)', label: 'First record (no prior to compare)' },
  none: { color: 'var(--slate)', label: 'No change' },
  line: { color: 'var(--brand-blue)', label: 'Line change' },
  factory: { color: 'var(--warning)', label: 'Factory change' },
  'factory-and-line': { color: 'var(--critical)', label: 'Factory & Line change' },
};

let currentEscHandler = null;

function closeModal() {
  const overlay = document.getElementById('flm-overlay');
  if (!overlay) return;
  overlay.classList.remove('flm-open');
  setTimeout(() => overlay.remove(), 200);
  if (currentEscHandler) {
    document.removeEventListener('keydown', currentEscHandler);
    currentEscHandler = null;
  }
}

function buildChartSvg(entries) {
  const W = Math.max(560, entries.length * 90 + 120);
  const rowH = 40;
  const lanes = [...new Set(entries.map((e) => `${e.factory} - ${e.line}`))].sort();
  const H = lanes.length * rowH + 50;
  const laneY = (label) => 30 + lanes.indexOf(label) * rowH + rowH / 2;
  const leftPad = 160;
  const rightPad = 30;
  const plotW = W - leftPad - rightPad;
  const xFor = (i) => leftPad + (entries.length === 1 ? plotW / 2 : (i / (entries.length - 1)) * plotW);

  const laneLines = lanes.map((label, i) => `
    <line x1="${leftPad}" y1="${30 + i * rowH + rowH / 2}" x2="${W - rightPad}" y2="${30 + i * rowH + rowH / 2}" stroke="var(--line)" stroke-width="1" />
    <text x="${leftPad - 12}" y="${30 + i * rowH + rowH / 2 + 4}" text-anchor="end" font-size="11.5" fill="var(--ink)">${label}</text>
  `).join('');

  const segments = [];
  const points = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const label = `${e.factory} - ${e.line}`;
    const x = xFor(i);
    const y = laneY(label);
    const style = MOVEMENT_STYLE[e.movementType] || MOVEMENT_STYLE.none;

    if (i > 0) {
      const prevLabel = `${entries[i - 1].factory} - ${entries[i - 1].line}`;
      const px = xFor(i - 1);
      const py = laneY(prevLabel);
      // A step path, not a straight diagonal — moves horizontally to the
      // new date first, then vertically to the new lane, so a factory/line
      // change reads as a clean, deliberate "step" rather than a diagonal
      // slide that could visually suggest a gradual, non-existent transition.
      const midX = px + (x - px) / 2;
      segments.push(`<path d="M ${px} ${py} L ${midX} ${py} L ${midX} ${y} L ${x} ${y}" fill="none" stroke="${style.color}" stroke-width="2.5" />`);
    }

    const tooltip = `Printed: ${formatDateShort(e.printedDate) || e.printedDate}\nFactory: ${e.factory}\nLine: ${e.line}\nStyle: ${e.displayStyleNo || e.styleNo}\nTracking: ${e.trackingNumber || '—'}`;
    points.push(`
      <circle cx="${x}" cy="${y}" r="6" fill="${style.color}" stroke="var(--panel)" stroke-width="2">
        <title>${tooltip}</title>
      </circle>
    `);

    segments.push(`<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--slate)">${formatDateShort(e.printedDate) || e.printedDate}</text>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="font-family:inherit;">
    ${laneLines}
    ${segments.join('')}
    ${points.join('')}
  </svg>`;
}

function buildLegendHtml() {
  return `
    <div style="display:flex; flex-wrap:wrap; gap:14px; padding:10px 0; font-size:12px; color:var(--ink);">
      ${Object.entries(MOVEMENT_STYLE).filter(([k]) => k !== 'first').map(([, s]) => `
        <span style="display:flex; align-items:center; gap:6px;">
          <span style="width:10px; height:10px; border-radius:50%; background:${s.color}; display:inline-block;"></span>
          ${s.label}
        </span>
      `).join('')}
    </div>
  `;
}

/**
 * Fetches and shows the movement chart for a Style Number or Tracking
 * Number. Shows nothing if the search term is too short to be meaningful;
 * shows the "no history" message if genuinely no records match.
 */
export async function showFactoryLineMovementChart(searchTerm) {
  const term = String(searchTerm || '').trim();
  if (term.length < 3) return; // avoid firing on every single keystroke of a short partial term

  const entries = await getFactoryLineMovementHistory(term);

  const existing = document.getElementById('flm-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'flm-overlay';
  overlay.className = 'flm-overlay';

  if (!entries) {
    overlay.innerHTML = `
      <div class="flm-modal" style="max-width:440px;">
        <button class="flm-close" aria-label="Close">&times;</button>
        <div style="padding:32px 24px; text-align:center;">
          <div style="font-size:32px; margin-bottom:8px;">📍</div>
          <p style="color:var(--ink); font-size:14px;">No factory or line movement history available for this style.</p>
        </div>
      </div>
    `;
  } else {
    const first = entries[0];
    overlay.innerHTML = `
      <div class="flm-modal">
        <button class="flm-close" aria-label="Close">&times;</button>
        <div style="padding:22px 26px 8px;">
          <h3 style="margin:0 0 4px; font-size:16px; color:var(--brand-blue-dark);">Factory &amp; Line Movement</h3>
          <div style="font-size:12.5px; color:var(--slate);">
            Style: <b>${first.displayStyleNo || first.styleNo}</b>
            &middot; Tracking: <b>${first.trackingNumber || '—'}</b>
            &middot; ${entries.length} report${entries.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style="padding:0 26px; overflow-x:auto;">
          ${buildChartSvg(entries)}
        </div>
        <div style="padding:0 26px 18px;">
          ${buildLegendHtml()}
        </div>
      </div>
    `;
  }

  document.body.appendChild(overlay);
  // Trigger the fade-in/zoom-in animation on the next frame, after the
  // element has actually been inserted with its initial (closed) state.
  requestAnimationFrame(() => overlay.classList.add('flm-open'));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  overlay.querySelector('.flm-close').addEventListener('click', closeModal);

  if (currentEscHandler) document.removeEventListener('keydown', currentEscHandler);
  currentEscHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', currentEscHandler);
}
