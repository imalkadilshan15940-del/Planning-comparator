// import/parseSplOpeMasterFile.js
//
// Special Operations master data: Special Operations Code -> Wash Status.
// WHICH column holds which field is user-configured by letter in Settings
// (default B/C for Code/Wash Status) — extraction is positional by
// letter, not by matching header text, matching the same pattern already
// established for Delivery Date corrections.

function colLetterToIndex(letter) {
  return XLSX.utils.decode_col(String(letter || 'A').trim().toUpperCase());
}

/**
 * @param file
 * @param columnLetters  { splOpeCode: 'B', washStatus: 'C' }
 * @param headerRow      1-indexed row number where data starts being read
 *                        FROM (i.e. the row right after the header) —
 *                        defaults to 2, a plain single-header-row file.
 * Returns { rows: [{splOpeCode, washStatus}], errors: [string] }
 */
export async function parseSplOpeMasterFile(file, columnLetters, dataStartRow = 2) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const errors = [];
  const startIdx = Math.max(0, dataStartRow - 1);
  if (raw.length <= startIdx) {
    return { rows: [], errors: ['File has no data rows at the configured starting row.'] };
  }

  const codeCol = colLetterToIndex(columnLetters?.splOpeCode || 'B');
  const washCol = colLetterToIndex(columnLetters?.washStatus || 'C');

  const rows = [];
  const badValues = [];
  for (let i = startIdx; i < raw.length; i++) {
    const line = raw[i];
    if (!line || line.every((c) => String(c).trim() === '')) continue;
    const splOpeCode = String(line[codeCol] ?? '').trim();
    const washRaw = String(line[washCol] ?? '').trim();
    if (!splOpeCode) continue;
    const upper = washRaw.replace(/\s+/g, '').toUpperCase();
    if (upper !== 'WASH' && upper !== 'NONWASH' && upper !== 'NON-WASH') {
      badValues.push(`Row ${i + 1}: "${washRaw}" is not "Wash" or "Non Wash" — skipped.`);
      continue;
    }
    rows.push({ splOpeCode, washStatus: upper === 'WASH' ? 'Wash' : 'Non Wash' });
  }

  if (rows.length === 0) errors.push('No usable rows found — check the configured column letters and starting row in Settings.');
  errors.push(...badValues);
  return { rows, errors };
}
