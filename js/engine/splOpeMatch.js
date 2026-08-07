// engine/splOpeMatch.js
//
// Wash Type is now derived from the SPL OPE code extracted from the PDF,
// looked up against the uploaded Special Operations master data — not
// from Style Number at all. Matching is tolerant of formatting
// differences: leading/trailing spaces, extra internal spaces, and
// upper/lower case are all ignored, so "ABC", "abc", "Abc", and "A B C"
// are all treated as the same code.

function normalizeCode(v) {
  return String(v ?? '').replace(/\s+/g, '').toUpperCase();
}

function normalizeWashStatus(v) {
  const n = normalizeCode(v);
  if (n === 'WASH') return 'Wash';
  if (n === 'NON WASH' || n === 'NONWASH' || n === 'NON-WASH') return 'Non Wash';
  return null; // unrecognized value in the uploaded master file
}

/** Builds a Map of normalized SPL OPE code -> Wash Status ('Wash' | 'Non Wash'). */
export function buildSplOpeIndex(mappingRows) {
  const map = new Map();
  for (const row of mappingRows) {
    const washStatus = normalizeWashStatus(row.washStatus);
    if (!washStatus) continue;
    map.set(normalizeCode(row.splOpeCode), washStatus);
  }
  return map;
}

/**
 * Looks up a style's Wash Type by its SPL OPE code. Returns
 * { washType, isMapped, splOpeCode } — isMapped is false when the code has
 * no entry at all (including when the PDF's SPL OPE value itself is
 * blank), in which case washType defaults to 'Non Wash' per spec, rather
 * than stopping processing or leaving the field empty.
 */
export function findWashTypeBySplOpe(splOpeIndex, splOpeCode) {
  const normalized = normalizeCode(splOpeCode);
  if (!normalized) return { washType: 'Non Wash', isMapped: false, splOpeCode: splOpeCode || null };
  const mapped = splOpeIndex.get(normalized);
  if (mapped) return { washType: mapped, isMapped: true, splOpeCode };
  return { washType: 'Non Wash', isMapped: false, splOpeCode };
}

export { normalizeCode, normalizeWashStatus };
