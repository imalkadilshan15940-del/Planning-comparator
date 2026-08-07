// storage/deliveryCorrectionsRepo.js
//
// Delivery Date from the PDF is sometimes wrong; another department's report
// has the correct value. This module stores that correction table and
// re-applies it across every Cont/MRP record (and re-aggregates the
// style-level rollups) whenever asked — on Fetch Documents, and on app load.
//
// The ORIGINAL PDF-extracted Delivery Date is never discarded: it lives in
// `delDateOriginal` on every contMrpRecord, set once at ingestion and never
// touched again. `delDate` is the CURRENT EFFECTIVE value shown everywhere,
// and `delDateCorrected` (bool) says whether it currently came from a
// correction (green in the UI) or is still the original PDF value (orange).
// Re-running the reapply after a correction is removed/replaced correctly
// reverts affected records back to their original PDF date.

import { dbAdd, dbPut, dbGet, dbGetAll, dbGetAllByIndex, dbClearStore } from './db.js';
import { aggregateToStyleTrackingLevel } from '../parser/rowAggregator.js';
import { buildStyleKey } from '../engine/keyMatcher.js';
import { buildCorrectionIndex, findCorrection } from '../engine/deliveryCorrectionMatch.js';
import { loadSettings } from '../settings/settingsManager.js';

export async function saveDeliveryCorrections(rows, mode) {
  if (mode === 'replace') {
    await dbClearStore('deliveryCorrections');
  }
  const uploadedAt = new Date().toISOString();

  if (mode === 'merge') {
    const existing = await dbGetAll('deliveryCorrections');
    const matchKeys = { trackingNumber: true, factoryLine: true }; // merge always keys on the fullest identity to avoid accidental collisions
    const existingIndex = buildCorrectionIndex(existing, matchKeys);
    for (const row of rows) {
      const key = { styleNo: row.styleNo, trackingNumber: row.trackingNumber, factoryLine: row.factoryLine };
      const match = findCorrection(existingIndex, key, matchKeys);
      if (match) {
        await dbPut('deliveryCorrections', { ...match, ...row, uploadedAt });
      } else {
        await dbAdd('deliveryCorrections', { ...row, uploadedAt });
      }
    }
  } else {
    for (const row of rows) {
      await dbAdd('deliveryCorrections', { ...row, uploadedAt });
    }
  }
}

export async function getAllDeliveryCorrections() {
  return dbGetAll('deliveryCorrections');
}

/**
 * Removes every delivery-date correction and reverts every affected record
 * back to its original PDF-extracted Delivery Date. This is just
 * "reapply with an empty corrections table" — the same revert logic
 * reapplyDeliveryCorrections already uses when a correction is removed —
 * so nothing new to get wrong here.
 */
export async function resetAllDeliveryCorrections() {
  await dbClearStore('deliveryCorrections');
  return reapplyDeliveryCorrections();
}

export async function getDeliveryCorrectionsMeta() {
  const rows = await dbGetAll('deliveryCorrections');
  const latest = rows.reduce((max, r) => (!max || r.uploadedAt > max ? r.uploadedAt : max), null);
  return { count: rows.length, lastUploadedAt: latest };
}

/**
 * Runs the lookup-and-replace across every stored Cont/MRP record, using
 * whichever match-key fields are currently enabled, then re-aggregates each
 * affected report's style-level rows so downstream comparisons see the
 * corrected date too. Returns { correctedCount, failedStyles } where
 * failedStyles is only meaningful (and only returned) when corrections exist.
 */
export async function reapplyDeliveryCorrections(matchKeys = { trackingNumber: true, factoryLine: true }) {
  const corrections = await dbGetAll('deliveryCorrections');
  const hasCorrections = corrections.length > 0;
  const correctionIndex = buildCorrectionIndex(corrections, matchKeys);

  const allContMrp = await dbGetAll('contMrpRecords');
  let correctedCount = 0;
  const failedStyleKeys = new Set();
  const reportIdsTouched = new Set();

  for (const rec of allContMrp) {
    if (rec.delDateOriginal == null) rec.delDateOriginal = rec.delDate; // backfill for records from before this feature existed

    const match = hasCorrections ? findCorrection(correctionIndex, rec, matchKeys) : null;
    const newDelDate2nd = match ? match.deliveryDate : null;
    const newCorrected = !!match;

    // delDate itself is never modified — it always stays the original
    // PDF-extracted value. Only delDate2nd (the correction, when one
    // exists) changes here.
    if (rec.delDate2nd !== newDelDate2nd || rec.delDateCorrected !== newCorrected) {
      rec.delDate2nd = newDelDate2nd;
      rec.delDateCorrected = newCorrected;
      await dbPut('contMrpRecords', rec);
      reportIdsTouched.add(rec.reportId);
    }
    if (match) correctedCount++;
    else if (hasCorrections) failedStyleKeys.add(`${rec.styleNo}|${rec.factoryLine}`);
  }

  // Re-aggregate style-level rows for every report that had a record change,
  // so Changed Styles / Dashboard / exports all see the corrected values.
  const { runIdentificationSource } = await loadSettings();
  for (const reportId of reportIdsTouched) {
    const contMrpForReport = allContMrp.filter((r) => r.reportId === reportId);
    const rolledUp = aggregateToStyleTrackingLevel(contMrpForReport, { runIdentificationSource });
    const existingStyleRows = await dbGetAllByIndex('styleRecords', 'reportId', reportId);
    const existingByKey = new Map(existingStyleRows.map((s) => [s.styleKey, s]));

    for (const rolled of rolledUp) {
      const styleKey = buildStyleKey(rolled);
      const existing = existingByKey.get(styleKey);
      const updated = { ...(existing || {}), ...rolled, reportId, styleKey };
      await dbPut('styleRecords', updated);
    }
  }

  let failedStyles = [];
  if (hasCorrections && failedStyleKeys.size > 0) {
    failedStyles = allContMrp
      .filter((r) => failedStyleKeys.has(`${r.styleNo}|${r.factoryLine}`))
      .reduce((list, r) => {
        if (!list.some((x) => x.styleNo === r.styleNo && x.factoryLine === r.factoryLine)) {
          list.push({ styleNo: r.styleNo, factoryLine: r.factoryLine, trackingNumber: r.trackingNumber, currentDelDate: r.delDate });
        }
        return list;
      }, []);
  }

  return { correctedCount, failedStyles, hasCorrections };
}
