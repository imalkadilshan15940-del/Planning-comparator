// app.js — application bootstrap and hash router

import { renderShell, highlightActiveNav, updateFolderStatus, updateDataAvailabilityStatus, toast, showFetchOverlay, hideFetchOverlay, showLoading, hideLoading, nextPaint, initZoomBar, initHorizontalScrollSync, applyFontSettings, showFailedMatchPopup } from './ui/shell.js';
import { renderReports } from './ui/reports.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderAllStyles } from './ui/allStyles.js';
import { renderChangedStyles } from './ui/changedStyles.js';
import { renderChangedStyleHistory } from './ui/changedStyleHistory.js';
import { syncHistoryFromFolder } from './storage/changedStyleHistoryRepo.js';
import { syncCommentsFromFolder } from './storage/commentHistoryRepo.js';
import { syncReportsFromFolder, loadReportDataFromJson, cacheReportDataAsJson } from './storage/reportDataRepo.js';
import { syncMasterDataFromJson, getSplOpeMappingMeta } from './storage/splOpeMappingRepo.js';
import { renderStyleDetail } from './ui/styleDetail.js';
import { renderSettings } from './ui/settingsView.js';
import { renderHelp } from './ui/help.js';

import { loadSettings, saveSettings } from './settings/settingsManager.js';
import { getStoredFolderHandle, queryPermission } from './ingestion/folderAccess.js';
import { startWatching, stopWatching, scanOnce, markFileSeen, claimFileForIngestion, releaseFileFromIngestion } from './ingestion/watcher.js';
import { extractFastReactPdf, PARSER_LOGIC_VERSION } from './parser/pdfExtract.js';
import { saveIngestedReportReady, getChangedStylesForReport } from './storage/snapshotRepo.js';
import { reapplyDeliveryCorrections, getDeliveryCorrectionsMeta } from './storage/deliveryCorrectionsRepo.js';
import { downloadCsv } from './export/csvExport.js';
import { dbPut, dbGetAll } from './storage/db.js';

async function applyTheme() {
  const settings = await loadSettings();
  document.documentElement.setAttribute('data-theme', settings.theme);
  return settings;
}

function exportFailedDeliveryList(failedStyles) {
  const headers = ['Style No', 'Factory/Line', 'Tracking Number', 'Current (Original) Delivery Date'];
  const lines = [headers.join(',')];
  for (const s of failedStyles) {
    lines.push([s.styleNo, s.factoryLine, s.trackingNumber || '', s.currentDelDate || '']
      .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','));
  }
  downloadCsv(lines.join('\n'), 'failed-delivery-date-matches.csv');
}

async function reapplyDeliveryCorrectionsAndNotify() {
  const settings = await loadSettings();
  const result = await reapplyDeliveryCorrections(settings.deliveryMatchKeys);
  if (result.hasCorrections && result.failedStyles.length > 0) {
    showFailedMatchPopup(result.failedStyles, exportFailedDeliveryList);
  }
  return result;
}

async function ingestFile(fileMeta, { silent = false, skipReapply = false } = {}) {
  if (!silent) toast(`Processing ${fileMeta.name}…`, 'info');
  try {
    // Prefer a pre-parsed JSON cache (from "PDF to JSON") over re-parsing
    // the PDF directly — this is the expensive step, so reusing an
    // already-parsed result whenever one exists is what actually reduces
    // repeated parsing work. Falls back to parsing directly, and writes
    // the cache afterward, so a file that was never pre-converted still
    // works correctly the first time, and is fast on any subsequent fetch.
    let reportData = await loadReportDataFromJson(fileMeta.name);
    let warnings = [];

    if (!reportData) {
      const file = await fileMeta.handle.getFile();
      const buffer = await file.arrayBuffer();
      const result = await extractFastReactPdf(buffer, window.pdfjsLib);
      warnings = result.warnings || [];
      reportData = {
        filename: fileMeta.name,
        factory: result.factory || 'UNKNOWN',
        printedDate: result.printedDate,
        layoutVersion: result.layoutVersion,
        parserLogicVersion: PARSER_LOGIC_VERSION,
        contMrpRecords: result.contMrpRecords,
      };
      await cacheReportDataAsJson(reportData, fileMeta);
    }

    if (warnings.length) {
      await dbPut('settings', { key: 'lastParseWarnings', value: warnings });
    }

    const reportId = await saveIngestedReportReady(reportData);

    const rows = await getChangedStylesForReport(reportId, 1);
    const hasCritical = rows.some((r) => r.isCritical);
    const hasChanged = rows.some((r) => r.isChanged);
    const status = hasCritical ? 'critical' : hasChanged ? 'changed' : 'unchanged';

    if (!skipReapply) await reapplyDeliveryCorrectionsAndNotify();

    const kind = status === 'critical' ? 'error' : status === 'changed' ? 'info' : 'success';
    if (!silent) toast(`${fileMeta.name} processed — status: ${status}.`, kind);

    if (!silent && (location.hash.startsWith('#/reports') || location.hash.startsWith('#/dashboard') || location.hash === '' || location.hash === '#/')) {
      route();
    }
  } catch (err) {
    console.error(err);
    toast(`Failed to process ${fileMeta.name}: ${err.message}`, 'error');
  }
}

