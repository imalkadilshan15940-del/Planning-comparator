// engine/severity.js
// Priority 1 is the most severe (lowest number = highest severity), matching
// the "highest priority" language in the master prompt. A record can match
// more than one rule; the engine records the single highest-priority match
// but the full changedFields list (from fieldDiff) preserves everything else
// for the audit trail.

export const SEVERITY = {
  P1_CRITICAL: { priority: 1, label: 'Critical', color: '#B03040', key: 'critical' },
  P2_COMPOUND: { priority: 2, label: 'Critical (Compounding)', color: '#7A1F2B', key: 'critical' },
  P3_DELIVERY: { priority: 3, label: 'Delivery Delayed', color: '#B8791A', key: 'changed' },
  P4_FINISH: { priority: 4, label: 'Finish Date Changed', color: '#1E6690', key: 'changed' },
  P5_MERCHANT: { priority: 5, label: 'Merchant Changed', color: '#6B3391', key: 'changed' },
  NEW: { priority: 6, label: 'New', color: '#2E7D5B', key: 'changed' },
  DROPPED: { priority: 7, label: 'Dropped', color: '#8494A2', key: 'changed' },
  UNCHANGED: { priority: 99, label: 'Unchanged', color: '#8494A2', key: 'unchanged' },
};

/**
 * diff: the object returned by fieldDiff.diffRecord()
 */
export function classifySeverity(diff) {
  const stLater = (diff.stLaterByDays || 0) > 0;
  const deliveryDelayed = (diff.deliveryDeltaDays || 0) > 0;
  const deliveryEarlier = (diff.deliveryDeltaDays || 0) < 0;
  const deliveryUnchanged = !diff.deliveryChanged;

  // Priority 1 — the core business rule: ST pushed later, Delivery unchanged.
  if (stLater && deliveryUnchanged) return SEVERITY.P1_CRITICAL;

  // Priority 2 — compounding: ST later AND delivery pulled earlier.
  if (stLater && deliveryEarlier) return SEVERITY.P2_COMPOUND;

  // Priority 3 — delivery delayed (regardless of ST).
  if (deliveryDelayed) return SEVERITY.P3_DELIVERY;

  // Priority 4 — Finish Date changed only.
  if (diff.changedFields.includes('fiDate')) return SEVERITY.P4_FINISH;

  // Priority 5 — Merchant changed.
  if (diff.changedFields.includes('merchant')) return SEVERITY.P5_MERCHANT;

  if (diff.changedFields.length > 0) {
    // Some other enabled field changed (tracking, factory, garment type)
    // without tripping a higher-priority rule — still "changed", low severity.
    return { priority: 8, label: 'Other Field Changed', color: '#5B6B79', key: 'changed' };
  }

  return SEVERITY.UNCHANGED;
}

/** Worst (most severe = lowest priority number) among a style's Cont/MRP children. */
export function rollupStyleSeverity(childPriorities) {
  if (!childPriorities.length) return SEVERITY.UNCHANGED.priority;
  return Math.min(...childPriorities);
}

/** Document-level status for the Reports view. */
export function rollupReportStatus({ changed, critical }) {
  if (critical > 0) return 'critical';
  if (changed > 0) return 'changed';
  return 'unchanged';
}
