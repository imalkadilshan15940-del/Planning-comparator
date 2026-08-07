// parser/pdfExtract.js
// Extracts Cont/MRP-level detail records from a FastReact Line Loading PDF.
//
// Strategy (revised after validating against a real sample PDF at the
// character level — see git history / project notes for the full analysis):
//   1. Row grouping: PDF.js text items are grouped into rows by y-position
//      with a tolerance wide enough to also catch the rare case where two
//      fields render at very slightly different y (a report-generator quirk
//      seen in the Merchant/Del Date tail zone).
//   2. Column bucketing happens at the ITEM level (not per-character) using
//      fixed x-position boundaries in layoutMap.js. PDF.js keeps each
//      logical field as one intact text item in the vast majority of cases
//      (unlike some other extraction libraries' word-tokenizers, which can
//      fragment text at the character level) — text-showing operators in
//      the underlying PDF map closely to items here.
//   3. Two zones can't be split by position alone and are recovered with
//      regex instead: [splSpGmt] (SPL/OPE + S/P + GMT TYPE, all free text
//      that can run together) and [tailZone] (PP + Merchant + Del Date +
//      Takt Time — Merchant is intentionally discarded per user preference,
//      since it isn't needed for comparison and previously overlapped Del
//      Date's position in this report format).
//
// Rows that can't be classified confidently are collected into `warnings`
// rather than silently dropped, and surfaced in the UI's Diagnostics panel.

import { COLUMN_BOUNDS, CARRY_FORWARD_FIELDS, KNOWN_LAYOUT_VERSIONS, bucketForX } from './layoutMap.js';

const ROW_Y_TOLERANCE = 4; // pt — wide enough to merge the ~0.25pt tail-zone sub-layers into one row

// Bumped whenever the extraction or aggregation ALGORITHM changes (not the
// PDF's own report format — that's KNOWN_LAYOUT_VERSIONS above). The
// PDF-to-JSON cache stores this alongside each cached report; on load, a
// mismatch against the current value means the source file hasn't changed
// but the code reading it has, so the cache is treated as stale and the
// PDF gets re-parsed rather than silently serving pre-fix output forever.
export const PARSER_LOGIC_VERSION = 2; // v2: split-run date-gap detection moved into Cont/MRP grouping (pdfExtract.js), not just the later rollup stage

export class UnrecognizedLayoutError extends Error {
  constructor(foundVersion) {
    super(`Unrecognized FastReact layout version: "${foundVersion || 'unknown'}". Column positions were not validated for this version — parsing was stopped rather than risk silently mis-reading data. If this version is correct, its column boundaries need to be re-derived (see layoutMap.js) before adding it to KNOWN_LAYOUT_VERSIONS.`);
    this.name = 'UnrecognizedLayoutError';
    this.foundVersion = foundVersion;
  }
}

async function getAllPageItems(pdfDoc) {
  const pages = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    // disableCombineTextItems keeps items closer to the PDF's actual
    // text-showing operations, instead of PDF.js's default heuristic
    // merging of nearby runs — important for this report's tightly-packed
    // columns.
    const content = await page.getTextContent({ disableCombineTextItems: true });
    const viewport = page.getViewport({ scale: 1 });
    const items = content.items.map((it) => ({
      str: it.str,
      x: it.transform[4],
      // PDF.js y is measured from the page bottom; flip to a top-down
      // coordinate so "top" behaves like a normal reading-order value.
      y: viewport.height - it.transform[5],
    })).filter((it) => it.str.trim().length > 0);
    pages.push(items);
  }
  return pages;
}

function groupIntoRows(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x); // top-to-bottom, left-to-right
  const rows = [];
  for (const item of sorted) {
    let row = rows.find((r) => Math.abs(r.y - item.y) <= ROW_Y_TOLERANCE);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

function rowToBuckets(row) {
  const buckets = {};
  for (const item of row.items) {
    const key = bucketForX(item.x);
    if (!key) continue;
    buckets[key] = buckets[key] ? `${buckets[key]} ${item.str}`.trim() : item.str.trim();
  }
  return buckets;
}

function looksLikeDate(s) {
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(s || '').trim());
}