export async function runFetchDocuments() {
  const handle = await getStoredFolderHandle();
  if (!handle) { toast('No folder connected yet. Go to Settings first.', 'error'); return; }
  const perm = await queryPermission(handle);
  if (perm !== 'granted') { toast('Folder permission needs to be re-granted in Settings.', 'error'); return; }

  const btn = document.getElementById('fetch-documents-btn');
  if (btn) btn.disabled = true;
  showFetchOverlay('Checking for new documents…');
  const startedAt = Date.now();

  try {
    const newFiles = await scanOnce(handle);
    if (newFiles.length === 0) {
      showFetchOverlay('Checking delivery date corrections…');
    } else {
      for (let i = 0; i < newFiles.length; i++) {
        if (!claimFileForIngestion(newFiles[i].name)) continue; // already being handled (e.g. by the background watcher)
        showFetchOverlay(`Processing ${newFiles[i].name} (${i + 1} of ${newFiles.length})…`);
        try {
          await ingestFile(newFiles[i], { silent: true, skipReapply: true });
          await markFileSeen(newFiles[i]);
        } finally {
          releaseFileFromIngestion(newFiles[i].name);
        }
      }
    }
    showFetchOverlay('Applying delivery date corrections…');
    await reapplyDeliveryCorrectionsAndNotify();
    showFetchOverlay(newFiles.length > 0 ? `Done — processed ${newFiles.length} document${newFiles.length === 1 ? '' : 's'}.` : 'No new documents found.');
  } catch (err) {
    console.error(err);
    showFetchOverlay('Something went wrong — check the console for details.');
  }

  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, 3000 - elapsed);
  setTimeout(() => {
    hideFetchOverlay();
    if (btn) btn.disabled = false;
    route();
  }, remaining);

  // An explicit fetch is what resumes normal background watching if it was
  // stopped (e.g. by a reset) — restarting here is safe even if it was
  // already running, since startWatching always stops any prior interval
  // before starting a fresh one.
  await initWatcherIfPossible();
}

/**
 * The actual "Fetch Documents" button's click handler. Rather than
 * silently running the full backup+fetch+compare sequence automatically,
 * this always asks first — Yes runs all three steps in order; No runs
 * only the plain fetch, same as before, leaving PDF to JSON as something
 * the user runs manually themselves if and when they want it.
 */
async function initWatcherIfPossible() {
  const handle = await getStoredFolderHandle();
  if (!handle) {
    updateFolderStatus({ connected: false });
    return;
  }
  const perm = await queryPermission(handle);
  if (perm !== 'granted') {
    updateFolderStatus({ connected: true, folderName: handle.name, watching: false });
    return;
  }
  const settings = await loadSettings();
  startWatching(handle, ingestFile, settings.pollIntervalMs);
  updateFolderStatus({ connected: true, folderName: handle.name, watching: true });
}

