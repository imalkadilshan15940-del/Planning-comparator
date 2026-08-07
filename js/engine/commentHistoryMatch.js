// engine/commentHistoryMatch.js
// Comments are matched by Style No + Tracking No + the existing combined
// Factory/Line value (e.g. "SGL 01") — not split into separate Factory
// and Line fields. Matching ignores case and leading/trailing/extra
// whitespace, same convention as delivery corrections and wash type.

function normText(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function buildCommentMatchKey(styleNo, trackingNumber, factoryLine) {
  return `${normText(styleNo)}|${normText(trackingNumber)}|${normText(factoryLine)}`;
}
