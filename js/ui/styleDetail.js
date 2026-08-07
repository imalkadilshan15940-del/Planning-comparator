// ui/styleDetail.js

import { dbGet } from '../storage/db.js';
import { getDetailChildren } from '../storage/snapshotRepo.js';
import { el, severityBadge } from './shell.js';
import { formatDateShort } from '../shared/dateUtils.js';

function field(label, prevVal, currVal, changed) {
  return `
    <div class="detail-field">
      <div class="label">${label}</div>
      <div class="vals">
        <span class="was">${prevVal ?? '—'}</span>
        ${changed ? ` → <span class="now-changed">${currVal ?? '—'}</span>` : ` <span class="now-same">(no change)</span>`}
      </div>
    </div>
  `;
}

export async function renderStyleDetail(container, { reportId, styleKey }) {
  const report = await dbGet('reports', Number(reportId));
  const children = await getDetailChildren(Number(reportId), decodeURIComponent(styleKey));

  if (!children.length) {
    container.innerHTML = `<div class="topbar"><h1>Style Detail</h1></div><div class="empty-state card"><h3>Not found</h3></div>`;
    return;
  }

  const styleNo = children[0].styleNo;
  const worst = children.reduce((w, c) => (c.severity < w.severity ? c : w), children[0]);

  container.innerHTML = `
    <div class="topbar">
      <div>
        <a href="#/changed-styles?report=${reportId}" style="font-size:12.5px; color:var(--slate);">← Back to Changed Styles</a>
        <h1 class="mono" style="margin-top:6px;">${styleNo}</h1>
      </div>
      <div>${severityBadge(worst.severityLabel, worst.severity)}</div>
    </div>
    <p style="color:var(--slate); margin-bottom:20px;">Report: ${report.filename} (${formatDateShort(report.printedDate) || 'n/a'}) &middot; Factory ${report.factory || '—'}</p>
    <div id="detail-groups"></div>
  `;

  const groupsEl = container.querySelector('#detail-groups');
  for (const c of children) {
    const group = el(`
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 class="mono" style="font-size:14px; margin:0;">Cont/MRP: ${c.contMrp || '—'} &middot; ${c.factoryLine}</h3>
          ${severityBadge(c.severityLabel, c.severity)}
        </div>
        <div class="detail-grid">
          ${field('Production Start (ST)', c.prevValues?.stDate, c.currValues?.stDate, c.changedFields.includes('stDate'))}
          ${field('Delivery Date', c.prevValues?.delDate, c.currValues?.delDate, c.changedFields.includes('delDate'))}
          ${c.prevValues?.fiDate !== undefined ? field('Finish Date (FI)', c.prevValues?.fiDate, c.currValues?.fiDate, c.changedFields.includes('fiDate')) : ''}
          ${c.prevValues?.merchant !== undefined ? field('Merchant', c.prevValues?.merchant, c.currValues?.merchant, c.changedFields.includes('merchant')) : ''}
          ${c.delayDays ? `<div class="detail-field"><div class="label">Delay</div><div class="vals now-changed">${c.delayDays} day${Math.abs(c.delayDays) === 1 ? '' : 's'}</div></div>` : ''}
        </div>
      </div>
    `);
    groupsEl.appendChild(group);
  }
}
