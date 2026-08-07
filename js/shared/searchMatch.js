// shared/searchMatch.js
//
// Two modes, chosen by how the query is typed:
//   - Default (no trailing %): partial/contains match.
//     "ABC123" matches "ABC123", "ABC123-A", "ABC123-B", "ABC123-R1".
//   - Trailing % : exact match. The % is stripped before comparing, and
//     only an exact (case/space-insensitive) match qualifies.
//     "ABC123%" matches only "ABC123" — not "ABC123-A" or "ABC12345".
//
// Comparison itself always ignores case and collapses/trims whitespace,
// consistent with the rest of the app's text-matching conventions.

function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Tests a single value against a raw query string (handles the % suffix itself). */
export function matchesQuery(value, rawQuery) {
  const query = clean(rawQuery);
  if (!query) return true; // empty query matches everything
  const target = clean(value);

  if (query.endsWith('%')) {
    const exact = query.slice(0, -1);
    return target === exact;
  }
  return target.includes(query);
}

/** Tests a row against a query across multiple candidate fields — true if ANY field matches. */
export function rowMatchesQuery(row, fields, rawQuery) {
  const query = clean(rawQuery);
  if (!query) return true;
  return fields.some((f) => matchesQuery(row[f], rawQuery));
}
