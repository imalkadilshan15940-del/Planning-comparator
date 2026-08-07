// storage/commentHistoryRepo.js
//
// Append-only comment log, matched by Style+Tracking+FactoryLine — NOT by
// report, and NOT by which form (All Styles, Changed Styles, or an opened
// Changed Style History record) it was added from. One unified history
// per style identity, usable from anywhere.
//
// Every comment is additionally tagged with the report it was associated
// with at the time it was added (filename + printed date) — this is what
// lets a Changed Style History record show only the comments that existed
// "by then": live forms (All Styles / Changed Styles) show the complete,
// unfiltered thread, but an opened History record shows only comments
// tagged with a report date on or before that record's own report date.
// A comment tagged with no extractable report date always passes through
// regardless of cutoff, rather than risk hiding it.
//
// Storage: IndexedDB is the primary, authoritative store the UI reads
// from — fast, always available, no setup. Additionally, every style's
// full comment list is written out as its own JSON file into a
// `Comments` subfolder inside the watched project folder, so the data
// durably exists on disk, not only inside the browser's own storage. If
// that folder lives inside OneDrive/Dropbox/a network share, those files
// travel along on their own — this app never talks to a cloud API
// directly. On startup, any comment found in that folder but missing from
// IndexedDB (e.g. added on another machine) is imported automatically,
// matched by each individual comment's own uid so nothing is ever
// duplicated.

import { dbAdd, dbGetAll, dbGetAllByIndex } from './db.js';
import { buildCommentMatchKey } from '../engine/commentHistoryMatch.js';
import { getStoredFolderHandle, requestReadWritePermission } from '../ingestion/folderAccess.js';
import { parsePrintedDate } from '../shared/dateUtils.js';

