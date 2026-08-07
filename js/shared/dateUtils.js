// shared/dateUtils.js
// Printed dates come out of the PDF as "M/D/YYYY" strings (e.g. "7/2/2026").
// Sorting these as plain strings is wrong across month/year boundaries
// (e.g. "12/1/2026" sorts before "7/2/2026" alphabetically even though it's
// later chronologically) — this was the root cause of charts, Report
// History, and the Dashboard's "newest report" all showing wrong order.
// Every place that orders reports or timeline entries by date should go
// through these helpers instead of comparing the raw strings.

export function parsePrintedDate(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    yr = yr.length === 2 ? `20${yr}` : yr;
    return new Date(Number(yr), Number(mo) - 1, Number(da));
  }
  const d = new Date(str); // fallback: ISO timestamps like ingestedAt
  return isNaN(d.getTime()) ? null : d;
}

/** Best available date for a report: printed date if present, else ingested timestamp. */
export function reportDate(report) {
  return parsePrintedDate(report?.printedDate) || (report?.ingestedAt ? new Date(report.ingestedAt) : null);
}

/** Ascending comparator (oldest first) for report objects. */
export function compareReportsAsc(a, b) {
  const da = reportDate(a), db = reportDate(b);
  if (!da && !db) return 0;
  if (!da) return -1;
  if (!db) return 1;
  return da.getTime() - db.getTime();
}

/** Descending comparator (newest first) for report objects. */
export function compareReportsDesc(a, b) {
  return -compareReportsAsc(a, b);
}

/**
 * Display-only formatter: normalizes any date string (2- or 4-digit year,
 * e.g. from the PDF's "Printed on" line vs. a style's own ST/FI/Delivery
 * date) to a consistent M/D/YY for showing in the UI. Does NOT change what's
 * stored — sorting/matching still goes through parsePrintedDate/reportDate
 * above, unaffected by this. Falls back to the original string if it
 * doesn't look like a date at all (e.g. "—" placeholders).
 */
export function formatDateShort(str) {
  if (!str) return str;
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return str;
  const [, mo, da, yr] = m;
  const yy = yr.length === 4 ? yr.slice(2) : yr;
  return `${Number(mo)}/${Number(da)}/${yy}`;
}

/** For ISO timestamps (e.g. a comment's createdAt) — formatDateShort above only
 * handles M/D/Y-pattern strings, not ISO. Returns null if unparseable. */
export function formatIsoDateShort(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}
