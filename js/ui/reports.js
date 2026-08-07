// ui/reports.js
// Every report's status here reflects each of its styles compared against
// a configurable baseline in its own prior history for that factory: the
// immediately-previous report by default, N reports back, or every prior
// report ("All" — compares against the very first/oldest one on record).
// Ordering is always by Printed Date (see shared/dateUtils.js).

import { getAllReports, getChangedStylesForReport } from '../storage/snapshotRepo.js';
import { loadSettings, saveSettings } from '../settings/settingsManager.js';
import { el, toast, showLoading, hideLoading, showConfirmDialog } from './shell.js';
import { convertAllPdfsToJson, clearReportDataCache } from '../storage/reportDataRepo.js';
import { reportDate, formatDateShort } from '../shared/dateUtils.js';
import { rowMatchesQuery } from '../shared/searchMatch.js';

const STATUS_BADGE = {
  critical: '<span class="badge" style="background:var(--critical);">Critical</span>',
  changed: '<span class="badge" style="background:var(--warning);">Changed</span>',
  unchanged: '<span class="badge" style="background:var(--slate-soft);">Unchanged</span>',
  baseline: '<span class="badge" style="background:var(--brand-blue);">Baseline</span>',
  processing: '<span class="badge" style="background:var(--slate-soft);">Processing…</span>',
};

export async function renderReports(container) {
  const settings = await loadSettings();
  const lookback = settings.reportsLookback || { mode: 'count', count: 1 };
  const allReports = await getAllReports(); // newest-first, real date order
  const factories = [...new Set(allReports.map((r) => r.factory).filter(Boolean))].sort();
  // Search text and the factory filter are local to this call, so they
  // naturally reset to defaults on every fresh visit to this page.
  let factoryFilter = 'ALL';
  let searchQuery = '';
  const reports = allReports;

  container.innerHTML = `
    <div class="topbar">
      <h1>Reports</h1>
      <div style="color:var(--slate); font-size:13px;">${reports.length} document${reports.length === 1 ? '' : 's'} ingested</div>
    </div>

    <div class="card" style="margin-bottom:14px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
      <button class="btn" id="rp-pdf-to-json" title="Parses every PDF in your connected folder into a cached JSON file — click this before Fetch Documents so Fetch can load from the cache instead of re-parsing each PDF directly. Skips files whose cache is already up to date.">PDF to JSON</button>
      <button class="btn" id="rp-clear-cache" title="Deletes every cached JSON file on disk, forcing every PDF to be genuinely re-parsed on the next PDF to JSON or Fetch Documents — without touching your ingested report history. A stale cache is normally caught automatically, but this forces certainty.">Clear PDF Cache</button>
      <span style="font-size:11.5px; color:var(--slate);">Parses PDFs into cached JSON files, ready for Fetch Documents to load quickly — works even with no reports ingested yet.</span>
    </div>

    ${reports.length === 0 ? `
      <div class="empty-state card">
        <h3>No reports yet</h3>
        <p>Connect your Planning Reports folder in Settings, or drop a PDF into it once connected — it will appear here automatically.</p>
      </div>
    ` : `
      <div class="card" style="margin-bottom:14px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
        <label style="font-size:13px; color:var(--ink); display:flex; align-items:center; gap:8px;">
          Compare each report against
          <input type="number" id="rp-lookback-count" min="1" max="99" value="${lookback.count || 1}"
            style="width:56px; padding:5px 8px; border:1px solid var(--line); border-radius:6px;" ${lookback.mode === 'all' ? 'disabled' : ''}>
          previous report${(lookback.count || 1) === 1 ? '' : 's'}
        </label>
        <label style="display:flex; align-items:center; gap:6px; font-size:13px; color:var(--ink);">
          <input type="checkbox" id="rp-lookback-all" ${lookback.mode === 'all' ? 'checked' : ''}>
          All previous reports (compare against the very first one on record)
        </label>
        <select id="rp-factory" class="btn"><option value="ALL">All factories</option>${factories.map((f) => `<option value="${f}">${f}</option>`).join('')}</select>
        <div class="search-box" style="min-width:200px;"><input id="rp-search" type="text" placeholder="Search filename… (end with % for exact)"></div>
        <span style="font-size:11.5px; color:var(--slate);">Ordered by Printed Date</span>
      </div>

      <div id="reports-groups"></div>
    `}
  `;

  container.querySelector('#rp-pdf-to-json').addEventListener('click', async () => {
    showLoading('Converting PDFs to JSON…');
    try {
      const result = await convertAllPdfsToJson();
      if (result.reason) {
        toast(result.reason, 'error');
      } else {
        const parts = [];
        if (result.converted > 0) parts.push(`${result.converted} converted`);
        if (result.skipped > 0) parts.push(`${result.skipped} already up to date`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        toast(parts.length ? parts.join(', ') + '.' : 'No PDFs found in the connected folder.', result.failed > 0 ? 'error' : 'success');
      }
    } finally {
      hideLoading();
    }
  });

  container.querySelector('#rp-clear-cache').addEventListener('click', () => {
    showConfirmDialog(
      {
        title: 'Clear PDF cache?',
        message: 'This deletes every cached JSON file on disk, so the next PDF to JSON or Fetch Documents genuinely re-parses everything from the source PDFs.\n\nYour ingested report history stays untouched — this only clears the cache, not the database.',
        yesLabel: 'Yes, clear it',
        noLabel: 'Cancel',
      },
      async () => {
        showLoading('Clearing PDF cache…');
        try {
          const result = await clearReportDataCache();
          toast(`Cleared ${result.cleared} cached file${result.cleared === 1 ? '' : 's'}.`, 'success');
        } finally {
          hideLoading();
        }
      },
      () => {},
    );
  });

  if (reports.length === 0) return;

  const countInput = container.querySelector('#rp-lookback-count');
  const allCheckbox = container.querySelector('#rp-lookback-all');
  const factorySelect = container.querySelector('#rp-factory');
  const searchInput = container.querySelector('#rp-search');

  const persistAndRefresh = async () => {
    const newLookback = allCheckbox.checked
      ? { mode: 'all', count: Number(countInput.value) || 1 }
      : { mode: 'count', count: Math.max(1, Number(countInput.value) || 1) };
    await saveSettings({ ...settings, reportsLookback: newLookback });
    renderReports(container);
  };

  const applyFilters = () => {
    let filtered = factoryFilter === 'ALL' ? reports : reports.filter((r) => r.factory === factoryFilter);
    if (searchQuery) filtered = filtered.filter((r) => rowMatchesQuery(r, ['filename'], searchQuery));
    renderGroups(container, filtered, lookback);
  };

  countInput.addEventListener('change', persistAndRefresh);
  allCheckbox.addEventListener('change', () => {
    countInput.disabled = allCheckbox.checked;
    persistAndRefresh();
  });
  factorySelect.addEventListener('change', () => {
    factoryFilter = factorySelect.value;
    applyFilters();
  });
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilters();
  });

  await renderGroups(container, reports, lookback);
}