/** Short, deterministic, filesystem-safe hash of the match key, so the same style always maps to the same filename. */
function hashMatchKey(matchKey) {
  let hash = 5381;
  for (let i = 0; i < matchKey.length; i++) {
    hash = ((hash << 5) + hash + matchKey.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function commentFileName(matchKey) {
  return `comments-${hashMatchKey(matchKey)}.json`;
}

async function getCommentsDirHandle(createIfMissing) {
  const rootHandle = await getStoredFolderHandle();
  if (!rootHandle) return null;
  try {
    return await rootHandle.getDirectoryHandle('Comments', { create: !!createIfMissing });
  } catch {
    return null;
  }
}

/** Best-effort — never throws; a failed folder export never blocks the IndexedDB save. */
async function exportStyleCommentsToFolder(styleNo, trackingNumber, factoryLine) {
  try {
    const rootHandle = await getStoredFolderHandle();
    if (!rootHandle) return { exported: false, reason: 'No project folder configured in Settings.' };
    const perm = await requestReadWritePermission(rootHandle);
    if (perm !== 'granted') return { exported: false, reason: 'Write permission not granted for the project folder.' };

    const matchKey = buildCommentMatchKey(styleNo, trackingNumber, factoryLine);
    const comments = await getCommentHistory(styleNo, trackingNumber, factoryLine); // unfiltered — the file always holds the complete thread
    const fileContent = { matchKey, styleNo, trackingNumber, factoryLine, comments };

    const commentsDir = await rootHandle.getDirectoryHandle('Comments', { create: true });
    const fileHandle = await commentsDir.getFileHandle(commentFileName(matchKey), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(fileContent, null, 2));
    await writable.close();
    return { exported: true };
  } catch (err) {
    return { exported: false, reason: err.message || String(err) };
  }
}

/**
 * @param reportContext  { filename, printedDate } — the report this comment
 *                        is associated with (the row's own report on a live
 *                        form, or the record's report inside History). Pass
 *                        null/undefined if unavailable — the comment then
 *                        has no report date and always shows regardless of
 *                        any cutoff, rather than risk being hidden.
 */
export async function addCommentHistoryEntry(styleNo, trackingNumber, factoryLine, comment, reportContext) {
  const trimmed = String(comment || '').trim();
  if (!trimmed) return null;
  const entry = {
    uid: crypto.randomUUID(),
    styleNo, trackingNumber, factoryLine,
    matchKey: buildCommentMatchKey(styleNo, trackingNumber, factoryLine),
    comment: trimmed,
    createdAt: new Date().toISOString(),
    reportFilename: reportContext?.filename || null,
    reportPrintedDate: reportContext?.printedDate || null,
  };
  const id = await dbAdd('commentHistory', entry);
  const withId = { id, ...entry };
  // Best-effort disk export — never blocks on failure, matching the same
  // tolerance the rest of the app already uses for folder writes.
  exportStyleCommentsToFolder(styleNo, trackingNumber, factoryLine).catch(() => {});
  return withId;
}

/**
 * Full comment history for one style, oldest first. Pass `cutoffPrintedDate`
 * to only include comments tagged with a report date on or before it (used
 * by an opened Changed Style History record); omit it for the live forms,
 * which always show everything. A comment with no report date on record
 * always passes through, cutoff or not.
 */
/** Filters a set of comment entries down to only those tagged with a
 * report date on or before the cutoff — an entry with no report date on
 * record always passes through regardless, as a safe fallback. Shared by
 * both the single-style lookup and the bulk grid-rendering path below, so
 * the rule is defined in exactly one place. */
export function filterCommentsByCutoff(entries, cutoffPrintedDate) {
  if (!cutoffPrintedDate) return entries;
  const cutoff = parsePrintedDate(cutoffPrintedDate);
  if (!cutoff) return entries;
  return entries.filter((e) => {
    if (!e.reportPrintedDate) return true;
    const entryDate = parsePrintedDate(e.reportPrintedDate);
    if (!entryDate) return true;
    return entryDate <= cutoff;
  });
}

export async function getCommentHistory(styleNo, trackingNumber, factoryLine, cutoffPrintedDate = null) {
  const key = buildCommentMatchKey(styleNo, trackingNumber, factoryLine);
  const entries = filterCommentsByCutoff(await dbGetAllByIndex('commentHistory', 'matchKey', key), cutoffPrintedDate);
  return entries.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/**
 * Loads every comment once and groups by matchKey — used when rendering a
 * whole grid (All Styles / Changed Styles), so looking up "how many
 * comments does this row have" for hundreds of rows costs one query, not
 * hundreds. Always unfiltered (live forms never apply a cutoff) — an
 * opened History record computes its own cutoff-aware count separately.
 */
export async function buildCommentCountIndex() {
  const all = await dbGetAll('commentHistory');
  const counts = new Map();
  for (const entry of all) {
    counts.set(entry.matchKey, (counts.get(entry.matchKey) || 0) + 1);
  }
  return counts;
}

/**
 * Loads every comment once and groups by matchKey into full arrays (not
 * just counts) — used where a cutoff-aware count is needed per row across
 * a whole grid (All Styles). Filtering happens in-memory per row against
 * this one shared fetch, avoiding one DB query per row.
 */
export async function buildCommentEntriesIndex() {
  const all = await dbGetAll('commentHistory');
  const byKey = new Map();
  for (const entry of all) {
    if (!byKey.has(entry.matchKey)) byKey.set(entry.matchKey, []);
    byKey.get(entry.matchKey).push(entry);
  }
  return byKey;
}

export function getCutoffCommentCount(entriesIndex, styleNo, trackingNumber, factoryLine, cutoffPrintedDate) {
  const entries = entriesIndex.get(buildCommentMatchKey(styleNo, trackingNumber, factoryLine)) || [];
  return filterCommentsByCutoff(entries, cutoffPrintedDate).length;
}

export function getCommentCount(countIndex, styleNo, trackingNumber, factoryLine) {
  return countIndex.get(buildCommentMatchKey(styleNo, trackingNumber, factoryLine)) || 0;
}

/**
 * Startup sync: scans the Comments subfolder (if a project folder is
 * configured and that subfolder already exists) and imports any comment
 * whose uid isn't already present in IndexedDB — covering comments added
 * on another machine sharing the same synced folder. Matched purely by
 * each comment's own uid, so re-running this never creates duplicates.
 */
export async function syncCommentsFromFolder() {
  const commentsDir = await getCommentsDirHandle(false);
  if (!commentsDir) return { synced: 0 };

  const existing = await dbGetAll('commentHistory');
  const existingUids = new Set(existing.map((e) => e.uid).filter(Boolean));

  let syncedCount = 0;
  for await (const [name, handle] of commentsDir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    try {
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text());
      const comments = Array.isArray(parsed.comments) ? parsed.comments : [];
      for (const c of comments) {
        if (!c.uid || existingUids.has(c.uid)) continue;
        await dbAdd('commentHistory', {
          uid: c.uid,
          styleNo: parsed.styleNo,
          trackingNumber: parsed.trackingNumber,
          factoryLine: parsed.factoryLine,
          matchKey: parsed.matchKey || buildCommentMatchKey(parsed.styleNo, parsed.trackingNumber, parsed.factoryLine),
          comment: c.comment,
          createdAt: c.createdAt,
          reportFilename: c.reportFilename || null,
          reportPrintedDate: c.reportPrintedDate || null,
        });
        existingUids.add(c.uid);
        syncedCount++;
      }
    } catch (err) {
      console.warn(`Comment History: skipping unreadable file "${name}":`, err);
    }
  }
  return { synced: syncedCount };
}
