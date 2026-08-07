// parser/rowAggregator.js
// Two aggregation steps happen in this pipeline:
//   1) Raw PP-ramp rows -> Cont/MRP detail records (done in pdfExtract.js).
//   2) Cont/MRP records -> production runs (done here, splitIntoRuns), then
//      each run -> a Style+Tracking+Line+Run rollup record
//      (aggregateToStyleTrackingLevel): ST = earliest start, FI/Delivery =
//      latest finish/delivery, but only WITHIN one run — never blended
//      across genuinely separate runs of the same style.
//
// Run detection deliberately does NOT use Cont/MRP number or the records'
// position/order in the PDF — Cont/MRP can repeat across separate runs, and
// position carries no meaning here. Instead:
//   - 'system' mode (default, no source-file changes needed): every record
//     for the same Style+Tracking+Line is collected regardless of where it
//     sits in the report, sorted by Start date, and split into a new run
//     wherever there's an actual gap — the next block's Start doesn't land
//     on the same day as, or the day after, the previous block's Finish.
//     A same-day or next-day changeover is treated as one continuous run.
//   - 'lot' mode: once the source PDF has its own Lot Number column, each
//     record's lotNumber is a direct, unambiguous grouping key — same lot
//     number is the same run, different lot numbers are different runs,
//     no date-gap reasoning needed. A record with no lot number present
//     falls back to the date-gap rule so nothing silently disappears.

function parseDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, da, yr] = m;
  yr = yr.length === 2 ? `20${yr}` : yr;
  return new Date(Number(yr), Number(mo) - 1, Number(da));
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function earliest(dateStrs) {
  const parsed = dateStrs.map(parseDate).filter(Boolean);
  if (!parsed.length) return null;
  return parsed.reduce((a, b) => (a < b ? a : b));
}

function latest(dateStrs) {
  const parsed = dateStrs.map(parseDate).filter(Boolean);
  if (!parsed.length) return null;
  return parsed.reduce((a, b) => (a > b ? a : b));
}

function fmt(date) {
  if (!date) return null;
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(2)}`;
}

/** 1st run of a style: no suffix, even if duplicates exist elsewhere for
 * it. 2nd run: (J). 3rd: (J1). 4th: (J2). Only ever shown at all when a
 * style+tracking+line genuinely has more than one run — a style with just
 * one run never gets a suffix, regardless of its runSeq. */
function buildDuplicateSuffix(runSeq, totalRunsForIdentity) {
  if (totalRunsForIdentity < 2 || runSeq < 2) return '';
  if (runSeq === 2) return '(J)';
  return `(J${runSeq - 2})`;
}

/**
 * Splits records into continuous production runs, per Style+Tracking+Line,
 * using date continuity (or Lot Number, once available) — see file header
 * for the full rule. Cont/MRP number and PDF position are never consulted.
 */
export function splitIntoRuns(contMrpRecords, runIdentificationSource = 'system') {
  const byIdentity = new Map();
  for (const r of contMrpRecords) {
    const identity = `${r.styleNo}|${r.trackingNumber || '_'}|${r.factoryLine}`;
    const list = byIdentity.get(identity) || [];
    list.push(r);
    byIdentity.set(identity, list);
  }

  const runs = [];
  for (const [identity, group] of byIdentity.entries()) {
    // Sorted by Start date so the gap check always walks true chronological
    // order, regardless of where each record physically sits in the PDF.
    const sorted = [...group].sort((a, b) => {
      const da = parseDate(a.stDate), db = parseDate(b.stDate);
      if (!da || !db) return 0;
      return da - db;
    });

    let currentRun = null;
    let seq = 0;
    for (const rec of sorted) {
      const st = parseDate(rec.stDate);
      let sameRun = false;

      if (currentRun) {
        if (runIdentificationSource === 'lot' && rec.lotNumber && currentRun.lotNumber) {
          sameRun = rec.lotNumber === currentRun.lotNumber;
        } else {
          const prevFi = parseDate(currentRun.records[currentRun.records.length - 1].fiDate);
          sameRun = !!(st && prevFi && daysBetween(prevFi, st) <= 1);
        }
      }

      if (sameRun) {
        currentRun.records.push(rec);
      } else {
        seq += 1;
        currentRun = { identity, records: [rec], runSeq: seq, lotNumber: rec.lotNumber || null };
        runs.push(currentRun);
      }
    }
  }
  return runs;
}

export function aggregateToStyleTrackingLevel(contMrpRecords, { runIdentificationSource = 'system' } = {}) {
  const runs = splitIntoRuns(contMrpRecords, runIdentificationSource);

  // Count total runs per (styleNo, trackingNumber, factoryLine) identity —
  // needed before assigning suffixes, since a style only ever gets one at
  // all when it has 2+ runs, even for its own 2nd/3rd/... occurrence.
  const totalRunsByIdentity = new Map();
  for (const run of runs) {
    totalRunsByIdentity.set(run.identity, (totalRunsByIdentity.get(run.identity) || 0) + 1);
  }

  const out = [];
  for (const run of runs) {
    const records = run.records;
    const styleNo = records[0].styleNo;
    const trackingNumber = records[0].trackingNumber || null;
    const factoryLine = records[0].factoryLine;

    const qtyTotal = records.reduce((sum, r) => sum + (Number(r.planQty) || 0), 0);
    const avgEffiVals = records.filter((r) => r.avgEffi != null).map((r) => Number(r.avgEffi)).filter((v) => !Number.isNaN(v));
    const avgEffiSimple = avgEffiVals.length ? avgEffiVals.reduce((a, b) => a + b, 0) / avgEffiVals.length : null;
    const prdDysVals = records.map((r) => Number(r.prdDys) || 0);
    const prdDysMax = prdDysVals.length ? Math.max(...prdDysVals) : null;

    // The run's own identifier: the Lot Number when using 'lot' mode and
    // one is actually present on these records, otherwise the system
    // sequence number — this is what makes two runs of the same style on
    // the same line distinguishable from each other.
    const runIdentifier = (runIdentificationSource === 'lot' && run.lotNumber) ? `lot${run.lotNumber}` : `run${run.runSeq}`;

    // Display-only suffix — never affects matching/comparison, which
    // continues to use styleNo + runIdentifier exactly as before. Visible
    // only when this style+tracking+line genuinely has more than one run.
    const duplicateSuffix = buildDuplicateSuffix(run.runSeq, totalRunsByIdentity.get(run.identity));
    const displayStyleNo = styleNo + duplicateSuffix;

    out.push({
      styleNo,
      displayStyleNo,
      trackingNumber,
      factoryLine,
      runSeq: run.runSeq,
      lotNumber: run.lotNumber,
      runIdentifier,
      garmentType: records[0].garmentType,
      splOpe: records[0].splOpe,
      acc: records[0].acc || null,
      similarBody: records[0].similarBody || null,
      tgtCut: records[0].tgtCut || null,
      tgt: records[0].tgt || null,
      avgEffi: avgEffiSimple != null ? Math.round(avgEffiSimple * 10) / 10 : null,
      prdDys: prdDysMax,
      stDate: fmt(earliest(records.map((r) => r.stDate))),
      fiDate: fmt(latest(records.map((r) => r.fiDate))),
      delDate: fmt(latest(records.map((r) => r.delDate))),
      delDate2nd: fmt(latest(records.map((r) => r.delDate2nd))),
      delDateCorrected: records.some((r) => r.delDateCorrected),
      planQtyTotal: qtyTotal,
      merchant: records[0].merchant, // display purposes only
    });
  }
  return out;
}
