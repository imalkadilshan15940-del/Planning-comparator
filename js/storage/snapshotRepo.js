// storage/snapshotRepo.js
// Domain-level operations on top of the raw IndexedDB helpers.

import { dbAdd, dbPut, dbGet, dbGetAll, dbGetAllByIndex } from './db.js';
import { buildDetailKey, buildStyleKey, matchByKey } from '../engine/keyMatcher.js';
import { diffRecord } from '../engine/fieldDiff.js';
import { classifySeverity, rollupStyleSeverity, rollupReportStatus, SEVERITY } from '../engine/severity.js';
import { aggregateToStyleTrackingLevel } from '../parser/rowAggregator.js';
import { parsePrintedDate, reportDate, compareReportsAsc, compareReportsDesc } from '../shared/dateUtils.js';
import { loadSettings } from '../settings/settingsManager.js';
import { buildSplOpeIndex, findWashTypeBySplOpe } from '../engine/splOpeMatch.js';
import { buildCommentCountIndex, getCommentCount } from './commentHistoryRepo.js';
import { getAllSplOpeMappings } from './splOpeMappingRepo.js';

/** Save a newly parsed report + its Cont/MRP detail records. Returns the saved report id. */
export async function saveIngestedReport({ filename, factory, printedDate, layoutVersion, contMrpRecords }) {
  const reportId = await dbAdd('reports', {
    filename,
    factory,
    printedDate,          // ISO string, from PDF "Printed on" line if found
    layoutVersion,
    ingestedAt: new Date().toISOString(),
    comparedAgainstReportId: null,
    totalStyles: 0,
    changedStyles: 0,
    criticalStyles: 0,
    status: 'processing',
  });

  const withReportId = contMrpRecords.map((r) => ({
    ...r,
    reportId,
    detailKey: buildDetailKey(r),
    delDateOriginal: r.delDate,   // the raw PDF-extracted value, never overwritten again
    delDateCorrected: false,      // set true by reapplyDeliveryCorrections() when a match is found
  }));
  for (const rec of withReportId) {
    await dbAdd('contMrpRecords', rec);
  }

  const { runIdentificationSource } = await loadSettings();
  const styleRows = aggregateToStyleTrackingLevel(withReportId, { runIdentificationSource }).map((s) => ({
    ...s,
    reportId,
    styleKey: buildStyleKey(s),
  }));
  for (const s of styleRows) {
    await dbAdd('styleRecords', s);
  }

  return reportId;
}

/**
 * saveIngestedReport, plus immediately flipping the new report out of the
 * transient 'processing' placeholder into 'ready'. Ingestion here is fully
 * synchronous/complete by the time this returns, whether the underlying
 * data came from directly parsing a PDF or from a pre-parsed JSON cache —
 * either way, without this flip the report would get stuck showing
 * "Processing…" forever (a real bug fixed earlier — consolidated here so
 * every ingestion path shares it rather than each needing its own copy).
 */
export async function saveIngestedReportReady(data) {
  const reportId = await saveIngestedReport(data);
  const savedReport = await dbGet('reports', reportId);
  if (savedReport) await dbPut('reports', { ...savedReport, status: 'ready' });
  return reportId;
}

/** Find the most recent prior report for the same factory (excluding the given report). */
export async function findPreviousReport(factory, excludingReportId, beforeDate) {
  const all = await dbGetAllByIndex('reports', 'factory', factory);
  const beforeD = beforeDate ? parsePrintedDate(beforeDate) : null;
  const candidates = all
    .filter((r) => r.id !== excludingReportId && r.status !== 'processing')
    .filter((r) => !beforeD || !reportDate(r) || reportDate(r) < beforeD)
    .sort(compareReportsDesc);
  return candidates[0] || null;
}

const enabledFieldsDefault = {
  productionFinishDate: true,
  merchant: true,
  trackingNumber: true,
  factoryLine: true,
  garmentType: true,
};

