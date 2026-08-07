// storage/reportDataRepo.js
//
// "PDF to JSON" is a pure parse-and-cache step: it reads every PDF in the
// watched folder, parses each one, and writes the result to its own JSON
// file — never touching the browser's database. "Fetch Documents" then
// prefers reading from that cache over re-parsing the PDF directly, since
// parsing is the expensive step; a file that was never pre-converted still
// works correctly (it's parsed directly, same as before), and the result
// is cached afterward so any later fetch for that same file is fast.
//
// This also doubles as the durability backup discussed earlier: even if a
// PDF is later deleted from the watched folder, or the browser's storage
// is cleared, the cached JSON is what startup recovery restores from.

import { dbGetAll } from './db.js';
import { saveIngestedReportReady } from './snapshotRepo.js';
import { getStoredFolderHandle, requestReadWritePermission } from '../ingestion/folderAccess.js';
import { listPdfFiles } from '../ingestion/watcher.js';
import { extractFastReactPdf, PARSER_LOGIC_VERSION } from '../parser/pdfExtract.js';

function hashFilename(filename) {
  let hash = 5381;
  for (let i = 0; i < filename.length; i++) {
    hash = ((hash << 5) + hash + filename.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function reportFileName(filename) {
  return `report-${hashFilename(filename)}.json`;
}

async function getReportDataDirHandle(createIfMissing) {
  const rootHandle = await getStoredFolderHandle();
  if (!rootHandle) return null;
  try {
    return await rootHandle.getDirectoryHandle('ReportData', { create: !!createIfMissing });
  } catch {
    return null;
  }
}

/** Parses one PDF file into the report-data shape, without touching IndexedDB. */
async function parsePdfFile(fileMeta) {
  const file = await fileMeta.handle.getFile();
  const buffer = await file.arrayBuffer();
  const result = await extractFastReactPdf(buffer, window.pdfjsLib);
  return {
    filename: fileMeta.name,
    factory: result.factory || 'UNKNOWN',
    printedDate: result.printedDate,
    layoutVersion: result.layoutVersion,
    parserLogicVersion: PARSER_LOGIC_VERSION,
    contMrpRecords: result.contMrpRecords,
    warnings: result.warnings || [],
    sourceSize: fileMeta.size,
    sourceLastModified: fileMeta.lastModified,
  };
}

/** Writes one report's parsed data to its cache file — shared by the
 * explicit "PDF to JSON" conversion and by Fetch Documents' fallback path
 * when a file wasn't pre-converted. Best-effort; never blocks on failure. */
export async function cacheReportDataAsJson(reportData, fileMeta) {
  try {
    const rootHandle = await getStoredFolderHandle();
    if (!rootHandle) return { cached: false, reason: 'No project folder configured in Settings.' };
    const perm = await requestReadWritePermission(rootHandle);
    if (perm !== 'granted') return { cached: false, reason: 'Write permission not granted for the project folder.' };

    const reportDataDir = await rootHandle.getDirectoryHandle('ReportData', { create: true });
    const fileContent = {
      ...reportData,
      sourceSize: fileMeta?.size ?? reportData.sourceSize,
      sourceLastModified: fileMeta?.lastModified ?? reportData.sourceLastModified,
    };
    const fileHandle = await reportDataDir.getFileHandle(reportFileName(reportData.filename), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(fileContent, null, 2));
    await writable.close();
    return { cached: true };
  } catch (err) {
    return { cached: false, reason: err.message || String(err) };
  }
}

/**
 * Reads the cached JSON for one filename, if it exists AND was produced by
 * the current parser logic — this is what lets Fetch Documents skip
 * re-parsing a PDF it's already converted. A cache written by an older
 * parser version is treated as if it doesn't exist at all, so a bug fix in
 * the extraction/aggregation logic can't be silently masked by a stale
 * cache that predates the fix — the source file may be identical, but the
 * code reading it isn't, and that's what actually matters here.
 */
export async function loadReportDataFromJson(filename) {
  const reportDataDir = await getReportDataDirHandle(false);
  if (!reportDataDir) return null;
  try {
    const fileHandle = await reportDataDir.getFileHandle(reportFileName(filename));
    const file = await fileHandle.getFile();
    const parsed = JSON.parse(await file.text());
    if (parsed.parserLogicVersion !== PARSER_LOGIC_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The "PDF to JSON" button: parses every PDF in the watched folder and
 * writes each one's data to its own cache file. Skips a file whose cache
 * is already up to date (same size + lastModified as the current file on
 * disk), so re-running this doesn't re-parse everything every time —
 * only genuinely new or changed files actually get (re-)parsed.
 */
/**
 * Deletes every cached report file — an explicit, manual way to force a
 * clean slate on disk, on top of the automatic version-based invalidation
 * above. Useful when you want certainty rather than relying on that check,
 * or want to force a full re-parse without a database reset.
 */
export async function clearReportDataCache() {
  const reportDataDir = await getReportDataDirHandle(false);
  if (!reportDataDir) return { cleared: 0 };

  let cleared = 0;
  const names = [];
  for await (const [name, handle] of reportDataDir.entries()) {
    if (handle.kind === 'file' && name.endsWith('.json')) names.push(name);
  }
  for (const name of names) {
    try {
      await reportDataDir.removeEntry(name);
      cleared++;
    } catch (err) {
      console.warn(`Clear PDF cache: failed to remove "${name}":`, err);
    }
  }
  return { cleared };
}

export async function convertAllPdfsToJson() {
  const rootHandle = await getStoredFolderHandle();
  if (!rootHandle) return { converted: 0, skipped: 0, failed: 0, reason: 'No project folder configured in Settings.' };
  const perm = await requestReadWritePermission(rootHandle);
  if (perm !== 'granted') return { converted: 0, skipped: 0, failed: 0, reason: 'Write permission not granted for the project folder.' };

  const pdfFiles = await listPdfFiles(rootHandle);

  let converted = 0, skipped = 0, failed = 0;
  for (const fileMeta of pdfFiles) {
    try {
      const existing = await loadReportDataFromJson(fileMeta.name);
      if (existing && existing.sourceSize === fileMeta.size && existing.sourceLastModified === fileMeta.lastModified) {
        skipped++;
        continue;
      }
      const parsed = await parsePdfFile(fileMeta);
      const result = await cacheReportDataAsJson(parsed, fileMeta);
      if (!result.cached) { failed++; continue; }
      converted++;
    } catch (err) {
      console.warn(`PDF to JSON: failed to convert "${fileMeta.name}":`, err);
      failed++;
    }
  }
  return { converted, skipped, failed };
}

/**
 * Startup recovery: loads any report whose cached JSON exists on disk but
 * whose data was never actually loaded into the browser's database
 * (matched by filename) — this only ever fills in something missing,
 * never overwrites a report that's already present.
 */
export async function syncReportsFromFolder() {
  const reportDataDir = await getReportDataDirHandle(false);
  if (!reportDataDir) return { restored: 0 };

  const existingReports = await dbGetAll('reports');
  const existingFilenames = new Set(existingReports.map((r) => r.filename));

  let restored = 0;
  for await (const [name, handle] of reportDataDir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      if (!parsed.filename || existingFilenames.has(parsed.filename)) continue;
      if (parsed.parserLogicVersion !== PARSER_LOGIC_VERSION) continue; // stale pre-fix cache — don't silently restore it

      await saveIngestedReportReady({
        filename: parsed.filename,
        factory: parsed.factory,
        printedDate: parsed.printedDate,
        layoutVersion: parsed.layoutVersion,
        contMrpRecords: parsed.contMrpRecords,
      });
      existingFilenames.add(parsed.filename);
      restored++;
    } catch (err) {
      console.warn(`Report data restore: skipping unreadable file "${name}":`, err);
    }
  }
  return { restored };
}
