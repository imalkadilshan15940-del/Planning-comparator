// ingestion/folderAccess.js
// Wraps window.showDirectoryPicker(). The handle itself can be structured-cloned
// into IndexedDB and survives across sessions in Chromium, but the *permission*
// does not — it must be re-granted (one click, no re-picking) each session.

import { dbPut, dbGet } from '../storage/db.js';

export function isFileSystemAccessSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'planning-reports', mode: 'read' });
  await dbPut('settings', { key: 'watchedFolderHandle', value: handle });
  await dbPut('settings', { key: 'watchedFolderName', value: handle.name });
  return handle;
}

export async function getStoredFolderHandle() {
  const rec = await dbGet('settings', 'watchedFolderHandle');
  return rec ? rec.value : null;
}

export async function getStoredFolderName() {
  const rec = await dbGet('settings', 'watchedFolderName');
  return rec ? rec.value : null;
}

/** Returns 'granted' | 'prompt' | 'denied'. Call requestPermission (needs a user gesture) if 'prompt'. */
export async function queryPermission(handle) {
  if (!handle || !handle.queryPermission) return 'denied';
  return handle.queryPermission({ mode: 'read' });
}

export async function requestPermission(handle) {
  if (!handle || !handle.requestPermission) return 'denied';
  return handle.requestPermission({ mode: 'read' });
}

/**
 * Upgrades an existing (read-only) folder handle to readwrite, needed only
 * for the Changed Style History JSON export — the main PDF-watching flow
 * stays read-only. Can be called on the same handle already stored from
 * pickFolder() without re-picking the folder; the browser just prompts for
 * elevated permission on that same handle.
 */
export async function requestReadWritePermission(handle) {
  if (!handle || !handle.queryPermission) return 'denied';
  const current = await handle.queryPermission({ mode: 'readwrite' });
  if (current === 'granted') return 'granted';
  if (!handle.requestPermission) return 'denied';
  return handle.requestPermission({ mode: 'readwrite' });
}
