import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
// pdfmake's server-side printer; fonts come from the bundled Roboto files.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vfsModule = require('pdfmake/build/vfs_fonts');
import { Report } from './reports.service';

const vfs: Record<string, string> = vfsModule.pdfMake?.vfs ?? vfsModule.vfs ?? vfsModule;
const font = (f: string) => Buffer.from(vfs[f], 'base64');
const printer = new PdfPrinter({
  Roboto: {
    normal: font('Roboto-Regular.ttf'),
    bold: font('Roboto-Medium.ttf'),
    italics: font('Roboto-Italic.ttf'),
    bolditalics: font('Roboto-MediumItalic.ttf'),
  },
});

const money = (n: any) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const int = (n: any) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-GB'));

/** Turns any Report into an Excel workbook or a PDF (FR11). */
@Injectable()
export class ExportService {
  async xlsx(r: Report, generatedBy: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BESH. J IMS';
    wb.created = new Date();
    const ws = wb.addWorksheet(r.title.slice(0, 31));

    ws.addRow(['BESH. J Limited']).font = { bold: true, size: 14 };
    ws.addRow([r.title]).font = { bold: true, size: 12 };
    ws.addRow([r.subtitle]).font = { italic: true, color: { argb: 'FF666666' } };
    ws.addRow([`Generated ${new Date().toLocaleString('en-GB')} by ${generatedBy}`]).font = { size: 9, color: { argb: 'FF888888' } };
    ws.addRow([]);

    const header = ws.addRow(r.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F2F5' } };
      cell.border = { bottom: { style: 'thin' } };
    });
    const firstData = header.number + 1;

    for (const row of r.rows) {
      ws.addRow(
        r.columns.map((c) => {
          const v = row[c.key];
          if (v === null || v === undefined) return null;
          return c.type === 'money' || c.type === 'int' || c.type === 'percent' ? Number(v) : v;
        }),
      );
    }
    const lastData = firstData + r.rows.length - 1;

    // Totals as live Excel formulas, so they stay right if someone edits a figure.
    if (r.rows.length) {
      const totalRow = ws.addRow(
        r.columns.map((c, i) => {
          if (i === 0) return 'Total';
          if (!(c.key in r.totals)) return null;
          // Percentages and distinct counts can't be summed down the column.
          if (c.type === 'percent' || (r.name === 'sales' && c.key === 'invoices')) return r.totals[c.key];
          const col = ws.getColumn(i + 1).letter;
          return { formula: `SUM(${col}${firstData}:${col}${lastData})`, result: r.totals[c.key] };
        }),
      );
      totalRow.font = { bold: true };
      totalRow.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
    }

    r.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.min(Math.max(c.label.length + 4, c.type === 'text' ? 18 : 12), c.key === 'reason' ? 40 : 30);
      if (c.type === 'money') col.numFmt = '"GH₵" #,##0.00';
      if (c.type === 'int') col.numFmt = '#,##0';
      if (c.type === 'percent') col.numFmt = '0.0"%"';
    });
    ws.getColumn(1).width = Math.max(ws.getColumn(1).width ?? 18, 28);
    ws.views = [{ state: 'frozen', ySplit: header.number }];
    ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: r.columns.length } };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  pdf(r: Report, generatedBy: string): Promise<Buffer> {
    const numeric = (t: string) => t === 'money' || t === 'int' || t === 'percent';
    const fmt = (t: string, v: any) => (t === 'money' ? money(v) : t === 'int' ? int(v) : t === 'percent' ? (v === null || v === undefined ? '' : `${Number(v).toFixed(1)}%`) : v ?? '');

    const body: any[] = [
      r.columns.map((c) => ({ text: c.type === 'money' ? `${c.label} (GHS)` : c.label, style: 'th', alignment: numeric(c.type) ? 'right' : 'left' })),
      ...r.rows.map((row) => r.columns.map((c) => ({ text: String(fmt(c.type, row[c.key])), alignment: numeric(c.type) ? 'right' : 'left' }))),
    ];
    if (r.rows.length) {
      body.push(
        r.columns.map((c, i) => ({
          text: i === 0 ? 'Total' : c.key in r.totals ? String(fmt(c.type, r.totals[c.key])) : '',
          bold: true,
          alignment: numeric(c.type) ? 'right' : 'left',
        })),
      );
    }

    const doc = {
      pageOrientation: r.columns.length > 6 ? 'landscape' : 'portrait',
      pageMargins: [36, 40, 36, 40],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      content: [
        { text: 'BESH. J LIMITED', bold: true, fontSize: 14 },
        { text: r.title, bold: true, fontSize: 12, margin: [0, 4, 0, 2] },
        { text: r.subtitle, color: '#555555', margin: [0, 0, 0, 2] },
        { text: `Generated ${new Date().toLocaleString('en-GB')} by ${generatedBy}`, color: '#888888', fontSize: 8, margin: [0, 0, 0, 10] },
        r.rows.length
          ? {
              table: { headerRows: 1, widths: r.columns.map((c) => (c.type === 'text' ? '*' : 'auto')), body },
              layout: {
                hLineWidth: (i: number, node: any) => (i === 1 || i === node.table.body.length - 1 ? 0.8 : 0.3),
                vLineWidth: () => 0,
                hLineColor: () => '#cccccc',
                fillColor: (i: number) => (i === 0 ? '#f0f2f5' : null),
                paddingTop: () => 3,
                paddingBottom: () => 3,
              },
            }
          : { text: 'No data for this selection.', italics: true },
      ],
      footer: (page: number, pages: number) => ({ text: `Page ${page} of ${pages}`, alignment: 'right', fontSize: 8, color: '#888888', margin: [0, 10, 36, 0] }),
      styles: { th: { bold: true } },
    };

    return new Promise((resolve, reject) => {
      const pdf = printer.createPdfKitDocument(doc);
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.end();
    });
  }
}
