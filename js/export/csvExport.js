// export/csvExport.js

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function comparisonsToCsv(comparisons) {
  const headers = ['Style No', 'Factory/Line', 'Changed Field', 'Old Value', 'New Value', 'Delay Days', 'Critical Level', 'Printed Date'];
  const lines = [headers.join(',')];
  for (const c of comparisons) {
    const fields = c.changedFields && c.changedFields.length ? c.changedFields : ['(none)'];
    for (const field of fields) {
      lines.push([
        c.styleNo,
        c.factoryLine,
        field,
        csvEscape(c.prevValues ? c.prevValues[field] : ''),
        csvEscape(c.currValues ? c.currValues[field] : ''),
        c.delayDays || 0,
        c.severityLabel,
        c.printedDate || '',
      ].join(','));
    }
  }
  return lines.join('\n');
}

export function downloadCsv(csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
