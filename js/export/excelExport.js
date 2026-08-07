// export/excelExport.js
// Requires the global `XLSX` object (SheetJS, loaded via CDN in index.html).

export function exportComparisonsToExcel(comparisons, filename) {
  const rows = [];
  for (const c of comparisons) {
    const fields = c.changedFields && c.changedFields.length ? c.changedFields : ['(none)'];
    for (const field of fields) {
      rows.push({
        'Style No': c.styleNo,
        'Factory/Line': c.factoryLine,
        'Changed Field': field,
        'Old Value': c.prevValues ? c.prevValues[field] : '',
        'New Value': c.currValues ? c.currValues[field] : '',
        'Delay Days': c.delayDays || 0,
        'Critical Level': c.severityLabel,
        'Printed Date': c.printedDate || '',
      });
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comparisons');
  XLSX.writeFile(wb, filename);
}