function parseRoute() {
  const hash = location.hash || '#/reports';
  const [path, query] = hash.split('?');
  const parts = path.replace(/^#\//, '').split('/');
  return { name: parts[0] || 'reports', parts, query };
}

async function route() {
  const content = document.getElementById('app-content');
  const { name, parts } = parseRoute();
  highlightActiveNav(location.hash || '#/reports');

  const [dcMeta, soMeta] = await Promise.all([getDeliveryCorrectionsMeta(), getSplOpeMappingMeta()]);
  updateDataAvailabilityStatus({ deliveryCorrectionsCount: dcMeta.count, masterDataCount: soMeta.count });

  // The comparator process depends on Wash Type, which is derived from the
  // Special Operations master data — without it, STATUS-DEL and every
  // downstream calculation would be meaningless. Reports, Settings, and
  // Help stay reachable regardless (Settings is where the required upload
  // actually happens), everything else is blocked until it exists.
  const gatedRoutes = new Set(['all-styles', 'changed-styles', 'changed-style-history', 'dashboard', 'style']);
  if (gatedRoutes.has(name)) {
    if (soMeta.count === 0) {
      renderMasterDataRequiredScreen(content);
      return;
    }
  }

  showLoading('Loading…', { immediate: true });
  await nextPaint();
  try {
    if (name === 'reports' || name === '') {
      await renderReports(content);
    } else if (name === 'dashboard') {
      await renderDashboard(content);
    } else if (name === 'all-styles') {
      await renderAllStyles(content);
    } else if (name === 'changed-styles') {
      await renderChangedStyles(content);
    } else if (name === 'changed-style-history') {
      await renderChangedStyleHistory(content);
    } else if (name === 'style') {
      await renderStyleDetail(content, { reportId: parts[1], styleKey: parts[2] });
    } else if (name === 'settings') {
      await renderSettings(content, { onFolderChanged: initWatcherIfPossible, onDataReset: runFetchDocuments });
    } else if (name === 'help') {
      await renderHelp(content);
    } else {
      await renderReports(content);
    }
  } finally {
    hideLoading();
  }
}

function renderMasterDataRequiredScreen(content) {
  content.innerHTML = `
    <div class="topbar"><h1>Special Operations Master Data Required</h1></div>
    <div class="card" style="max-width:640px; margin:40px auto; text-align:center; padding:40px 32px;">
      <div style="font-size:44px; margin-bottom:12px;">⚠️</div>
      <h3 style="margin-bottom:10px;">This screen needs Wash Type data to run</h3>
      <p style="color:var(--slate); font-size:13.5px; margin-bottom:24px;">
        Wash Type — and everything that depends on it, including STATUS-DEL — is derived from the
        Special Operations (SPL OPE) master data. Until it's uploaded at least once, the comparator
        process can't produce meaningful results, so this page is unavailable.
      </p>
      <a href="#/settings" class="btn btn-primary" style="display:inline-block; text-decoration:none;">Go to Settings to upload it</a>
    </div>
  `;
}

function setBootStatus(text) {
  const el = document.getElementById('boot-status');
  if (el) el.textContent = text;
}

function showBootError(err) {
  const spinner = document.getElementById('boot-spinner');
  const errorBox = document.getElementById('boot-error');
  if (spinner) spinner.style.display = 'none';
  setBootStatus('Something went wrong on startup.');
  if (errorBox) {
    errorBox.style.display = 'block';
    errorBox.textContent = `${err.message || err}\n\nOpen the browser console (F12) for details. If this persists, check that the app is being served over http://localhost — it will not run correctly if opened as a file:// path.`;
  }
}

function hideBootScreen() {
  const boot = document.getElementById('boot-screen');
  if (boot) {
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 600);
  }
}

async function repairStuckProcessingReports() {
  // Ingestion is fully synchronous — a report should never legitimately
  // stay at 'processing' after its ingestFile() call has returned. Any
  // report still marked 'processing' here is leftover from before the fix
  // that flips this status (or from an ingest that was interrupted), and
  // would otherwise be permanently invisible/unusable. Self-heal on boot.
  const reports = await dbGetAll('reports');
  const stuck = reports.filter((r) => r.status === 'processing');
  for (const r of stuck) {
    await dbPut('reports', { ...r, status: 'ready' });
  }
  if (stuck.length > 0) console.info(`Repaired ${stuck.length} report(s) stuck at "processing".`);
}

async function main() {
  try {
    setBootStatus('Loading application shell…');
    renderShell();
    document.getElementById('fetch-documents-btn')?.addEventListener('click', runFetchDocuments);
    const applyZoom = initZoomBar(async (level) => {
      const s = await loadSettings();
      await saveSettings({ ...s, zoomLevel: level });
    });
    initHorizontalScrollSync();
    setBootStatus('Applying preferences…');
    const bootSettings = await applyTheme();
    applyZoom(bootSettings.zoomLevel || 100);
    applyFontSettings(bootSettings.fontSettings);
    window.addEventListener('hashchange', route);
    setBootStatus('Checking for interrupted reports…');
    await repairStuckProcessingReports();
    setBootStatus('Syncing Changed Style History…');
    await syncHistoryFromFolder().catch((err) => console.warn('History folder sync skipped:', err));
    await syncCommentsFromFolder().catch((err) => console.warn('Comment History folder sync skipped:', err));
    await syncReportsFromFolder().catch((err) => console.warn('Report data folder sync skipped:', err));
    await syncMasterDataFromJson().catch((err) => console.warn('Special Operations master data folder sync skipped:', err));
    setBootStatus('Loading your data…');
    await route();
    setBootStatus('Connecting to Planning Reports folder…');
    await initWatcherIfPossible();
    hideBootScreen();
    await reapplyDeliveryCorrectionsAndNotify();
    route(); // refresh the current view in case corrections changed anything visible
  } catch (err) {
    console.error('Startup failed:', err);
    showBootError(err);
  }
}

window.addEventListener('error', (evt) => {
  // Catches module load failures and other uncaught errors during boot.
  if (document.getElementById('boot-screen') && !document.getElementById('boot-screen').classList.contains('hidden')) {
    showBootError(evt.error || evt.message);
  }
});

main();
