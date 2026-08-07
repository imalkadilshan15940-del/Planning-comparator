// engine/deliveryCorrectionMatch.js
// Style Number is always part of the match key. Tracking Number and
// Factory+Line (combined, e.g. "KGG 02") are each independently toggleable
// in Settings — if both are off, matching falls back to Style Number
// alone, which is valid because Delivery Date is confirmed uniform across
// every Cont/MRP split under one style.
//
// normText implements the required data cleaning: trims leading/trailing
// spaces, collapses any run of internal whitespace to a single space, and
// ignores case — so " abc123 ", "ABC123", and "Abc123" (or "KGG  02" vs
// "KGG 02") all compare equal.

export function normText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function buildMatchKey(fields, matchKeys) {
  const parts = [normText(fields.styleNo)];
  if (matchKeys.trackingNumber) parts.push(normText(fields.trackingNumber));
  if (matchKeys.factoryLine) parts.push(normText(fields.factoryLine));
  return parts.join('|');
}

/** Builds a Map of matchKey -> correction row for fast lookup. */
export function buildCorrectionIndex(corrections, matchKeys) {
  const map = new Map();
  for (const c of corrections) {
    const key = buildMatchKey({ styleNo: c.styleNo, trackingNumber: c.trackingNumber, factoryLine: c.factoryLine }, matchKeys);
    map.set(key, c);
  }
  return map;
}

export function findCorrection(correctionIndex, record, matchKeys) {
  const key = buildMatchKey(record, matchKeys);
  return correctionIndex.get(key) || null;
}
