// export/pdfExport.js
// Requires the global `jspdf` object (jsPDF + jspdf-autotable, loaded via CDN).

export function exportComparisonsToPdf(comparisons, { title = 'Planning Change Report', filename = 'planning-change-report.pdf' } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 22);

  const body = [];
  for (const c of comparisons) {
    const fields = c.changedFields && c.changedFields.length ? c.changedFields : ['(none)'];
    for (const field of fields) {
      body.push([
        c.styleNo,
        c.factoryLine,
        field,
        c.prevValues ? String(c.prevValues[field] ?? '') : '',
        c.currValues ? String(c.currValues[field] ?? '') : '',
        String(c.delayDays || 0),
        c.severityLabel,
      ]);
    }
  }

  doc.autoTable({
    startY: 28,
    head: [['Style No', 'Factory/Line', 'Changed Field', 'Old Value', 'New Value', 'Delay Days', 'Critical Level']],
    body,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 102, 144] },
  });

  doc.save(filename);
}
