// settings/settingsManager.js

import { dbGet, dbPut } from '../storage/db.js';

export const DEFAULT_SETTINGS = {
  enabledFields: {
    productionFinishDate: true,
    merchant: false,
    trackingNumber: false,
    factoryLine: false,
    garmentType: false,
  },
  highlightColors: {
    1: '#B03040', // Critical
    2: '#7A1F2B', // Critical (compounding), dark red
    3: '#B8791A', // Delivery delayed, orange
    4: '#1E6690', // Finish date changed, blue
    5: '#6B3391', // Merchant changed, purple
  },
  qtyShiftColors: {
    full: '#B8791A',      // Full Shift
    balance: '#B03040',   // Balance Shift
    increased: '#1E6690', // Qty Increased
  },
  // Matching/comparison now happens at Style No + Tracking No + Line level.
  // ST movement beyond stThresholdDays (with Delivery not extended beyond
  // deliveryThresholdDays) is what drives TIGH PRO-PSD.
  stThresholdDays: 3,
  deliveryThresholdDays: 3,
  statusColors: {
    'TIGH PRO-PSD': '#B03040',
    'CHANGED-FI/DEL': '#B8791A',
    'UNCHANGED-PSD': '#8494A2',
    'NOT PRE DATA': '#1E6690',
    'NEW': '#2E7D5B',
  },
  deliveryMatchKeys: {
    trackingNumber: true, // Style Number is always required and not toggleable
    factoryLine: true, // combined Factory+Line value, matched against the PDF's own factoryLine field
  },
  // Configurable column letters for the Delivery Date corrections upload
  // (Style_Common_Information-style export). Header row is fixed at row 5
  // and data starts at row 6 per spec; only the column letters are
  // user-editable, so a differently-laid-out export of the same report
  // doesn't require touching the application.
  deliveryTemplateColumns: {
    styleNo: 'B',
    trackingNumber: 'C',
    factory: 'G',
    lineNo: 'H',
    deliveryDate: 'L',
  },
  // Column letters for the Special Operations master data upload — which
  // column holds the lookup code vs. the Wash Status value, user-editable
  // just like deliveryTemplateColumns above, for the same reason: a
  // differently-laid-out export of the same master data shouldn't require
  // a code change.
  splOpeTemplateColumns: {
    splOpeCode: 'B',
    washStatus: 'C',
  },
  splOpeDataStartRow: 2,
  // Split production runs: when the same Style+Tracking+Line is
  // interrupted by another style and resumes later, each continuous run
  // needs its own identity so it isn't silently re-merged. 'system' uses
  // an internally-generated sequence number (works today, no PDF changes
  // needed). 'lot' uses the source PDF's own Lot Number column once it's
  // added there — until then this setting has no real column to read, so
  // it's a future-ready option, not yet functional.
  runIdentificationSource: 'system',
  // Which delivery date STATUS-PSD, STATUS-DEL, GAP OF FI & DEL, and
  // Movement are calculated against — shared across All Styles and
  // Changed Styles by design, not independent per page, since it
  // represents a single "which delivery date do we currently trust"
  // decision that should mean the same thing everywhere in the app.
  delDateCalcMode: 'loading', // 'loading' (original PDF) or '2nd' (uploaded correction, falling back to original per-row when a style has no correction)
  // STATUS-DEL: independent from STATUS-PSD. Gap = Delivery Date - FI, in
  // days. Wash Type is looked up by Style Number alone (a physical garment
  // property, so it applies uniformly across a style's Tracking/Line
  // variants) and defaults to 'Non Wash' when no mapping entry exists.
  washThresholdDays: 7,
  nonWashThresholdDays: 5,
  statusDelColors: {
    'SAFE': '#2E7D5B',
    'CRITICAL-DEL': '#B03040',
  },
  // Persisted drag-and-drop column order per page — empty means "use the
  // built-in default order" (see shared/columnOrder.js).
  allStylesColumnOrder: [],
  changedStylesColumnOrder: [],
  allStylesColumnWidths: {},
  changedStylesColumnWidths: {},
  allStylesHiddenColumns: null, // null = use DEFAULT_HIDDEN; an array means the user has explicitly saved a layout
  changedStylesHiddenColumns: null,
  reportsLookback: {
    mode: 'count', // 'count' | 'all'
    count: 1,
  },
  theme: 'light',
  pollIntervalMs: 8000,
  zoomLevel: 100,
  fontSettings: {
    // Sizes rebased so 100% zoom (the new default, below) renders at the
    // exact same visual size these used to render at under the old 85%
    // default zoom — this used to rely on an artificial shrink to look
    // right; now "100%" genuinely means unscaled.
    title: { family: "'Zilla Slab', serif", size: 18.5 },
    header: { family: "'Inter', sans-serif", size: 9.5 },
    sidebar: { family: "'Inter', sans-serif", size: 11.5 },
    data: { family: "'Inter', sans-serif", size: 12.5 },
  },
};

export async function loadSettings() {
  const rec = await dbGet('settings', 'appSettings');
  if (!rec) return structuredClone(DEFAULT_SETTINGS);
  return { ...structuredClone(DEFAULT_SETTINGS), ...rec.value };
}

export async function saveSettings(settings) {
  await dbPut('settings', { key: 'appSettings', value: settings });
}

export function criticalFieldsDisabledWarning(enabledFields) {
  // ST vs Delivery is always on regardless of settings, so there is nothing
  // the user can disable that removes Priority-1 detection. This helper is
  // kept for UI messaging if that ever changes.
  return null;
}
