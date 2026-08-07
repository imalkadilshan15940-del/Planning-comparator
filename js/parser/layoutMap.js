// parser/layoutMap.js
//
// These column boundaries were derived empirically by analyzing the actual
// character-level positions in a real FastReact "Line Loading" PDF (layout
// version 5.1002.7700.4) — NOT guessed from header label text. Header-text
// matching was abandoned because this report format has real quirks:
//   - Some header cells render with reversed character order (a font/report-
//     generator bug: "OPE" prints as "EPO", "PRD" prints as "DRP", etc.)
//   - Narrow adjacent columns (Acc|Cont/MRP, Similar Body|STYLE-NO) sometimes
//     print with zero visible gap between them.
//   - S/P and GMT TYPE are free-text columns of variable width that can run
//     together with no gap; they're recovered via regex on their combined
//     zone, not by position alone.
//   - PP, Merchant, and Del Date/Takt Time occupy the tail of the row and
//     are best handled as one zone with regex extraction, since Merchant
//     (now ignored per user preference) used to overlap Del Date visually.
//
// If a future FastReact export uses a different layout version, these
// boundaries should be re-derived the same way (see the project's parser
// notes) rather than assumed to still be correct.

export const KNOWN_LAYOUT_VERSIONS = ['5.1002.7700.4'];

// [fieldKey, xStart, xEnd) — left-inclusive, right-exclusive, in PDF points.
export const COLUMN_BOUNDS = [
  ['factoryLine', 0, 19.8],
  ['acc', 19.8, 41.8],
  ['contMrp', 41.8, 75.0],
  ['similarBody', 75.0, 101.5],
  ['styleNo', 101.5, 160.2],
  ['trackingNumber', 160.2, 225.0],
  ['kw', 225.0, 261.0],
  // SPL OPE: extracted independently by position — verified against a real
  // PDF sample with populated values (NA, BTSE, QUOZ, WNY, EZSO, QUZSO all
  // extracted cleanly, no truncation). Deliberately NOT combined with S/P
  // + GMT TYPE below; those two remain genuinely hard to separate by
  // coordinate alone (variable-length free text), so they still go
  // through the regex-based splitter, but SPL OPE itself no longer needs
  // to since its own position is now known precisely.
  ['splOpe', 261.0, 302.5],
  ['splSpGmt', 302.5, 433.0],     // S/P + GMT TYPE combined zone (SPL OPE no longer part of this)
  ['ordQty', 433.0, 463.0],
  ['prdDys', 463.0, 486.2],
  ['planQty', 486.2, 513.8],
  ['avgEffi', 513.8, 534.0],
  ['tgtCut', 534.0, 570.5],
  ['tgt', 570.5, 595.8],
  ['th', 595.8, 611.0],
  ['tentCut', 611.0, 642.8],
  ['stDate', 642.8, 673.8],
  ['fiDate', 673.8, 702.8],
  ['tailZone', 702.8, Infinity],  // PP + (Merchant, ignored) + Del Date + Takt Time
];

// Fields that must "carry forward" from the first row of a repeating group
// onto blank continuation rows (FastReact only prints these once per group).
// NOTE: trackingNumber is deliberately excluded — every genuine PP-ramp row
// carries its own Tracking Number explicitly. The one row per Cont/MRP
// group where it's blank is the grand-total rollup row, and that blank is
// exactly how we identify and exclude it (see pdfExtract.js isDetailRow) —
// carrying it forward would wrongly make totals look like real rows and
// double-count Plan Quantity when aggregating.
export const CARRY_FORWARD_FIELDS = [
  'factoryLine', 'acc', 'contMrp', 'similarBody', 'styleNo', 'kw', 'splOpe', 'garmentType',
];

export function bucketForX(x) {
  for (const [key, lo, hi] of COLUMN_BOUNDS) {
    if (x >= lo && x < hi) return key;
  }
  return null;
}
