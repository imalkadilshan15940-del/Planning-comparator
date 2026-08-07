// storage/changedStyleHistoryRepo.js
//
// IndexedDB is the primary, authoritative store — always available, no
// setup needed. Additionally, each record is best-effort exported as an
// individual JSON file into a `History` subfolder inside the user's
// watched project folder. If that folder happens to live inside OneDrive,
// SharePoint Sync, Dropbox, Google Drive Desktop, or a network share, the
// OS/sync client carries those files along on its own — this app never
// talks to any cloud API directly.
//
// Because IndexedDB's autoIncrement id is only unique *within one
// browser's database*, it can't be trusted to match the same record
// across two different machines syncing the same History folder. Every
// record also gets a `uid` (crypto.randomUUID()) at save time — that's
// the identity used for the JSON filename and for import-sync matching.
// The local `id` is only ever used for actions within the current browser
// session (open/rename/delete in the UI).

import { dbAdd, dbPut, dbGet, dbGetAll, dbDelete } from './db.js';
import { getStoredFolderHandle, requestReadWritePermission } from '../ingestion/folderAccess.js';

function historyFileName(uid) {
  return `history-${uid}.json`;
}

async function getHistoryDirHandle(createIfMissing) {
  const rootHandle = await getStoredFolderHandle();
  if (!rootHandle) return null;
  try {
    return await rootHandle.getDirectoryHandle('History', { create: !!createIfMissing });
  } catch {
    return null; // no folder configured, or permission not available — caller treats as "export skipped"
  }
}

/** Best-effort — never throws; a failed folder export never blocks the IndexedDB save. */
export async function exportHistoryRecordToFolder(record) {
  try {
    const rootHandle = await getStoredFolderHandle();
    if (!rootHandle) return { exported: false, reason: 'No project folder configured in Settings.' };
    const perm = await requestReadWritePermission(rootHandle);
    if (perm !== 'granted') return { exported: false, reason: 'Write permission not granted for the project folder.' };

    const historyDir = await rootHandle.getDirectoryHandle('History', { create: true });
    const fileHandle = await historyDir.getFileHandle(historyFileName(record.uid), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(record, null, 2));
    await writable.close();
    return { exported: true };
  } catch (err) {
    return { exported: false, reason: err.message || String(err) };
  }
}

async function deleteHistoryFileFromFolder(uid) {
  try {
    const historyDir = await getHistoryDirHandle(false);
    if (!historyDir) return;
    await historyDir.removeEntry(historyFileName(uid));
  } catch {
    // file may not exist, or permission unavailable — nothing more to do
  }
}

export async function saveHistoryRecord(record) {
  const uid = crypto.randomUUID();
  const savedAt = new Date().toISOString();
  const fullRecord = {
    ...record,
    uid,
    savedAt,
    sourceStylePdfName: record.sourceStylePdfName || record.comparedFilename,
  };
  const id = await dbAdd('changedStyleHistory', fullRecord);
  const withId = { ...fullRecord, id };
  const exportResult = await exportHistoryRecordToFolder(withId);
  return { id, uid, ...exportResult };
}

export async function getAllHistoryRecords() {
  return dbGetAll('changedStyleHistory');
}

export async function getHistoryRecord(id) {
  return dbGet('changedStyleHistory', id);
}

export async function renameHistoryRecord(id, newSourceStylePdfName) {
  const rec = await dbGet('changedStyleHistory', id);
  if (!rec) return;
  const updated = { ...rec, sourceStylePdfName: newSourceStylePdfName };
  await dbPut('changedStyleHistory', updated);
  await exportHistoryRecordToFolder(updated);
}

export async function deleteHistoryRecord(id) {
  const rec = await dbGet('changedStyleHistory', id);
  await dbDelete('changedStyleHistory', id);
  if (rec) await deleteHistoryFileFromFolder(rec.uid);
}

/**
 * Startup sync: IndexedDB loads first and is immediately usable. This
 * additionally scans the History subfolder (if a project folder is
 * configured and a History subfolder already exists there) and imports
 * any JSON file that's either missing from IndexedDB or newer than the
 * locally-stored copy with the same uid — covering the case where History
 * files arrived via a sync client from another machine.
 */
export async function syncHistoryFromFolder() {
  const historyDir = await getHistoryDirHandle(false);
  if (!historyDir) return { synced: 0 };

  const allExisting = await getAllHistoryRecords();
  const existingByUid = new Map(allExisting.map((r) => [r.uid, r]));

  let syncedCount = 0;
  for await (const [name, handle] of historyDir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      if (!parsed.uid) continue;

      const match = existingByUid.get(parsed.uid);
      if (!match) {
        // New to this machine — add fresh, let autoIncrement assign a
        // local id; the uid (the real cross-machine identity) is preserved.
        const { id: _discardForeignId, ...withoutForeignId } = parsed;
        await dbAdd('changedStyleHistory', withoutForeignId);
        syncedCount++;
      } else if (new Date(parsed.savedAt) > new Date(match.savedAt)) {
        // Newer version of a record this machine already has — update in
        // place using the LOCAL id, not whatever id the file happened to
        // have on the machine that wrote it.
        await dbPut('changedStyleHistory', { ...parsed, id: match.id });
        syncedCount++;
      }
    } catch (err) {
      console.warn(`Changed Style History: skipping unreadable file "${name}":`, err);
    }
  }
  return { synced: syncedCount };
}
