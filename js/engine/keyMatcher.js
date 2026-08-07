// engine/keyMatcher.js
// Identity matching, two levels: Cont/MRP detail key (where dates actually live)
// and Style rollup key (what the Changed Styles list shows by default).

export function buildDetailKey(record) {
  const tracking = record.trackingNumber || '_';
  const contMrp = record.contMrp || '_';
  return `${record.styleNo}|${contMrp}|${tracking}|${record.factoryLine}`;
}

export function buildStyleKey(record) {
  // Run-aware: two separate production runs of the same Style+Tracking+Line
  // (the same style interrupted by another style, then resuming later) are
  // now genuinely distinct records — this is what keeps them from silently
  // re-colliding into the same identity. Records that predate this (or
  // that don't carry a runIdentifier for other reasons) fall back to the
  // plain Style+Tracking+Line key unchanged.
  const runPart = record.runIdentifier ? `|${record.runIdentifier}` : '';
  return `${record.styleNo}|${record.trackingNumber || '_'}|${record.factoryLine}${runPart}`;
}

/**
 * Style-level identity, deliberately WITHOUT the run distinction — for
 * anything that should apply the same way to every run of a style, not
 * just one: Delivery Date corrections and Comment History both match at
 * this level, since a correction or a comment about a style makes sense
 * regardless of which of its production runs you're currently looking at.
 */
export function buildStyleIdentityKey(record) {
  return `${record.styleNo}|${record.trackingNumber || '_'}|${record.factoryLine}`;
}

/**
 * Match previous vs current record arrays by a key function.
 * Returns { matched: [{prev, curr}], added: [curr...], removed: [prev...] }
 */
export function matchByKey(prevRecords, currRecords, keyFn) {
  const prevMap = new Map();
  for (const r of prevRecords) {
    const k = keyFn(r);
    // If duplicate keys exist (shouldn't after aggregation, but be defensive),
    // keep the first and let later ones fall through to composite disambiguation.
    if (!prevMap.has(k)) prevMap.set(k, r);
  }

  const matched = [];
  const added = [];
  const usedKeys = new Set();

  for (const curr of currRecords) {
    const k = keyFn(curr);
    if (prevMap.has(k)) {
      matched.push({ prev: prevMap.get(k), curr });
      usedKeys.add(k);
    } else {
      added.push(curr);
    }
  }

  const removed = [];
  for (const [k, prev] of prevMap.entries()) {
    if (!usedKeys.has(k)) removed.push(prev);
  }

  return { matched, added, removed };
}
