// storage/splOpeMappingRepo.js
//
// Special Operations (SPL OPE) master data — Special Operations Code ->
// Wash Status. Like the Wash Type mapping it replaces, this never needs
// to physically rewrite contMrpRecords or styleRecords: Wash Type is
// computed fresh at read time (see snapshotRepo.js), so uploading a new
// master file takes effect immediately on next render, nothing to
// "reapply." Unlike the old mapping, the source PDF value being matched
// (SPL OPE) is now separate from the lookup key display — Style Number is
// no longer part of this matching at all.

import { dbAdd, dbPut, dbGetAll, dbClearStore } from './db.js';
import { getStoredFolderHandle, requestReadWritePermission } from '../ingestion/folderAccess.js';

const MASTER_DATA_FILENAME = 'special-operations-master.json';

function norm(v) {
  return String(v ?? '').trim().toUpperCase();
}

/**
 * Writes the CURRENT full contents of the splOpeMapping store to a single
 * JSON file in the watched folder, always overwriting whatever was there
 * before — the on-disk file always mirrors the current database state,
 * not a history of uploads. Best-effort: never throws, since a failed
 * disk write shouldn't block the upload itself from succeeding.
 */
async function exportMasterDataToJson() {
  try {
    const rootHandle = await getStoredFolderHandle();
    if (!rootHandle) return { exported: false, reason: 'No project folder configured in Settings.' };
    const perm = await requestReadWritePermission(rootHandle);
    if (perm !== 'granted') return { exported: false, reason: 'Write permission not granted for the project folder.' };

    const rows = await dbGetAll('splOpeMapping');
    const fileHandle = await rootHandle.getFileHandle(MASTER_DATA_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify({ savedAt: new Date().toISOString(), rows }, null, 2));
    await writable.close();
    return { exported: true };
  } catch (err) {
    return { exported: false, reason: err.message || String(err) };
  }
}

/**
 * Startup recovery: if the browser's own splOpeMapping store is empty but
 * a master data JSON file exists on disk, load it back in — this is what
 * lets the master data survive a cleared browser storage, since the disk
 * copy is the durable source of truth once it exists.
 */
export async function syncMasterDataFromJson() {
  try {
    const rootHandle = await getStoredFolderHandle();
    if (!rootHandle) return { restored: 0 };

    const existing = await dbGetAll('splOpeMapping');
    if (existing.length > 0) return { restored: 0 }; // already have data, don't overwrite it from disk

    const fileHandle = await rootHandle.getFileHandle(MASTER_DATA_FILENAME).catch(() => null);
    if (!fileHandle) return { restored: 0 };

    const file = await fileHandle.getFile();
    const parsed = JSON.parse(await file.text());
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    for (const row of rows) {
      await dbAdd('splOpeMapping', row);
    }
    return { restored: rows.length };
  } catch (err) {
    console.warn('Special Operations master data: disk recovery skipped:', err);
    return { restored: 0 };
  }
}

export async function saveSplOpeMapping(rows, mode) {
  if (mode === 'replace') {
    await dbClearStore('splOpeMapping');
  }
  const uploadedAt = new Date().toISOString();

  if (mode === 'merge') {
    const existing = await dbGetAll('splOpeMapping');
    const existingByCode = new Map(existing.map((r) => [norm(r.splOpeCode), r]));
    for (const row of rows) {
      const match = existingByCode.get(norm(row.splOpeCode));
      if (match) {
        await dbPut('splOpeMapping', { ...match, ...row, uploadedAt });
      } else {
        await dbAdd('splOpeMapping', { ...row, uploadedAt });
      }
    }
  } else {
    for (const row of rows) {
      await dbAdd('splOpeMapping', { ...row, uploadedAt });
    }
  }

  // Best-effort — a failed disk write never blocks the upload itself from
  // having succeeded in the browser's own storage.
  await exportMasterDataToJson().catch(() => {});
}

export async function getAllSplOpeMappings() {
  return dbGetAll('splOpeMapping');
}

export async function resetSplOpeMapping() {
  await dbClearStore('splOpeMapping');
}

export async function getSplOpeMappingMeta() {
  const rows = await dbGetAll('splOpeMapping');
  const latest = rows.reduce((max, r) => (!max || r.uploadedAt > max ? r.uploadedAt : max), null);
  return { count: rows.length, lastUploadedAt: latest };
}

/**
 * Every distinct SPL OPE code currently in the ingested data that has no
 * match in the master file — per spec, these default to Non Wash rather
 * than blocking anything, but are surfaced here so missing master data
 * entries can be identified and the master file updated if needed.
 */
export async function getUnmatchedSplOpeCodes() {
  const [allStyleRecords, mappingRows] = await Promise.all([
    dbGetAll('styleRecords'),
    dbGetAll('splOpeMapping'),
  ]);
  const normCode = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
  const mappedSet = new Set(mappingRows.map((r) => normCode(r.splOpeCode)));

  const seen = new Set();
  const unmatched = [];
  for (const s of allStyleRecords) {
    if (!s.splOpe) continue; // blank SPL OPE is expected/valid, not an unmatched code
    const key = normCode(s.splOpe);
    if (mappedSet.has(key) || seen.has(key)) continue;
    seen.add(key);
    unmatched.push({ styleNo: s.displayStyleNo || s.styleNo, factoryLine: s.factoryLine, trackingNumber: s.trackingNumber, splOpeCode: s.splOpe });
  }
  return unmatched;
}
