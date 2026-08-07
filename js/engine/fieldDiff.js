// engine/fieldDiff.js
// Compares one matched (prev, curr) record pair over the currently enabled fields.
// ST vs Delivery Date is ALWAYS evaluated — it is the tool's core purpose and is
// not gated by any checkbox. Everything else respects the enabledFields toggles.

function parseDate(str) {
  if (!str) return null;
  // Dates in the source are M/D/YY, e.g. 7/17/26
  const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, da, yr] = m;
  yr = yr.length === 2 ? `20${yr}` : yr;
  return new Date(Number(yr), Number(mo) - 1, Number(da));
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

const OPTIONAL_FIELD_MAP = {
  productionFinishDate: { key: 'fiDate', label: 'Production Finish Date (FI)', isDate: true },
  merchant: { key: 'merchant', label: 'Merchant', isDate: false },
  trackingNumber: { key: 'trackingNumber', label: 'Tracking Number', isDate: false },
  factoryLine: { key: 'factoryLine', label: 'Factory / Line', isDate: false },
  garmentType: { key: 'garmentType', label: 'Garment Type', isDate: false },
};

export function diffRecord(prev, curr, enabledFields) {
  const changedFields = [];
  const prevValues = {};
  const currValues = {};

  // --- Always-on Priority-1 signal: ST vs Delivery Date ---
  const prevSt = parseDate(prev.stDate);
  const currSt = parseDate(curr.stDate);
  const prevDel = parseDate(prev.delDate);
  const currDel = parseDate(curr.delDate);

  const stChanged = prev.stDate !== curr.stDate;
  const stLaterByDays = prevSt && currSt ? daysBetween(prevSt, currSt) : null; // positive = later
  const deliveryChanged = prev.delDate !== curr.delDate;
  const deliveryDeltaDays = prevDel && currDel ? daysBetween(prevDel, currDel) : null; // positive = later/delayed

  prevValues.stDate = prev.stDate;
  currValues.stDate = curr.stDate;
  prevValues.delDate = prev.delDate;
  currValues.delDate = curr.delDate;
  if (stChanged) changedFields.push('stDate');
  if (deliveryChanged) changedFields.push('delDate');

  // --- Optional, checkbox-gated fields ---
  for (const [toggleKey, meta] of Object.entries(OPTIONAL_FIELD_MAP)) {
    if (!enabledFields[toggleKey]) continue;
    const pv = prev[meta.key];
    const cv = curr[meta.key];
    prevValues[meta.key] = pv;
    currValues[meta.key] = cv;
    if (pv !== cv) changedFields.push(meta.key);
  }

  const leadTimePrev = prevSt && prevDel ? daysBetween(prevSt, prevDel) : null;
  const leadTimeCurr = currSt && currDel ? daysBetween(currSt, currDel) : null;
  const leadTimeDelta = leadTimePrev != null && leadTimeCurr != null ? leadTimeCurr - leadTimePrev : null;

  return {
    changedFields,
    prevValues,
    currValues,
    stChanged,
    stLaterByDays,       // > 0 means pushed later
    deliveryChanged,
    deliveryDeltaDays,   // > 0 means delivery pushed later (delayed)
    leadTimeDelta,        // negative = lead time shrank (bad)
    delayDays: stLaterByDays && stLaterByDays > 0 ? stLaterByDays : (deliveryDeltaDays || 0),
  };
}
