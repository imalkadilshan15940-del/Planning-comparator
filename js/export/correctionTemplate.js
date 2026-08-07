// export/correctionTemplate.js
// Builds a template matching the new structure: A2/A3 labels with the
// document date range in B2/B3 (B3 is what the app reads), header labels
// at row 5, one example row at row 6 — all placed at whichever column
// letters are currently configured in Settings, so the template always
// matches what the app will actually read.

function colIdx(letter) {
  return XLSX.utils.decode_col(String(letter || 'A').trim().toUpperCase());
}

function buildRows(columnConfig) {
  const rows = [];
  rows[0] = ['Style Common Information'];
  rows[1] = ['Ex-Factory Date From'];
  rows[1][1] = new Date();
  rows[2] = ['Ex-Factory Date To'];
  rows[2][1] = new Date(new Date().setMonth(new Date().getMonth() + 3));
  rows[3] = [];
  rows[4] = []; // row 5 — headers
  rows[5] = []; // row 6 — example data

  const c = {
    styleNo: colIdx(columnConfig.styleNo),
    trackingNumber: colIdx(columnConfig.trackingNumber),
    factory: colIdx(columnConfig.factory),
    lineNo: colIdx(columnConfig.lineNo),
    deliveryDate: colIdx(columnConfig.deliveryDate),
  };
  rows[4][c.styleNo] = 'Style Number';
  rows[4][c.trackingNumber] = 'Tracking Number';
  rows[4][c.factory] = 'Factory';
  rows[4][c.lineNo] = 'Line';
  rows[4][c.deliveryDate] = 'Delivery Date';

  rows[5][c.styleNo] = 'SGSGZIMER4411';
  rows[5][c.trackingNumber] = '9676T-A1';
  rows[5][c.factory] = 'SGL';
  rows[5][c.lineNo] = 1;
  rows[5][c.deliveryDate] = new Date();

  return rows;
}

export function downloadCorrectionTemplateXlsx(columnConfig) {
  const rows = buildRows(columnConfig);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = Array(20).fill({ wch: 16 });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Delivery Corrections');
  XLSX.writeFile(wb, 'delivery-date-corrections-template.xlsx');
}

export function downloadCorrectionTemplateCsv(columnConfig) {
  const rows = buildRows(columnConfig);
  const lines = rows.map((row) => {
    const maxCol = Math.max(row.length, 1);
    const cells = [];
    for (let i = 0; i < maxCol; i++) {
      const v = row[i];
      const s = v instanceof Date ? `${v.getMonth() + 1}/${v.getDate()}/${v.getFullYear()}` : (v ?? '');
      cells.push(/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : s);
    }
    return cells.join(',');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'delivery-date-corrections-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