/**
 * Run the full comparison for a newly ingested report against its previous report
 * (same factory). Writes contmrp-level and style-level comparison rows, and
 * rolls the result up onto the report record itself (document-level status).
 */
export async function runComparison(currReportId, enabledFields = enabledFieldsDefault) {
  const currReport = await dbGet('reports', currReportId);
  const prevReport = await findPreviousReport(currReport.factory, currReportId, currReport.printedDate);

  const currDetail = await dbGetAllByIndex('contMrpRecords', 'reportId', currReportId);

  if (!prevReport) {
    // Baseline: nothing to compare against. Every style is "new", no severity.
    await dbPut('reports', {
      ...currReport,
      comparedAgainstReportId: null,
      totalStyles: new Set(currDetail.map((r) => r.styleKeyRef)).size || currDetail.length,
      changedStyles: 0,
      criticalStyles: 0,
      status: 'baseline',
    });
    return { status: 'baseline', prevReport: null };
  }

  const prevDetail = await dbGetAllByIndex('contMrpRecords', 'reportId', prevReport.id);
  const { matched, added, removed } = matchByKey(prevDetail, currDetail, buildDetailKey);

  const detailComparisons = [];

  for (const { prev, curr } of matched) {
    const diff = diffRecord(prev, curr, enabledFields);
    const severity = classifySeverity(diff);
    detailComparisons.push({
      prevReportId: prevReport.id,
      currReportId,
      level: 'contmrp',
      detailKey: buildDetailKey(curr),
      styleKey: buildStyleKey(curr),
      styleNo: curr.styleNo,
      contMrp: curr.contMrp,
      factoryLine: curr.factoryLine,
      changedFields: diff.changedFields,
      delayDays: diff.delayDays,
      severity: severity.priority,
      severityLabel: severity.label,
      isCritical: severity.priority <= 2,
      prevValues: diff.prevValues,
      currValues: diff.currValues,
    });
  }

  for (const rec of added) {
    detailComparisons.push({
      prevReportId: prevReport.id,
      currReportId,
      level: 'contmrp',
      detailKey: buildDetailKey(rec),
      styleKey: buildStyleKey(rec),
      styleNo: rec.styleNo,
      contMrp: rec.contMrp,
      factoryLine: rec.factoryLine,
      changedFields: ['__new__'],
      delayDays: 0,
      severity: SEVERITY.NEW.priority,
      severityLabel: SEVERITY.NEW.label,
      isCritical: false,
      prevValues: null,
      currValues: rec,
    });
  }

  for (const rec of removed) {
    detailComparisons.push({
      prevReportId: prevReport.id,
      currReportId,
      level: 'contmrp',
      detailKey: buildDetailKey(rec),
      styleKey: buildStyleKey(rec),
      styleNo: rec.styleNo,
      contMrp: rec.contMrp,
      factoryLine: rec.factoryLine,
      changedFields: ['__dropped__'],
      delayDays: 0,
      severity: SEVERITY.DROPPED.priority,
      severityLabel: SEVERITY.DROPPED.label,
      isCritical: false,
      prevValues: rec,
      currValues: null,
    });
  }

  for (const c of detailComparisons) await dbAdd('comparisons', c);

  // Roll detail comparisons up to style level: worst severity per styleKey.
  const byStyle = new Map();
  for (const c of detailComparisons) {
    const list = byStyle.get(c.styleKey) || [];
    list.push(c);
    byStyle.set(c.styleKey, list);
  }
  let changedStyleCount = 0;
  let criticalStyleCount = 0;
  for (const [styleKey, children] of byStyle.entries()) {
    const rolled = rollupStyleSeverity(children.map((c) => c.severity));
    const anyChanged = children.some((c) => c.severity !== SEVERITY.UNCHANGED.priority);
    if (anyChanged) changedStyleCount++;
    if (rolled <= 2) criticalStyleCount++;
    await dbAdd('comparisons', {
      prevReportId: prevReport.id,
      currReportId,
      level: 'style',
      styleKey,
      styleNo: children[0].styleNo,
      factoryLine: children[0].factoryLine,
      severity: rolled,
      severityLabel: Object.values(SEVERITY).find((s) => s.priority === rolled)?.label || 'Unchanged',
      isCritical: rolled <= 2,
      childCount: children.length,
    });
  }

  const totalStyleKeys = new Set([...prevDetail, ...currDetail].map((r) => buildStyleKey(r))).size;
  const status = rollupReportStatus({ changed: changedStyleCount, critical: criticalStyleCount });

  await dbPut('reports', {
    ...currReport,
    comparedAgainstReportId: prevReport.id,
    totalStyles: totalStyleKeys,
    changedStyles: changedStyleCount,
    criticalStyles: criticalStyleCount,
    status,
  });

  return { status, prevReport };
}

