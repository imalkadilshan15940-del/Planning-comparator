// ingestion/watcher.js
// Browsers can't subscribe to filesystem change events, so we poll the granted
// directory handle on an interval, comparing (filename, size, lastModified)
// against what we've already ingested (stored in the seenFiles store) to find
// new or changed PDFs. Debounced: a file must be stable across two consecutive
// polls before it's treated as ready, so we don't parse a half-written PDF.

import { dbGet, dbPut, dbGetAll } from '../storage/db.js';

const DEFAULT_INTERVAL_MS = 8000;

let pollHandle = null;
let pendingStable = new Map(); // filename -> {size, lastModified, seenAt}

export async function listPdfFiles(dirHandle) {
  const files = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.pdf')) {
      const file = await handle.getFile();
      files.push({ name, size: file.size, lastModified: file.lastModified, handle });
    }
  }
  return files;
}

/**
 * One-shot scan for the manual "Fetch Documents" button: returns every PDF
 * in the folder not already recorded in seenFiles, no debounce (the user
 * clicked deliberately, so files are assumed to be fully written already).
 * Does NOT mark them as seen — the caller does that after successfully
 * ingesting each one, so a failed ingest can be retried on the next fetch.
 */
export async function scanOnce(dirHandle) {
  const files = await listPdfFiles(dirHandle);
  const seenAll = await dbGetAll('seenFiles');
  const seenMap = new Map(seenAll.map((s) => [s.filename, s]));
  return files.filter((f) => {
    const seen = seenMap.get(f.name);
    return !(seen && seen.size === f.size && seen.lastModified === f.lastModified);
  });
}

export async function markFileSeen(file) {
  await dbPut('seenFiles', { filename: file.name, size: file.size, lastModified: file.lastModified });
}

// Shared between the manual "Fetch Documents" flow and this module's own
// background poll loop — an in-memory (not persisted) lock so the two can
// never both start ingesting the same file at once. This is the actual
// fix for reports getting duplicated: previously a file was only marked
// "seen" in the database AFTER its (slow) PDF parse fully completed, so
// there was a real window where the watcher's own poll cycle could see
// that same file as "not yet seen" and independently start ingesting it
// too — most likely right after a full reset, since clearing seenFiles
// means many files need reprocessing at once, widening that window.
const inFlightFiles = new Set();

export function claimFileForIngestion(filename) {
  if (inFlightFiles.has(filename)) return false;
  inFlightFiles.add(filename);
  return true;
}

export function releaseFileFromIngestion(filename) {
  inFlightFiles.delete(filename);
}

export function startWatching(dirHandle, onNewStableFile, intervalMs = DEFAULT_INTERVAL_MS) {
  stopWatching();
  pendingStable = new Map();

  const poll = async () => {
    let files;
    try {
      files = await listPdfFiles(dirHandle);
    } catch (err) {
      console.warn('Watcher: could not read folder (permission may have lapsed)', err);
      return;
    }

    const seenAll = await dbGetAll('seenFiles');
    const seenMap = new Map(seenAll.map((s) => [s.filename, s]));

    for (const f of files) {
      const seen = seenMap.get(f.name);
      const alreadyIngested = seen && seen.size === f.size && seen.lastModified === f.lastModified;
      if (alreadyIngested) continue;

      const pending = pendingStable.get(f.name);
      const isStableNow = pending && pending.size === f.size && pending.lastModified === f.lastModified;

      if (isStableNow) {
        // Stable across two polls — safe to ingest, but only if nothing
        // else (the manual Fetch Documents flow) is already handling it.
        pendingStable.delete(f.name);
        if (!claimFileForIngestion(f.name)) continue;
        try {
          await dbPut('seenFiles', { filename: f.name, size: f.size, lastModified: f.lastModified });
          await onNewStableFile(f);
        } finally {
          releaseFileFromIngestion(f.name);
        }
      } else {
        pendingStable.set(f.name, { size: f.size, lastModified: f.lastModified });
      }
    }
  };

  poll();
  pollHandle = setInterval(poll, intervalMs);
  return pollHandle;
}

export function stopWatching() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

export function isWatching() {
  return pollHandle !== null;
}
