// ui/settingsView.js

import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../settings/settingsManager.js';
import { isFileSystemAccessSupported, pickFolder, getStoredFolderHandle, getStoredFolderName, queryPermission, requestPermission } from '../ingestion/folderAccess.js';
import { dbGet, dbClearAll } from '../storage/db.js';
import { toast, applyFontSettings, showFailedMatchPopup, showLoading, hideLoading, showConfirmDialog } from './shell.js';
import { stopWatching } from '../ingestion/watcher.js';
import { clearReportDataCache } from '../storage/reportDataRepo.js';
import { saveDeliveryCorrections, getDeliveryCorrectionsMeta, reapplyDeliveryCorrections, resetAllDeliveryCorrections } from '../storage/deliveryCorrectionsRepo.js';
import { parseCorrectionsFile } from '../import/parseCorrectionsFile.js';
import { downloadCorrectionTemplateXlsx, downloadCorrectionTemplateCsv } from '../export/correctionTemplate.js';
import { saveSplOpeMapping, getSplOpeMappingMeta, getUnmatchedSplOpeCodes, resetSplOpeMapping } from '../storage/splOpeMappingRepo.js';
import { parseSplOpeMasterFile } from '../import/parseSplOpeMasterFile.js';
import { downloadCsv } from '../export/csvExport.js';

const FONT_OPTIONS = [
  { value: "'Inter', sans-serif", label: 'Inter (default)' },
  { value: "'Zilla Slab', serif", label: 'Zilla Slab' },
  { value: "'IBM Plex Mono', monospace", label: 'IBM Plex Mono' },
  { value: "Georgia, serif", label: 'Georgia' },
  { value: "Arial, sans-serif", label: 'Arial' },
  { value: "Verdana, sans-serif", label: 'Verdana' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: "'Courier New', monospace", label: 'Courier New' },
];
const FONT_GROUPS = { title: 'Page Titles', header: 'Table Headers', sidebar: 'Sidebar Names', data: 'Row Data' };

const STATUS_LABELS = {
  'TIGH PRO-PSD': 'TIGH PRO-PSD',
  'CHANGED-FI/DEL': 'CHANGED-FI/DEL',
  'UNCHANGED-PSD': 'UNCHANGED-PSD',
  'NOT PRE DATA': 'NOT PRE DATA',
  'NEW': 'NEW',
};
const QTY_SHIFT_LABELS = { full: 'Full Shift', balance: 'Balance Shift', increased: 'Qty Increased' };
const STATUS_DEL_LABELS = { 'SAFE': 'SAFE', 'CRITICAL-DEL': 'CRITICAL-DEL' };

function exportFailedList(failedStyles) {
  const headers = ['Style No', 'Factory/Line', 'Tracking Number', 'Current (Original) Delivery Date'];
  const lines = [headers.join(',')];
  for (const s of failedStyles) {
    lines.push([s.styleNo, s.factoryLine, s.trackingNumber || '', s.currentDelDate || '']
      .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','));
  }
  downloadCsv(lines.join('\n'), 'failed-delivery-date-matches.csv');
}