// --- S/P + GMT TYPE zone: known closed vocabulary, split via regex ---
const SP_RE = /^\s*(SOLID|MATCHING|PINNING|BTSE\s*PINNING)\s*-\s*(ONE|TWO)\s*WAY\s*(.*)$/i;

function splitSplSpGmt(blob) {
  const m = SP_RE.exec(blob || '');
  if (m) {
    return {
      sp: `${m[1].trim()} - ${m[2].trim()} WAY`.toUpperCase(),
      garmentType: (m[3] || '').trim(),
    };
  }
  return { sp: '', garmentType: (blob || '').trim() };
}

// --- Tail zone: PP + Merchant(ignored) + Del Date + Takt Time ---
// Take the LAST date-looking match as Del Date (PP, when present, comes
// first/leftmost in reading order) and the LAST decimal as Takt Time.
const DATE_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}/g;
const DECIMAL_RE = /\d{1,2}\.\d{1,2}/g;

function parseTailZone(blob) {
  const dates = (blob || '').match(DATE_RE) || [];
  const decimals = (blob || '').match(DECIMAL_RE) || [];
  return {
    delDate: dates.length ? dates[dates.length - 1] : '',
    taktTime: decimals.length ? decimals[decimals.length - 1] : '',
  };
}

function extractPrintedDate(firstPageItems) {
  const text = firstPageItems.map((i) => i.str).join(' ');
  const m = text.match(/Printed on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  return m ? m[1] : null;
}

function extractLayoutVersion(firstPageItems) {
  const text = firstPageItems.map((i) => i.str).join(' ');
  const m = text.match(/(\d\.\d{4}\.\d{4}\.\d)\s*\(/);
  return m ? m[1] : null;
}

function extractFactoryCode(allRecords) {
  const counts = new Map();
  for (const r of allRecords) {
    const code = (r.factoryLine || '').trim().split(/\s+/)[0];
    if (!code) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  let best = null, bestCount = 0;
  for (const [code, count] of counts.entries()) {
    if (count > bestCount) { best = code; bestCount = count; }
  }
  return best;
}

/**
 * Main entry point. `arrayBuffer` is the raw PDF file bytes.
 * `pdfjsLib` is the globally-loaded PDF.js library (see index.html).
 * Returns { contMrpRecords, printedDate, factory, layoutVersion, warnings }.
 */
export async function extractFastReactPdf(arrayBuffer, pdfjsLib, { strictLayout = false } = {}) {
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = await getAllPageItems(pdfDoc);
  const warnings = [];

  const printedDate = extractPrintedDate(pages[0] || []);
  const layoutVersion = extractLayoutVersion(pages[0] || []);

  if (strictLayout && (!layoutVersion || !KNOWN_LAYOUT_VERSIONS.includes(layoutVersion))) {
    throw new UnrecognizedLayoutError(layoutVersion);
  }
  if (!layoutVersion || !KNOWN_LAYOUT_VERSIONS.includes(layoutVersion)) {
    warnings.push(`Layout version "${layoutVersion || 'unknown'}" is not in the known list — proceeding, but double-check results against the source PDF (see Settings → Diagnostics).`);
  }

  const rawRows = [];
  let carry = {}; // carry-forward values, reset whenever a new Cont/MRP group starts

  for (const pageItems of pages) {
    // Skip the title/version/factory-name band above the header row.
    const dataItems = pageItems.filter((it) => it.y > 45);
    const rows = groupIntoRows(dataItems);

    for (const row of rows) {
      const buckets = rowToBuckets(row);

      const hasAnyDate = looksLikeDate(buckets.stDate) || looksLikeDate(buckets.fiDate);
      const hasQty = buckets.planQty || buckets.ordQty;
      if (!hasAnyDate && !hasQty) continue; // page furniture (titles, footers, repeated headers)

      const spGmt = splitSplSpGmt(buckets.splSpGmt);
      const tail = parseTailZone(buckets.tailZone);

      const rec = {
        factoryLine: buckets.factoryLine || '',
        acc: buckets.acc || '',
        contMrp: buckets.contMrp || '',
        similarBody: buckets.similarBody || '',
        styleNo: buckets.styleNo || '',
        trackingNumber: buckets.trackingNumber || '',
        kw: buckets.kw || '',
        splOpe: buckets.splOpe || '',
        sp: spGmt.sp,
        garmentType: spGmt.garmentType,
        planQty: buckets.planQty || '',
        prdDys: buckets.prdDys || '',
        avgEffi: buckets.avgEffi || '',
        tgtCut: buckets.tgtCut || '',
        tgt: buckets.tgt || '',
        th: buckets.th || '',
        stDate: buckets.stDate || '',
        fiDate: buckets.fiDate || '',
        delDate: tail.delDate,
        taktTime: tail.taktTime,
      };

      // Safety-net split for the two known narrow-column merge patterns,
      // in case an item still bridges a boundary on some row.
      const accContMatch = /^(\d{5})([A-Z]\/\d{2}\/\d{5}.*)$/.exec(rec.contMrp);
      if (!rec.acc && accContMatch) {
        rec.acc = accContMatch[1];
        rec.contMrp = accContMatch[2];
      }
      const bodyStyleMatch = /^(\d{5,6})([A-Za-z].*|\d{4,}[A-Za-z].*)$/.exec(rec.styleNo);
      if (!rec.similarBody && bodyStyleMatch && rec.styleNo.length > 8) {
        rec.similarBody = bodyStyleMatch[1];
        rec.styleNo = bodyStyleMatch[2];
      }

      // New Cont/MRP group starts when contMrp cell is genuinely populated.
      if (rec.contMrp && rec.contMrp !== '-') {
        carry = {};
      }
      for (const f of CARRY_FORWARD_FIELDS) {
        if (rec[f] && rec[f] !== '-') carry[f] = rec[f];
        else if (carry[f]) rec[f] = carry[f];
      }

      rawRows.push(rec);
    }
  }

  // Classify + aggregate ramp rows into Cont/MRP-level detail records.
  const groups = new Map();
  let skippedSubtotals = 0;

  for (const rec of rawRows) {
    // A genuine PP-ramp row always carries its own Tracking Number. The one
    // row per Cont/MRP group with a blank Tracking Number is that group's
    // grand-total rollup — excluded here so it doesn't double-count Plan
    // Quantity when rows are summed into the Cont/MRP-level record below.
    const hasTracking = rec.trackingNumber && rec.trackingNumber !== '-';
    const isDetailRow = rec.styleNo && rec.styleNo !== '-' && hasTracking && looksLikeDate(rec.stDate) && looksLikeDate(rec.fiDate);
    if (!isDetailRow) { skippedSubtotals++; continue; }

    const key = `${rec.styleNo}|${rec.contMrp || ''}|${rec.trackingNumber || ''}|${rec.factoryLine || ''}`;
    const list = groups.get(key) || [];
    list.push(rec);
    groups.set(key, list);
  }

  const contMrpRecords = [];
  for (const [key, rows] of groups.entries()) {
    // A Cont/MRP group can legitimately contain multiple ramp rows that
    // are genuinely one continuous block (sequential production phases of
    // the same uninterrupted run) — those should stay merged. But the same
    // Cont/MRP number can also repeat across genuinely separate runs with
    // a real date gap between them (confirmed — Cont/MRP alone isn't a
    // reliable boundary). Splitting by date continuity here, before any
    // min/max/sum aggregation happens, is what actually catches that;
    // rowAggregator.js's own splitting can't recover information this
    // stage has already irreversibly merged away.
    const subGroups = splitRowsByDateGap(rows);

    for (const subRows of subGroups) {
      const dates = (field) => subRows.map((r) => r[field]).filter(looksLikeDate);
      const num = (v) => parseFloat(String(v || '0').replace(/,/g, '')) || 0;
      const qtyTotal = subRows.reduce((sum, r) => sum + num(r.planQty), 0);
      const avgEffiVals = subRows.map((r) => num(r.avgEffi));
      const avgEffiSimple = avgEffiVals.length ? avgEffiVals.reduce((a, b) => a + b, 0) / avgEffiVals.length : null;
      const prdDysMax = Math.max(...subRows.map((r) => num(r.prdDys)), 0);

      contMrpRecords.push({
        styleNo: subRows[0].styleNo,
        contMrp: subRows[0].contMrp || null,
        trackingNumber: subRows[0].trackingNumber || null,
        factoryLine: subRows[0].factoryLine,
        garmentType: subRows[0].garmentType || null,
        splOpe: subRows[0].splOpe || null,
        merchant: null, // intentionally not extracted — not needed for comparison
        similarBody: subRows[0].similarBody || null,
        acc: subRows[0].acc || null,
        tgtCut: subRows[0].tgtCut || null,
        tgt: subRows[0].th || null, // "TRG/H" in the UI — sourced from the PDF's TH column, not its TGT column
        avgEffi: avgEffiSimple != null ? Math.round(avgEffiSimple * 10) / 10 : null,
        prdDys: prdDysMax || null,
        stDate: minDateStr(dates('stDate')),
        fiDate: maxDateStr(dates('fiDate')),
        delDate: maxDateStr(dates('delDate')),
        planQty: qtyTotal,
      });
    }
  }

  const factory = extractFactoryCode(rawRows);

  if (contMrpRecords.length === 0) {
    warnings.push('No detail rows were extracted from this PDF. Check that the layout matches expectations (see Settings → Diagnostics).');
  }

  return { contMrpRecords, printedDate, factory, layoutVersion, warnings, rawRowCount: rawRows.length, skippedSubtotals };
}

function minDateStr(strs) { return pickDate(strs, true); }

/**
 * Splits a Cont/MRP group's raw ramp rows into sub-groups by date
 * continuity — rows stay together only if the next one's Start lands the
 * same day as, or the day after, the running sub-group's latest Finish so
 * far. Sorted by Start date first so this doesn't depend on the rows'
 * original order in the PDF.
 */
function splitRowsByDateGap(rows) {
  const withDates = rows.map((r) => ({ row: r, st: parsePlainDate(r.stDate), fi: parsePlainDate(r.fiDate) }));
  const sorted = [...withDates].sort((a, b) => {
    if (!a.st || !b.st) return 0;
    return a.st - b.st;
  });

  const subGroups = [];
  let current = null;
  let currentMaxFi = null;
  for (const entry of sorted) {
    const continuous = current && currentMaxFi && entry.st && Math.round((entry.st.getTime() - currentMaxFi.getTime()) / 86400000) <= 1;
    if (continuous) {
      current.push(entry.row);
      if (entry.fi && (!currentMaxFi || entry.fi > currentMaxFi)) currentMaxFi = entry.fi;
    } else {
      current = [entry.row];
      subGroups.push(current);
      currentMaxFi = entry.fi || null;
    }
  }
  return subGroups;
}

function parsePlainDate(str) {
  if (!str) return null;
  const parts = String(str).split('/').map(Number);
  if (parts.length !== 3) return null;
  const [mo, da, yr] = parts;
  return new Date(yr < 100 ? 2000 + yr : yr, mo - 1, da);
}

function maxDateStr(strs) { return pickDate(strs, false); }

function pickDate(strs, wantMin) {
  if (!strs.length) return null;
  const parsed = strs.map((s) => {
    const [mo, da, yr] = s.split('/').map(Number);
    const yyyy = yr < 100 ? 2000 + yr : yr;
    return { s, d: new Date(yyyy, mo - 1, da) };
  });
  parsed.sort((a, b) => (wantMin ? a.d - b.d : b.d - a.d));
  return parsed[0].s;
}
