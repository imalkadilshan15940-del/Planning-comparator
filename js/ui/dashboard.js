// ui/dashboard.js

import { getAllReports, getChangedStylesForReport } from '../storage/snapshotRepo.js';
import { el } from './shell.js';
import { compareReportsDesc, reportDate, formatDateShort } from '../shared/dateUtils.js';

export async function renderDashboard(container) {
  const reports = await getAllReports(); // already newest-first, date-aware

  if (reports.length === 0) {
    container.innerHTML = `
      <div class="topbar"><h1>Dashboard</h1></div>
      <div class="empty-state card"><h3>No reports yet</h3><p>Connect your Planning Reports folder in Settings to get started.</p></div>
    `;
    return;
  }

  // Most recent report per factory — reports is already sorted newest-first
  // by real date, so the first one seen per factory is correctly the latest.
  const latestByFactory = new Map();
  for (const r of reports) {
    if (!latestByFactory.has(r.factory)) latestByFactory.set(r.factory, r);
  }
  const latest = [...latestByFactory.values()];

  container.innerHTML = `
    <div class="topbar"><h1>Dashboard</h1></div>
    <div class="summary-cards" id="dash-summary">
      <div class="summary-card"><div class="n">…</div><div class="l">Total Styles</div></div>
      <div class="summary-card"><div class="n">…</div><div class="l">Changed Styles</div></div>
      <div class="summary-card critical"><div class="n">…</div><div class="l">Critical Styles</div></div>
      <div class="summary-card"><div class="n">…</div><div class="l">Unchanged</div></div>
      <div class="summary-card"><div class="n mono" style="font-size:14px;">…</div><div class="l">Newest Report</div></div>
      <div class="summary-card"><div class="n mono" style="font-size:14px;">${latest.length}</div><div class="l">Factories Reporting</div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px; font-size:15px;">By factory (latest report)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Factory</th><th>Printed</th><th>Total</th><th>Changed</th><th>Critical</th><th></th></tr></thead>
          <tbody id="dash-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  // Compute counts per factory using the same history-aware comparison as
  // Changed Styles / Reports, rather than the older single-pair numbers.
  const perFactory = [];
  for (const r of latest) {
    const rows = await getChangedStylesForReport(r.id);
    perFactory.push({
      report: r,
      total: rows.length,
      changed: rows.filter((x) => x.isChanged).length,
      critical: rows.filter((x) => x.isCritical).length,
    });
  }

  const totalStyles = perFactory.reduce((s, f) => s + f.total, 0);
  const changedStyles = perFactory.reduce((s, f) => s + f.changed, 0);
  const criticalStyles = perFactory.reduce((s, f) => s + f.critical, 0);
  const unchangedStyles = totalStyles - changedStyles;
  const newestReport = [...latest].sort(compareReportsDesc)[0];
  const newestDate = newestReport ? (formatDateShort(newestReport.printedDate) || '—') : '—';

  const summary = container.querySelector('#dash-summary');
  summary.innerHTML = `
    <div class="summary-card"><div class="n">${totalStyles}</div><div class="l">Total Styles</div></div>
    <div class="summary-card"><div class="n">${changedStyles}</div><div class="l">Changed Styles</div></div>
    <div class="summary-card critical"><div class="n">${criticalStyles}</div><div class="l">Critical Styles</div></div>
    <div class="summary-card"><div class="n">${unchangedStyles}</div><div class="l">Unchanged</div></div>
    <div class="summary-card"><div class="n mono" style="font-size:14px;">${newestDate}</div><div class="l">Newest Report</div></div>
    <div class="summary-card"><div class="n mono" style="font-size:14px;">${latest.length}</div><div class="l">Factories Reporting</div></div>
  `;

  const tbody = container.querySelector('#dash-tbody');
  for (const f of perFactory.sort((a, b) => b.critical - a.critical)) {
    tbody.appendChild(el(`
      <tr class="${f.critical > 0 ? 'row-critical' : f.changed > 0 ? 'row-changed' : ''}">
        <td><b>${f.report.factory || '—'}</b></td>
        <td class="mono">${formatDateShort(f.report.printedDate) || '—'}</td>
        <td>${f.total}</td>
        <td>${f.changed}</td>
        <td>${f.critical}</td>
        <td><a href="#/changed-styles?report=${f.report.id}" class="btn" style="text-decoration:none; display:inline-block;">Review →</a></td>
      </tr>
    `));
  }
}