function exportUnmatchedSplOpeCodes(unmatched) {
  const headers = ['SPL OPE Code', 'Style No', 'Factory/Line', 'Tracking Number'];
  const lines = [headers.join(',')];
  for (const s of unmatched) {
    lines.push([s.splOpeCode, s.styleNo, s.factoryLine || '', s.trackingNumber || '']
      .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spl-ope-unmatched-codes.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export async function renderSettings(container, { onFolderChanged, onDataReset } = {}) {
  const settings = await loadSettings();
  const folderName = await getStoredFolderName();
  const warnRec = await dbGet('settings', 'lastParseWarnings');
  const warnings = warnRec ? warnRec.value : [];

  container.innerHTML = `
    <div class="topbar"><h1>Settings</h1></div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Planning Reports Folder</h3>
      ${!isFileSystemAccessSupported() ? `<div class="warn-banner">This browser doesn't support the File System Access API. Use a Chromium-based browser (Chrome or Edge) to enable folder watching.</div>` : ''}
      <p style="color:var(--slate); font-size:13px;">Currently connected: <b>${folderName || 'none'}</b></p>
      <div class="btn-row">
        <button class="btn btn-primary" id="connect-folder">Connect / Re-select Folder</button>
        <button class="btn" id="regrant-folder">Re-grant Permission</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Matching &amp; Thresholds</h3>
      <p style="color:var(--slate); font-size:12.5px; margin-bottom:6px;">
        Matching happens at <b>Style No + Tracking No + Line</b>. ST movement drives
        STATUS-PSD through the thresholds below — Delivery Threshold controls how much
        Delivery can extend before it no longer counts as compensating for a late ST.
      </p>
      <div class="field-row">
        <label>ST Threshold (days)</label>
        <input type="number" id="st-threshold" min="0" max="60" value="${settings.stThresholdDays}" style="width:70px; padding:5px 8px; border:1px solid var(--line); border-radius:6px;">
      </div>
      <div class="field-row">
        <label>Delivery Threshold (days)</label>
        <input type="number" id="delivery-threshold" min="0" max="60" value="${settings.deliveryThresholdDays}" style="width:70px; padding:5px 8px; border:1px solid var(--line); border-radius:6px;">
      </div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">STATUS-PSD Colors</h3>
      <div id="status-colors-list"></div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">STATUS-DEL Thresholds &amp; Colors</h3>
      <p style="color:var(--slate); font-size:12.5px; margin-bottom:6px;">
        Independent of STATUS-PSD. <b>GAP OF FI &amp; DEL</b> = Delivery Date − FI.
        If the gap is below the threshold for that style's Wash Type, STATUS-DEL is
        CRITICAL-DEL — and it's this status, not STATUS-PSD, that drives the row
        highlighting on All Styles and Changed Styles.
      </p>
      <div class="field-row">
        <label>Wash Threshold (days)</label>
        <input type="number" id="wash-threshold" min="0" max="60" value="${settings.washThresholdDays}" style="width:70px; padding:5px 8px; border:1px solid var(--line); border-radius:6px;">
      </div>
      <div class="field-row">
        <label>Non Wash Threshold (days)</label>
        <input type="number" id="non-wash-threshold" min="0" max="60" value="${settings.nonWashThresholdDays}" style="width:70px; padding:5px 8px; border:1px solid var(--line); border-radius:6px;">
      </div>
      <div id="status-del-colors-list"></div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Qty Shift Colors</h3>
      <p style="color:var(--slate); font-size:12.5px; margin-bottom:6px;">Used on the Changed Styles page to distinguish a full order re-date from a partial (balance) reschedule.</p>
      <div id="qty-colors-list"></div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Typography</h3>
      <p style="color:var(--slate); font-size:12.5px; margin-bottom:6px;">Font and size, adjustable separately for each part of the interface.</p>
      <div id="font-list"></div>
      <button class="btn" id="font-reset" style="margin-top:8px;">Reset to Defaults</button>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Appearance &amp; Refresh</h3>
      <div class="field-row">
        <label>Theme</label>
        <div class="toggle-group" id="theme-toggle">
          <button data-theme="light" class="${settings.theme === 'light' ? 'active' : ''}">Light</button>
          <button data-theme="dark" class="${settings.theme === 'dark' ? 'active' : ''}">Dark</button>
        </div>
      </div>
      <div class="field-row">
        <label>Folder poll interval (seconds)</label>
        <input type="number" id="poll-interval" min="3" max="120" value="${Math.round(settings.pollIntervalMs / 1000)}" style="width:70px; padding:5px 8px; border:1px solid var(--line); border-radius:6px;">
      </div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Split Production Runs</h3>
      <p style="color:var(--slate); font-size:12.5px; margin-bottom:10px;">
        When the same Style+Tracking+Line is interrupted by another style's production and resumes
        later, each continuous run is kept as its own separate record — Start/Finish reflect that
        one run's actual dates, not a min/max span stretched across the interruption. Choose how
        each run gets identified:
      </p>
      <label style="display:flex; align-items:flex-start; gap:8px; margin-bottom:10px; cursor:pointer;">
        <input type="radio" name="run-id-source" id="run-id-system" style="margin-top:3px;">
        <span>
          <b>System identification number</b> — assigned automatically (1st run, 2nd run, ...), works
          today with no changes to your source file.
        </span>
      </label>
      <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer;">
        <input type="radio" name="run-id-source" id="run-id-lot" style="margin-top:3px;">
        <span>
          <b>Lot Number</b> — uses the source PDF's own Lot Number column once your report format
          includes it. Until then this has no column to read and falls back to the system number
          automatically, so nothing breaks by turning it on early.
        </span>
      </label>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Delivery Date Corrections</h3>
      <p style="color:var(--slate); font-size:12.5px; margin-bottom:10px;">
        If another department's report has the correct Delivery Date, upload it here — matched by
        Style Number (always) plus whichever of these you enable below, and applied wherever the
        PDF's Delivery Date is shown. Runs automatically on Fetch Documents and whenever you open
        the app. Expects the document date in cell <b>B3</b>, headers at <b>row 5</b>, and data
        from <b>row 6</b> onward — which columns hold which field is configured below, so a
        re-ordered export of the same report is a Settings change, not a code change.
      </p>
      <div class="field-row"><label>Style Number</label><span class="pill" style="background:var(--success-tint); color:var(--success);">Always used</span></div>
      <div class="field-row"><label>Tracking Number</label><input type="checkbox" id="dm-tracking"></div>
      <div class="field-row"><label>Factory + Line</label><input type="checkbox" id="dm-factoryline"></div>

      <div style="margin:12px 0; padding:10px 12px; background:var(--paper); border-radius:8px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.3px; color:var(--slate); margin-bottom:8px;">Column letters in the uploaded file</div>
        <div style="display:grid; grid-template-columns:repeat(5,1fr); gap:10px;">
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Style Number</label><input type="text" id="dtc-styleNo" maxlength="2" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px; text-transform:uppercase;"></div>
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Tracking No</label><input type="text" id="dtc-trackingNumber" maxlength="2" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px; text-transform:uppercase;"></div>
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Factory</label><input type="text" id="dtc-factory" maxlength="2" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px; text-transform:uppercase;"></div>
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Line No</label><input type="text" id="dtc-lineNo" maxlength="2" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px; text-transform:uppercase;"></div>
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Delivery Date</label><input type="text" id="dtc-deliveryDate" maxlength="2" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px; text-transform:uppercase;"></div>
        </div>
      </div>

      <p id="dc-status" style="font-size:12.5px; color:var(--slate); margin:12px 0 8px;">Loading…</p>

      <div class="btn-row" style="margin-bottom:10px;">
        <button class="btn" id="dc-template-xlsx">Download Template (Excel)</button>
        <button class="btn" id="dc-template-csv">Download Template (CSV)</button>
      </div>

      <div class="field-row" style="align-items:flex-start;">
        <label style="padding-top:8px;">Upload corrections file</label>
        <div>
          <input type="file" id="dc-file-input" accept=".xlsx,.xls,.csv" style="margin-bottom:8px;">
          <div class="toggle-group" id="dc-mode-toggle">
            <button data-mode="merge" class="active">Merge with existing</button>
            <button data-mode="replace">Replace all</button>
          </div>
        </div>
      </div>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn btn-primary" id="dc-upload">Upload &amp; Apply</button>
        <button class="btn" id="dc-export-failed">Export Failed Match List</button>
        <button class="btn" id="dc-reset" style="color:var(--critical);">Reset Delivery Date</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Special Operations Master Data (Wash Type)</h3>
      <p style="color:var(--slate); font-size:12.5px; margin-bottom:10px;">
        Wash Type is derived from the <b>SPL OPE</b> code extracted from each planning PDF —
        looked up against the master data uploaded here, not from Style Number. Upload only when
        the master list changes; once uploaded, it's stored permanently and stays available across
        browser restarts. Matching ignores case and all spaces, so <span class="mono">ABC</span>,
        <span class="mono">abc</span>, and <span class="mono">A B C</span> are all treated as the
        same code. A code with no match in the master data defaults to <b>Non Wash</b> rather than
        stopping processing, and is listed below so you can add it to the master file if needed.
        Applies automatically to All Styles and Changed Styles whenever a new PDF is processed or
        this master file is updated — nothing to manually recalculate.
      </p>

      <div style="margin:12px 0; padding:10px 12px; background:var(--paper); border-radius:8px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.3px; color:var(--slate); margin-bottom:8px;">Column letters in the uploaded file</div>
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px;">
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Special Operations Code</label><input type="text" id="so-splOpeCode" maxlength="2" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px; text-transform:uppercase;"></div>
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Wash Status</label><input type="text" id="so-washStatus" maxlength="2" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px; text-transform:uppercase;"></div>
          <div><label style="font-size:11.5px; color:var(--slate); display:block; margin-bottom:3px;">Data starts at row</label><input type="number" id="so-dataStartRow" min="1" style="width:100%; padding:5px 8px; border:1px solid var(--line); border-radius:6px;"></div>
        </div>
      </div>

      <p id="so-status" style="font-size:12.5px; color:var(--slate); margin:12px 0 8px;">Loading…</p>

      <div class="field-row" style="align-items:flex-start;">
        <label style="padding-top:8px;">Upload master data file</label>
        <div>
          <input type="file" id="so-file-input" accept=".xlsx,.xls,.csv" style="margin-bottom:8px;">
          <div class="toggle-group" id="so-mode-toggle">
            <button data-mode="merge" class="active">Merge with existing</button>
            <button data-mode="replace">Replace all</button>
          </div>
        </div>
      </div>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn btn-primary" id="so-upload">Upload &amp; Apply</button>
        <button class="btn" id="so-reset" style="color:var(--critical);">Reset Master Data</button>
      </div>
      <div id="so-unmatched" style="margin-top:10px;"></div>
    </div>

    <div class="card" style="margin-bottom:18px;">
      <h3 style="font-size:15px;">Diagnostics</h3>
      ${warnings.length ? `
        <p style="font-size:13px; color:var(--slate);">Warnings from the most recent PDF ingested:</p>
        <ul style="font-size:12.5px; color:var(--warning); padding-left:18px;">
          ${warnings.map((w) => `<li>${w}</li>`).join('')}
        </ul>
      ` : `<p style="font-size:13px; color:var(--slate);">No parse warnings from the most recent ingestion.</p>`}
      <button class="btn" id="reset-data" style="margin-top:10px; color:var(--critical); border-color:var(--critical);">Reset all stored data</button>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" id="save-settings">Save Settings</button>
    </div>
  `;

  const statusColorsList = container.querySelector('#status-colors-list');
  for (const [key, label] of Object.entries(STATUS_LABELS)) {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<label>${label}</label><input type="color" class="color-input" data-status-color="${key}" value="${settings.statusColors[key] || '#8494A2'}">`;
    statusColorsList.appendChild(row);
  }

  const statusDelColorsList = container.querySelector('#status-del-colors-list');
  for (const [key, label] of Object.entries(STATUS_DEL_LABELS)) {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<label>${label}</label><input type="color" class="color-input" data-status-del-color="${key}" value="${settings.statusDelColors[key] || '#8494A2'}">`;
    statusDelColorsList.appendChild(row);
  }

  const qtyColorsList = container.querySelector('#qty-colors-list');
  for (const [key, label] of Object.entries(QTY_SHIFT_LABELS)) {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<label>${label}</label><input type="color" class="color-input" data-qtyshift="${key}" value="${settings.qtyShiftColors[key]}">`;
    qtyColorsList.appendChild(row);
  }

  const fontList = container.querySelector('#font-list');
  for (const [key, label] of Object.entries(FONT_GROUPS)) {
    const current = settings.fontSettings[key] || { family: "'Inter', sans-serif", size: 14 };
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `
      <label>${label}</label>
      <select class="btn" data-font-family="${key}" style="margin-right:8px;">
        ${FONT_OPTIONS.map((f) => `<option value="${f.value}" ${f.value === current.family ? 'selected' : ''}>${f.label}</option>`).join('')}
      </select>
      <input type="number" data-font-size="${key}" min="9" max="36" step="0.5" value="${current.size}" style="width:60px; padding:5px 8px; border:1px solid var(--line); border-radius:6px;"> px
    `;
    fontList.appendChild(row);
  }

  container.querySelector('#font-reset').addEventListener('click', async () => {
    for (const key of Object.keys(FONT_GROUPS)) {
      const defaults = DEFAULT_SETTINGS.fontSettings[key];
      container.querySelector(`select[data-font-family="${key}"]`).value = defaults.family;
      container.querySelector(`input[data-font-size="${key}"]`).value = defaults.size;
    }
    applyFontSettings(DEFAULT_SETTINGS.fontSettings);
    const s = await loadSettings();
    await saveSettings({ ...s, fontSettings: structuredClone(DEFAULT_SETTINGS.fontSettings) });
    toast('Typography reset to defaults.', 'success');
  });

  // --- Delivery Date Corrections ---
  // --- Split Production Runs ---
  const runIdSystemRadio = container.querySelector('#run-id-system');
  const runIdLotRadio = container.querySelector('#run-id-lot');
  runIdSystemRadio.checked = (settings.runIdentificationSource || 'system') === 'system';
  runIdLotRadio.checked = settings.runIdentificationSource === 'lot';
  [runIdSystemRadio, runIdLotRadio].forEach((radio) => {
    radio.addEventListener('change', async () => {
      const s = await loadSettings();
      await saveSettings({ ...s, runIdentificationSource: runIdLotRadio.checked ? 'lot' : 'system' });
      toast('Saved — applies to reports ingested from now on. Already-ingested reports keep their existing records; use Settings → Reset if you need this applied retroactively.', 'success');
    });
  });

  container.querySelector('#dm-tracking').checked = !!settings.deliveryMatchKeys.trackingNumber;
  container.querySelector('#dm-factoryline').checked = !!settings.deliveryMatchKeys.factoryLine;
  for (const key of ['styleNo', 'trackingNumber', 'factory', 'lineNo', 'deliveryDate']) {
    container.querySelector(`#dtc-${key}`).value = settings.deliveryTemplateColumns[key] || '';
  }
  const currentColumnConfig = () => ({
    styleNo: container.querySelector('#dtc-styleNo').value.trim().toUpperCase() || 'B',
    trackingNumber: container.querySelector('#dtc-trackingNumber').value.trim().toUpperCase() || 'C',
    factory: container.querySelector('#dtc-factory').value.trim().toUpperCase() || 'G',
    lineNo: container.querySelector('#dtc-lineNo').value.trim().toUpperCase() || 'H',
    deliveryDate: container.querySelector('#dtc-deliveryDate').value.trim().toUpperCase() || 'L',
  });

  const refreshDcStatus = async (documentDate) => {
    const meta = await getDeliveryCorrectionsMeta();
    const el = container.querySelector('#dc-status');
    if (meta.count === 0) {
      el.textContent = 'No corrections loaded yet — everything shows the original PDF Delivery Date.';
      return;
    }
    const docDateText = documentDate ? ` — document date (cell B3): ${documentDate}` : '';
    el.textContent = `${meta.count} correction${meta.count === 1 ? '' : 's'} loaded — last updated ${new Date(meta.lastUploadedAt).toLocaleString()}${docDateText}`;
  };
  await refreshDcStatus();

  let uploadMode = 'merge';
  container.querySelectorAll('#dc-mode-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      uploadMode = btn.dataset.mode;
      container.querySelectorAll('#dc-mode-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  container.querySelector('#dc-template-xlsx').addEventListener('click', () => downloadCorrectionTemplateXlsx(currentColumnConfig()));
  container.querySelector('#dc-template-csv').addEventListener('click', () => downloadCorrectionTemplateCsv(currentColumnConfig()));

  container.querySelector('#dc-upload').addEventListener('click', async () => {
    const fileInput = container.querySelector('#dc-file-input');
    const file = fileInput.files[0];
    if (!file) { toast('Choose a file first.', 'error'); return; }

    showLoading('Uploading and applying corrections…');
    try {
      const deliveryTemplateColumns = currentColumnConfig();
      await saveSettings({ ...settings, deliveryTemplateColumns });

      const { rows, warnings, documentDate } = await parseCorrectionsFile(file, deliveryTemplateColumns);
      if (rows.length === 0) { toast(warnings[0] || 'No usable rows found.', 'error'); return; }

      await saveDeliveryCorrections(rows, uploadMode);
      toast(`${rows.length} correction row${rows.length === 1 ? '' : 's'} ${uploadMode === 'replace' ? 'loaded (replaced existing)' : 'merged'}.${warnings.length ? ` ${warnings.length} row(s) skipped — see console.` : ''}`, 'success');
      if (warnings.length) console.warn('Delivery Corrections upload warnings:', warnings);
      await refreshDcStatus(documentDate);

      const deliveryMatchKeys = {
        trackingNumber: container.querySelector('#dm-tracking').checked,
        factoryLine: container.querySelector('#dm-factoryline').checked,
      };
      await saveSettings({ ...settings, deliveryTemplateColumns, deliveryMatchKeys });
      const result = await reapplyDeliveryCorrections(deliveryMatchKeys);
      toast(`Applied to ${result.correctedCount} record${result.correctedCount === 1 ? '' : 's'}.`, 'success');
      if (result.hasCorrections && result.failedStyles.length > 0) {
        showFailedMatchPopup(result.failedStyles, exportFailedList);
      }
    } finally {
      hideLoading();
    }
  });

  container.querySelector('#dc-export-failed').addEventListener('click', async () => {
    const deliveryMatchKeys = {
      trackingNumber: container.querySelector('#dm-tracking').checked,
      factoryLine: container.querySelector('#dm-factoryline').checked,
    };
    await saveSettings({ ...settings, deliveryMatchKeys });
    const result = await reapplyDeliveryCorrections(deliveryMatchKeys);
    if (!result.hasCorrections) { toast('No corrections file loaded yet.', 'error'); return; }
    if (result.failedStyles.length === 0) { toast('No failed matches — everything matched.', 'success'); return; }
    exportFailedList(result.failedStyles);
  });

  container.querySelector('#dc-reset').addEventListener('click', async () => {
    if (!confirm('Remove all delivery date replacements and restore every style\'s original PDF Delivery Date? This cannot be undone.')) return;
    showLoading('Resetting Delivery Date…');
    try {
      await resetAllDeliveryCorrections();
      await refreshDcStatus();
      toast('Delivery Date reset — every style now shows its original PDF value.', 'success');
    } finally {
      hideLoading();
    }
  });

  // --- Special Operations Master Data (Wash Type via SPL OPE) ---
  for (const key of ['splOpeCode', 'washStatus']) {
    container.querySelector(`#so-${key}`).value = settings.splOpeTemplateColumns[key] || '';
  }
  container.querySelector('#so-dataStartRow').value = settings.splOpeDataStartRow || 2;
  const currentSoColumnConfig = () => ({
    splOpeCode: container.querySelector('#so-splOpeCode').value.trim().toUpperCase() || 'B',
    washStatus: container.querySelector('#so-washStatus').value.trim().toUpperCase() || 'C',
  });

  const refreshSoStatus = async () => {
    const meta = await getSplOpeMappingMeta();
    const el = container.querySelector('#so-status');
    el.textContent = meta.count > 0
      ? `${meta.count} code${meta.count === 1 ? '' : 's'} mapped — last updated ${new Date(meta.lastUploadedAt).toLocaleString()}`
      : 'No Special Operations master data loaded yet — every style defaults to Non Wash.';

    const unmatchedEl = container.querySelector('#so-unmatched');
    const unmatched = await getUnmatchedSplOpeCodes();
    unmatchedEl.innerHTML = unmatched.length > 0
      ? `<p style="font-size:12px; color:var(--warning);">${unmatched.length} SPL OPE code${unmatched.length === 1 ? '' : 's'} in your ingested data ${unmatched.length === 1 ? 'has' : 'have'} no match in the master file — defaulting to Non Wash. <button class="btn" id="so-export-unmatched" style="margin-left:6px; padding:2px 8px; font-size:11.5px;">Export list</button></p>`
      : '';
    container.querySelector('#so-export-unmatched')?.addEventListener('click', async () => {
      exportUnmatchedSplOpeCodes(await getUnmatchedSplOpeCodes());
    });
  };
  await refreshSoStatus();

  let soUploadMode = 'merge';
  container.querySelectorAll('#so-mode-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      soUploadMode = btn.dataset.mode;
      container.querySelectorAll('#so-mode-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  container.querySelector('#so-upload').addEventListener('click', async () => {
    const fileInput = container.querySelector('#so-file-input');
    const file = fileInput.files[0];
    if (!file) { toast('Choose a file first.', 'error'); return; }

    showLoading('Uploading Special Operations master data…');
    try {
      const splOpeTemplateColumns = currentSoColumnConfig();
      const splOpeDataStartRow = Number(container.querySelector('#so-dataStartRow').value) || 2;
      await saveSettings({ ...settings, splOpeTemplateColumns, splOpeDataStartRow });

      const { rows, errors } = await parseSplOpeMasterFile(file, splOpeTemplateColumns, splOpeDataStartRow);
      if (rows.length === 0 && errors.length) { toast(errors[0], 'error'); return; }

      await saveSplOpeMapping(rows, soUploadMode);
      toast(`${rows.length} code${rows.length === 1 ? '' : 's'} ${soUploadMode === 'replace' ? 'loaded (replaced existing)' : 'merged'}.${errors.length ? ` ${errors.length} row(s) skipped — see console.` : ''}`, 'success');
      if (errors.length) console.warn('Special Operations master data upload warnings:', errors);
      await refreshSoStatus();
    } finally {
      hideLoading();
    }
  });

  container.querySelector('#so-reset').addEventListener('click', async () => {
    if (!confirm('Remove all Special Operations master data? Every style will default to Non Wash until a new file is uploaded. This cannot be undone.')) return;
    showLoading('Resetting Special Operations master data…');
    try {
      await resetSplOpeMapping();
      await refreshSoStatus();
      toast('Special Operations master data reset.', 'success');
    } finally {
      hideLoading();
    }
  });

  let selectedTheme = settings.theme;
  container.querySelectorAll('#theme-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedTheme = btn.dataset.theme;
      container.querySelectorAll('#theme-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
      document.documentElement.setAttribute('data-theme', selectedTheme);
    });
  });

  container.querySelector('#connect-folder').addEventListener('click', async () => {
    try {
      await pickFolder();
      toast('Folder connected.', 'success');
      if (onFolderChanged) onFolderChanged();
      renderSettings(container, { onFolderChanged });
    } catch (err) {
      if (err.name !== 'AbortError') toast('Could not connect folder: ' + err.message, 'error');
    }
  });

  container.querySelector('#regrant-folder').addEventListener('click', async () => {
    const handle = await getStoredFolderHandle();
    if (!handle) { toast('No folder connected yet.', 'error'); return; }
    const perm = await requestPermission(handle);
    toast(perm === 'granted' ? 'Permission granted.' : 'Permission was not granted.', perm === 'granted' ? 'success' : 'error');
    if (onFolderChanged) onFolderChanged();
  });

  container.querySelector('#reset-data').addEventListener('click', async () => {
    if (!confirm('This clears all ingested reports and comparisons, and the on-disk PDF cache. Continue?')) return;
    await dbClearAll();
    const cacheResult = await clearReportDataCache();
    // The background watcher runs independently on its own timer and would
    // otherwise notice every file looks "new" again (seenFiles was just
    // cleared) on its very next poll, regardless of what's chosen below —
    // stopping it here is what actually prevents an automatic re-ingest,
    // not the popup choice itself. It only resumes once the user takes an
    // explicit fetch action (Yes here, or the Fetch Documents button later).
    stopWatching();
    toast(`All stored data cleared${cacheResult.cleared > 0 ? ` (${cacheResult.cleared} cached file${cacheResult.cleared === 1 ? '' : 's'} removed)` : ''}.`, 'success');
    location.hash = '#/reports';

    showConfirmDialog(
      {
        title: 'Fetch documents now?',
        message: 'Data and the PDF cache have both been reset. Would you like to automatically fetch documents from your connected folder now?\n\nChoosing No leaves this for you to do manually, whenever you\'re ready — nothing happens automatically either way without you choosing here.',
        yesLabel: 'Yes, fetch now',
        noLabel: 'No, I\'ll do it manually',
      },
      () => { onDataReset?.(); },
      () => {},
    );
  });

  container.querySelector('#save-settings').addEventListener('click', async () => {
    const stThresholdDays = Number(container.querySelector('#st-threshold').value) || 0;
    const deliveryThresholdDays = Number(container.querySelector('#delivery-threshold').value) || 0;
    const washThresholdDays = Number(container.querySelector('#wash-threshold').value) || 0;
    const nonWashThresholdDays = Number(container.querySelector('#non-wash-threshold').value) || 0;
    const statusColors = {};
    statusColorsList.querySelectorAll('input[type="color"]').forEach((ci) => { statusColors[ci.dataset.statusColor] = ci.value; });
    const statusDelColors = {};
    statusDelColorsList.querySelectorAll('input[type="color"]').forEach((ci) => { statusDelColors[ci.dataset.statusDelColor] = ci.value; });
    const qtyShiftColors = {};
    qtyColorsList.querySelectorAll('input[type="color"]').forEach((ci) => { qtyShiftColors[ci.dataset.qtyshift] = ci.value; });
    const fontSettings = {};
    for (const key of Object.keys(FONT_GROUPS)) {
      const family = container.querySelector(`select[data-font-family="${key}"]`).value;
      const size = Number(container.querySelector(`input[data-font-size="${key}"]`).value);
      fontSettings[key] = { family, size };
    }
    const pollIntervalMs = Number(container.querySelector('#poll-interval').value) * 1000;
    const deliveryMatchKeys = {
      trackingNumber: container.querySelector('#dm-tracking').checked,
      factoryLine: container.querySelector('#dm-factoryline').checked,
    };
    const deliveryTemplateColumns = currentColumnConfig();

    await saveSettings({ ...settings, stThresholdDays, deliveryThresholdDays, washThresholdDays, nonWashThresholdDays, statusColors, statusDelColors, qtyShiftColors, fontSettings, deliveryMatchKeys, deliveryTemplateColumns, theme: selectedTheme, pollIntervalMs });
    applyFontSettings(fontSettings);
    toast('Settings saved.', 'success');
  });
}
