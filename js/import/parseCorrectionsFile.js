// import/parseCorrectionsFile.js
//
// New format (Style_Common_Information-style export):
//   - B3: a report-level date (labeled "Ex-Factory Date To" in the source
//     file) — stored as the document date for this upload.
//   - Row 5: header labels (fixed position; not itself used for column
//     mapping — see below).
//   - Row 6 onward: data.
//   - WHICH column holds which field is user-configured by letter in
//     Settings (default B/C/G/H/L for Style/Tracking/Factory/Line/Delivery
//     Date) — extraction is positional by letter, not by matching header
//     text, so a re-ordered export of the same report needs a Settings
//     change, not a code change.
//
// Factory and Line are combined into a single value in the same format the
// planning PDF itself uses (e.g. "KGG 02" — space-separated, 2-digit
// zero-padded line number), since that combined value is compared directly
// against the PDF's own factoryLine field at match time.

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function colLetterToIndex(letter) {
  return XLSX.utils.decode_col(String(letter || 'A').trim().toUpperCase());
}

/** Normalizes any date value (JS Date, Excel serial, or common text formats) to M/D/YY. */
function normalizeDateValue(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getMonth() + 1}/${value.getDate()}/${String(value.getFullYear()).slice(2)}`;
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.m}/${parsed.d}/${String(parsed.y).slice(2)}`;
  }

  const str = String(value).replace(/\s+/g, ' ').trim();
  if (!str) return null;

  // M/D/YYYY or M-D-YYYY (also 2-digit year)
  let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${Number(mo)}/${Number(da)}/${yr.length === 4 ? yr.slice(2) : yr}`;
  }
  // ISO: YYYY-MM-DD
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const [, yr, mo, da] = m;
    return `${Number(mo)}/${Number(da)}/${yr.slice(2)}`;
  }
  // "7-Feb-2026", "7 Feb 2026", "07-FEB-26"
  m = str.match(/^(\d{1,2})[\s\-](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-](\d{2,4})$/i);
  if (m) {
    const [, da, monName, yr] = m;
    const mo = MONTH_NAMES[monName.toLowerCase()];
    return `${mo}/${Number(da)}/${yr.length === 4 ? yr.slice(2) : yr}`;
  }
  // "Feb 7, 2026" / "Feb 7 2026"
  m = str.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s]+(\d{1,2}),?\s+(\d{2,4})$/i);
  if (m) {
    const [, monName, da, yr] = m;
    const mo = MONTH_NAMES[monName.toLowerCase()];
    return `${mo}/${Number(da)}/${yr.length === 4 ? yr.slice(2) : yr}`;
  }
  // last resort — native parse
  const nativeParsed = new Date(str);
  if (!isNaN(nativeParsed.getTime())) {
    return `${nativeParsed.getMonth() + 1}/${nativeParsed.getDate()}/${String(nativeParsed.getFullYear()).slice(2)}`;
  }
  return null;
}

function normalizeLineNo(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? s : String(n).padStart(2, '0');
}

/**
 * @param file           uploaded File object (.xlsx/.xls/.csv)
 * @param columnConfig   { styleNo, trackingNumber, factory, lineNo, deliveryDate } column letters
 * @returns { rows: [{styleNo, trackingNumber, factoryLine, deliveryDate}], warnings: string[], documentDate: string|null }
 */
export async function parseCorrectionsFile(file, columnConfig) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const warnings = [];

  // Document date, fixed at B3 per spec (labeled "Ex-Factory Date To" in
  // the source file — read as-is regardless of that label's wording).
  const b3 = sheet['B3'];
  const documentDate = b3 ? normalizeDateValue(b3.v) : null;
  if (!documentDate) warnings.push('Could not read a document date from cell B3.');

  const cols = {
    styleNo: colLetterToIndex(columnConfig.styleNo),
    trackingNumber: colLetterToIndex(columnConfig.trackingNumber),
    factory: colLetterToIndex(columnConfig.factory),
    lineNo: colLetterToIndex(columnConfig.lineNo),
    deliveryDate: colLetterToIndex(columnConfig.deliveryDate),
  };

  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  if (raw.length < 6) {
    warnings.push('File has no data rows below row 5 (header) / row 6 (first data row).');
    return { rows: [], warnings, documentDate };
  }

  const rows = [];
  for (let i = 5; i < raw.length; i++) { // row 6 is index 5 (row 5 header is index 4, skipped)
    const line = raw[i];
    if (!line || line.every((c) => String(c).trim() === '')) continue;

    const styleNo = String(line[cols.styleNo] ?? '').replace(/\s+/g, ' ').trim();
    if (!styleNo) continue;
    const trackingNumber = String(line[cols.trackingNumber] ?? '').replace(/\s+/g, ' ').trim();
    const factory = String(line[cols.factory] ?? '').replace(/\s+/g, ' ').trim();
    const lineNoStr = normalizeLineNo(line[cols.lineNo]);
    const factoryLine = factory && lineNoStr ? `${factory} ${lineNoStr}` : (factory || lineNoStr);

    const deliveryDate = normalizeDateValue(line[cols.deliveryDate]);
    if (!deliveryDate) {
      warnings.push(`Row ${i + 1}: could not parse a Delivery Date value — skipped.`);
      continue;
    }

    rows.push({ styleNo, trackingNumber, factoryLine, deliveryDate });
  }

  if (rows.length === 0 && warnings.length === 0) {
    warnings.push('No usable rows found starting from row 6 — check the configured column letters in Settings.');
  }
  return { rows, warnings, documentDate };
}