export async function getAllDetailRecordsAcrossReports() {
  const [records, reports, comparisons] = await Promise.all([
    dbGetAll('contMrpRecords'),
    dbGetAll('reports'),
    dbGetAll('comparisons'),
  ]);
  // Defensive filter: a genuine production row always has a Tracking Number;
  // the one row per Cont/MRP group without one is the grand-total rollup.
  // This also cleans up any such rows ingested before the parser fix,
  // without requiring the user to reset and re-ingest their data.
  const detailRecords = records.filter((r) => r.trackingNumber && r.trackingNumber !== '-');
  const reportById = new Map(reports.map((r) => [r.id, r]));

  // Only contmrp-level comparisons carry a per-record status; key by the
  // report they belong to + their detail key so we can look each record up.
  const statusByKey = new Map();
  for (const c of comparisons) {
    if (c.level !== 'contmrp') continue;
    statusByKey.set(`${c.currReportId}|${c.detailKey}`, c);
  }

  return detailRecords.map((rec) => {
    const report = reportById.get(rec.reportId);
    const detailKey = `${rec.styleNo}|${rec.contMrp || '_'}|${rec.trackingNumber || '_'}|${rec.factoryLine}`;
    const cmp = statusByKey.get(`${rec.reportId}|${detailKey}`);
    // No comparison entry means either: this report was a baseline (nothing
    // to compare against yet), or the record genuinely had zero changes.
    const statusLabel = cmp ? cmp.severityLabel : (report && report.status === 'baseline' ? 'Baseline' : 'Unchanged');
    const statusPriority = cmp ? cmp.severity : (report && report.status === 'baseline' ? 0 : 99);
    return {
      ...rec,
      reportFilename: report ? report.filename : '—',
      reportPrintedDate: report ? report.printedDate : null,
      reportFactory: report ? report.factory : rec.factoryLine,
      reportStatus: report ? report.status : null,
      changeStatus: statusLabel,
      changeStatusPriority: statusPriority,
    };
  });
}

/**
 * Full week-by-week history for one style (by styleKey = styleNo|factoryLine),
 * across EVERY report ever ingested for that factory — not just prev/current.
 * Returns entries sorted chronologically (oldest first), each carrying the
 * report's printed date/filename plus that week's ST/FI/Delivery values, and
 * a `changedFromPrev` flag/detail comparing it to the PREVIOUS WEEK THIS
 * STYLE ACTUALLY APPEARED IN (which may not be the immediately-adjacent
 * report, if the style skipped a week).
 */