async function renderGroups(container, reports, lookback) {
  const host = container.querySelector('#reports-groups');
  host.innerHTML = '';

  if (reports.length === 0) {
    host.appendChild(el(`<div class="empty-state card"><h3>No reports match your search/filter.</h3></div>`));
    return;
  }

  const byFactory = new Map();
  for (const r of reports) {
    const list = byFactory.get(r.factory || 'Unknown') || [];
    list.push(r);
    byFactory.set(r.factory || 'Unknown', list);
  }

  for (const [factory, factoryReports] of [...byFactory.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const section = el(`
      <div class="card" style="margin-bottom:16px; padding:0; overflow:hidden;">
        <div style="padding:12px 18px; background:var(--brand-blue-tint); border-bottom:1px solid var(--line);">
          <h3 style="margin:0; font-size:14.5px; color:var(--brand-blue-dark);">Factory ${factory}</h3>
        </div>
        <div class="table-wrap" style="border:none; border-radius:0;">
          <table>
            <thead><tr>
              <th>Filename</th><th>Factory</th><th>Printed</th><th>History</th><th>Changed / Total</th><th>Status</th><th></th></tr></thead>
              <tbody></tbody>
          </table>
        </div>
      </div>
    `);
    host.appendChild(section);
    await renderRows(section.querySelector('tbody'), factoryReports, reports, lookback);
  }
}

async function renderRows(tbody, reports, allReportsForPrior, lookback) {
  const lookbackArg = lookback.mode === 'all' ? 'all' : (lookback.count || 1);

  for (const r of reports) {
    if (r.status === 'processing') {
      tbody.appendChild(el(`
        <tr>
          <td class="mono">${r.filename}</td><td>${r.factory || '—'}</td><td class="mono">${formatDateShort(r.printedDate) || '—'}</td>
          <td>—</td><td>—</td><td>${STATUS_BADGE.processing}</td><td></td>
        </tr>
      `));
      continue;
    }

    const priorReports = allReportsForPrior.filter((other) => other.factory === r.factory && other.id !== r.id && other.status !== 'processing'
      && reportDate(other) && reportDate(r) && reportDate(other) < reportDate(r));
    const priorCount = priorReports.length;

    let total = 0, changed = 0, critical = 0, status = 'baseline';
    if (priorCount > 0) {
      const rows = await getChangedStylesForReport(r.id, lookbackArg);
      total = rows.length;
      changed = rows.filter((x) => x.isChanged).length;
      critical = rows.filter((x) => x.isCritical).length;
      status = critical > 0 ? 'critical' : changed > 0 ? 'changed' : 'unchanged';
    } else {
      total = (await getChangedStylesForReport(r.id)).length;
    }

    let historyLabel;
    if (priorCount === 0) {
      historyLabel = `<span style="color:var(--slate); font-size:12px;">— no prior report —</span>`;
    } else if (lookback.mode === 'all') {
      historyLabel = `<span class="mono" style="font-size:12px;">vs oldest of ${priorCount} prior report${priorCount === 1 ? '' : 's'}</span>`;
    } else {
      const effectiveBack = Math.min(lookback.count || 1, priorCount);
      historyLabel = `<span class="mono" style="font-size:12px;">vs ${effectiveBack} report${effectiveBack === 1 ? '' : 's'} back${effectiveBack < (lookback.count || 1) ? ' (all available)' : ''}</span>`;
    }

    const row = el(`
      <tr class="${status === 'critical' ? 'row-critical' : status === 'changed' ? 'row-changed' : ''}">
        <td class="mono">${r.filename}</td>
        <td>${r.factory || '—'}</td>
        <td class="mono">${formatDateShort(r.printedDate) || '—'}</td>
        <td>${historyLabel}</td>
        <td>${changed} / ${total}</td>
        <td>${STATUS_BADGE[status]}</td>
        <td><a href="#/changed-styles?report=${r.id}" class="btn" style="text-decoration:none; display:inline-block;">Open →</a></td>
      </tr>
    `);
    tbody.appendChild(row);
  }
}