/** Computes {changed, isCritical, qtyShiftType, prevPlanQtyTotal} for any (prev, curr) pair. */
function daysBetween(dateStrA, dateStrB) {
  if (!dateStrA || !dateStrB) return null;
  const d1 = parseLocalDate(dateStrA), d2 = parseLocalDate(dateStrB);
  if (!d1 || !d2) return null;
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

/**
 * Compares one style+tracking+line entry against its baseline (prev may be
 * null for a style's first-ever appearance). Thresholds gate STATUS-PSD:
 *   - stThresholdDays: how many days ST can slip before it's "tight"
 *   - deliveryThresholdDays: how many days Delivery can extend and still
 *     count as "not compensating" for the ST slip
 * STATUS-PSD deliberately excludes ST from the general FI/Delivery changed
 * check — ST movement is evaluated entirely through the threshold rule.
 * STYLE MOVEMENT is independent of STATUS-PSD, driven purely by the sign
 * of stLaterByDays.
 */
function compareEntries(prev, curr, thresholds = {}) {
  const stThresholdDays = thresholds.stThresholdDays ?? 3;
  const deliveryThresholdDays = thresholds.deliveryThresholdDays ?? 3;

  const stChanged = prev ? prev.stDate !== curr.stDate : false;
  const fiChanged = prev ? prev.fiDate !== curr.fiDate : false;
  const deliveryChanged = prev ? prev.delDate !== curr.delDate : false;

  const stLaterByDays = prev ? daysBetween(prev.stDate, curr.stDate) : null;       // > 0 = pushed later
  const deliveryDeltaDays = prev ? daysBetween(prev.delDate, curr.delDate) : null; // > 0 = pushed later/extended

  let statusPSD = null; // null means "no baseline" — caller resolves to NOT PRE DATA or NEW
  if (prev) {
    const isTight = stLaterByDays != null && stLaterByDays > stThresholdDays
      && (deliveryDeltaDays == null || deliveryDeltaDays <= deliveryThresholdDays);
    if (isTight) statusPSD = 'TIGH PRO-PSD';
    else if (fiChanged || deliveryChanged) statusPSD = 'CHANGED-FI/DEL';
    else statusPSD = 'UNCHANGED-PSD';
  }

  let styleMovement;
  if (stLaterByDays == null || stLaterByDays === 0) styleMovement = 'NO MOVEMENT';
  else styleMovement = stLaterByDays > 0 ? 'Push Back' : 'Advance';

  // Qty Shift is unrelated to the threshold system — still fires on any ST
  // change at all, to explain whether the whole order or just the balance moved.
  let qtyShiftType = null;
  if (stChanged && prev && prev.planQtyTotal != null && curr.planQtyTotal != null && prev.planQtyTotal > 0) {
    const ratio = curr.planQtyTotal / prev.planQtyTotal;
    if (ratio >= 0.97) qtyShiftType = 'full';
    else if (ratio < 0.97 && curr.planQtyTotal < prev.planQtyTotal) qtyShiftType = 'balance';
    if (ratio > 1.03) qtyShiftType = 'increased';
  }

  return {
    changed: { stDate: stChanged, fiDate: fiChanged, delDate: deliveryChanged },
    stLaterByDays, deliveryDeltaDays,
    statusPSD, styleMovement, qtyShiftType,
    prevPlanQtyTotal: prev ? prev.planQtyTotal : null,
  };
}

export async function getStyleTimeline(styleKey) {
  const [styleRows, reports, settings] = await Promise.all([
    dbGetAllByIndex('styleRecords', 'styleKey', styleKey),
    dbGetAll('reports'),
    loadSettings(),
  ]);
  const reportById = new Map(reports.map((r) => [r.id, r]));
  const thresholds = { stThresholdDays: settings.stThresholdDays, deliveryThresholdDays: settings.deliveryThresholdDays };

  const entries = styleRows
    .map((s) => ({ ...s, report: reportById.get(s.reportId) }))
    .filter((e) => e.report)
    .sort((a, b) => compareReportsAsc(a.report, b.report));

  for (let i = 0; i < entries.length; i++) {
    const prev = i > 0 ? entries[i - 1] : null;
    const curr = entries[i];
    const cmp = compareEntries(prev, curr, thresholds);
    curr.changedFromPrev = cmp.changed;
    curr.statusPSD = cmp.statusPSD; // null at i===0; resolved by the caller (report-level baseline vs new style)
    curr.styleMovement = cmp.styleMovement;
    curr.stLaterByDays = cmp.stLaterByDays;
    curr.deliveryDeltaDays = cmp.deliveryDeltaDays;
    curr.weekIndex = i + 1;
    curr.qtyShiftType = cmp.qtyShiftType;
    curr.prevPlanQtyTotal = cmp.prevPlanQtyTotal;
  }

  return entries;
}

/**
 * Factory & Line movement history for a Style Number or Tracking Number,
 * across every planning report on record — deliberately searches by
 * styleNo/trackingNumber rather than styleKey, since styleKey is scoped to
 * one specific factory+line and would never reveal movement between them.
 * Returns null if no matching records exist at all.
 */
export async function getFactoryLineMovementHistory(searchTerm) {
  const term = String(searchTerm || '').trim().toUpperCase();
  if (!term) return null;

  const [allStyleRecords, reports] = await Promise.all([
    dbGetAll('styleRecords'),
    dbGetAll('reports'),
  ]);
  const reportById = new Map(reports.map((r) => [r.id, r]));

  const matches = allStyleRecords.filter((s) => {
    const styleNo = String(s.styleNo || '').toUpperCase();
    const tracking = String(s.trackingNumber || '').toUpperCase();
    return styleNo === term || tracking === term;
  });
  if (matches.length === 0) return null;

  // One entry per distinct printed date — if multiple records share the
  // same date (e.g. two runs of a split style), the most recently
  // ingested one wins, since they're both describing the same point in
  // time for movement-tracking purposes.
  const byDate = new Map();
  for (const s of matches) {
    const report = reportById.get(s.reportId);
    if (!report) continue;
    const printedDate = report.printedDate || report.ingestedAt;
    if (!printedDate) continue;
    const factory = report.factory || (s.factoryLine || '').split(' ')[0] || 'Unknown';
    const line = (s.factoryLine || '').startsWith(factory) ? (s.factoryLine || '').slice(factory.length).trim() : (s.factoryLine || '');
    const key = printedDate;
    const existing = byDate.get(key);
    if (!existing || (report.ingestedAt || '') > (existing.ingestedAt || '')) {
      byDate.set(key, {
        printedDate,
        parsedDate: parsePrintedDate(printedDate),
        factory,
        line: line || '—',
        factoryLine: s.factoryLine,
        styleNo: s.styleNo,
        displayStyleNo: s.displayStyleNo,
        trackingNumber: s.trackingNumber,
        ingestedAt: report.ingestedAt,
      });
    }
  }

  const entries = [...byDate.values()]
    .filter((e) => e.parsedDate)
    .sort((a, b) => a.parsedDate - b.parsedDate);
  if (entries.length === 0) return null;

  for (let i = 0; i < entries.length; i++) {
    const prev = i > 0 ? entries[i - 1] : null;
    const curr = entries[i];
    if (!prev) {
      curr.movementType = 'first';
    } else {
      const factoryChanged = prev.factory !== curr.factory;
      const lineChanged = prev.line !== curr.line;
      if (factoryChanged && lineChanged) curr.movementType = 'factory-and-line';
      else if (factoryChanged) curr.movementType = 'factory';
      else if (lineChanged) curr.movementType = 'line';
      else curr.movementType = 'none';
    }
  }

  return entries;
}


function parseLocalDate(s) {
  if (!s) return null;
  const parts = String(s).split('/').map(Number);
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  const yyyy = y < 100 ? 2000 + y : y;
  return new Date(yyyy, m - 1, d);
}

/**
 * Changed-styles view for ONE report, but computed against each style's
 * full chronological history (via getStyleTimeline) rather than just the
 * immediately-previous report — so a style that skipped a week, or whose
 * relevant change happened further back, is still correctly compared
 * against its own true last-known values.
 */
/**
 * Changed-styles view for ONE report. `lookback` controls how far back the
 * comparison baseline is:
 *   1 (default) — the style's immediately-previous appearance (normal case)
 *   N           — the appearance N reports back in that style's own history
 *   'all'       — the very first (oldest) appearance on record
 * In every case the baseline is chosen from the style's own chronological
 * timeline (gap-aware — a style that skipped a week is still compared
 * against its true Nth-back appearance, not a miscounted calendar report).
 */
export async function getChangedStylesForReport(reportId, lookback = 1) {
  const [styleRows, currentReport, allReports, settings, splOpeMappingRows, commentCountIndex] = await Promise.all([
    dbGetAllByIndex('styleRecords', 'reportId', reportId),
    dbGet('reports', reportId),
    dbGetAll('reports'),
    loadSettings(),
    getAllSplOpeMappings(),
    buildCommentCountIndex(),
  ]);
  const thresholds = { stThresholdDays: settings.stThresholdDays, deliveryThresholdDays: settings.deliveryThresholdDays };
  const splOpeIndex = buildSplOpeIndex(splOpeMappingRows);

  // Is this the factory's very first report on record? If so, EVERY style in
  // it has no baseline to compare against — NOT PRE DATA. Otherwise, a style
  // with no prior appearance of its own (but the report itself has history)
  // is NEW, not baseline.
  const isReportBaseline = currentReport
    ? !allReports.some((r) => r.factory === currentReport.factory && r.id !== reportId && r.status !== 'processing' && reportDate(r) && reportDate(currentReport) && reportDate(r) < reportDate(currentReport))
    : false;

  const results = [];
  for (const s of styleRows) {
    const timeline = await getStyleTimeline(s.styleKey);
    const idx = timeline.findIndex((e) => e.reportId === reportId);
    if (idx === -1) continue;
    const curr = timeline[idx];

    let prevIdx;
    if (lookback === 'all') prevIdx = 0;
    else prevIdx = Math.max(0, idx - Math.max(1, Number(lookback) || 1));
    const prev = (idx > 0 && prevIdx < idx) ? timeline[prevIdx] : null;

    // Which delivery date STATUS-PSD/STATUS-DEL/GAP/Movement are actually
    // calculated against — curr.delDate and prev.delDate themselves are
    // never touched here, so display always shows the true original
    // regardless of this mode. In '2nd' mode, a style with no correction
    // of its own falls back to its original delivery date for the
    // calculation, rather than being left with nothing to calculate against.
    const effectiveDelDate = (entry) => {
      if (!entry) return null;
      return settings.delDateCalcMode === '2nd' ? (entry.delDate2nd || entry.delDate) : entry.delDate;
    };
    const currForCalc = { ...curr, delDate: effectiveDelDate(curr) };
    const prevForCalc = prev ? { ...prev, delDate: effectiveDelDate(prev) } : null;

    const cmp = compareEntries(prevForCalc, currForCalc, thresholds);
    let statusPSD = cmp.statusPSD;
    if (!prev) statusPSD = isReportBaseline ? 'NOT PRE DATA' : 'NEW';

    const isChanged = statusPSD !== 'UNCHANGED-PSD' && statusPSD !== 'NOT PRE DATA';
    const isCritical = statusPSD === 'TIGH PRO-PSD';

    // STATUS-DEL: entirely independent of STATUS-PSD above. Gap = Delivery
    // Date - FI, using whatever Delivery Date is currently in effect
    // (post-correction). Wash Type comes from the uploaded mapping,
    // defaulting to 'Non Wash' when unmapped.
    const { washType } = findWashTypeBySplOpe(splOpeIndex, s.splOpe);
    const gapFiDel = daysBetween(curr.fiDate, currForCalc.delDate);
    const delThreshold = washType === 'Wash' ? settings.washThresholdDays : settings.nonWashThresholdDays;
    const statusDEL = gapFiDel == null ? null : (gapFiDel >= delThreshold ? 'SAFE' : 'CRITICAL-DEL');
    const isCriticalDel = statusDEL === 'CRITICAL-DEL';
    const commentCount = getCommentCount(commentCountIndex, s.styleNo, s.trackingNumber, s.factoryLine);

    // Report History should reflect the actual comparison window being
    // used — from the lookback baseline through the current report — not
    // the style's entire history regardless of what lookback is set to.
    const windowStart = prevIdx != null ? prevIdx : idx;
    const allPrintedDates = timeline
      .slice(windowStart, idx + 1)
      .map((e) => e.report.printedDate || e.report.ingestedAt)
      .filter(Boolean);

    results.push({
      id: s.id,
      styleKey: s.styleKey,
      commentCount,
      styleNo: s.styleNo,
      displayStyleNo: s.displayStyleNo,
      runIdentifier: s.runIdentifier,
      trackingNumber: s.trackingNumber,
      factoryLine: s.factoryLine,
      acc: s.acc,
      similarBody: s.similarBody,
      garmentType: s.garmentType,
      prdDys: s.prdDys,
      avgEffi: s.avgEffi,
      tgtCut: s.tgtCut,
      tgt: s.tgt,
      stDate: curr.stDate,
      fiDate: curr.fiDate,
      delDate: curr.delDate,
      delDate2nd: curr.delDate2nd,
      delDateCorrected: !!curr.delDateCorrected,
      planQtyTotal: curr.planQtyTotal,
      prevPlanQtyTotal: cmp.prevPlanQtyTotal,
      qtyShiftType: cmp.qtyShiftType,
      stDelayDays: cmp.stLaterByDays,       // "Movement Days-PSD" in the UI
      movementDaysPSD: cmp.stLaterByDays,
      styleMovement: statusPSD === 'NOT PRE DATA' || statusPSD === 'NEW' ? 'NO MOVEMENT' : cmp.styleMovement,
      statusPSD,
      isChanged,
      isCritical,
      washType,
      gapFiDel,
      statusDEL,
      isCriticalDel,
      changedSinceReport: prev ? prev.report : null,
      changedSincePrintedDate: prev ? (prev.report.printedDate || prev.report.ingestedAt) : null,
      allPrintedDates,
      timeline: timeline.slice(windowStart, idx + 1),
    });
  }
  return results;
}

/** Same as above, but across the LATEST report of every factory (or one factory), for the main working screen. */
export async function getChangedStylesAcrossLatestReports(factoryFilter = null, lookback = 1) {
  const reports = await getAllReports(); // already sorted newest-first
  const latestByFactory = new Map();
  for (const r of reports) {
    if (factoryFilter && r.factory !== factoryFilter) continue;
    if (r.status === 'processing') continue;
    if (!latestByFactory.has(r.factory)) latestByFactory.set(r.factory, r);
  }
  const combined = [];
  for (const report of latestByFactory.values()) {
    const rows = await getChangedStylesForReport(report.id, lookback);
    combined.push(...rows.map((r) => ({ ...r, report })));
  }
  return combined;
}

/**
 * All Style+Tracking+Line records across every ingested report (not just the
 * latest), for the All Styles page. Reuses getChangedStylesForReport's exact
 * comparison logic for every report, so Status/Style Movement here always
 * agree with what Changed Styles shows for the same document.
 */
export async function getAllStyleTrackingRecordsAcrossReports(lookback = 1) {
  const reports = await getAllReports();
  const combined = [];
  for (const report of reports) {
    if (report.status === 'processing') continue;
    const rows = await getChangedStylesForReport(report.id, lookback);
    combined.push(...rows.map((r) => ({ ...r, report })));
  }
  return combined;
}

export async function getAllReports() {
  const reports = await dbGetAll('reports');
  return reports.sort(compareReportsDesc);
}

export async function getComparisonsForReport(reportId, level = 'style') {
  const all = await dbGetAllByIndex('comparisons', 'currReportId', reportId);
  return all.filter((c) => c.level === level);
}

export async function getDetailChildren(reportId, styleKey) {
  const all = await dbGetAllByIndex('comparisons', 'currReportId', reportId);
  return all.filter((c) => c.level === 'contmrp' && c.styleKey === styleKey);
}
