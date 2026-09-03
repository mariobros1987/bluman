// Blocco 5 — Generazione file dei report (§ reportistica).
//
// Due builder puri che consumano la struttura `ReportTabella` prodotta da
// reportsService.ts e restituiscono un Buffer pronto per essere servito come
// allegato (Content-Type + Content-Disposition in server.ts). Nessuna logica di
// business qui: solo resa grafica/numerica di dati già aggregati.
//
// • PDF  → pdfkit (A4 orizzontale, tabella con totali e riepilogo).
// • Excel → exceljs (celle numeriche REALI con formato €, somma e media attive).

import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import type { ReportTabella, CellaReport } from './reportsService.js';

// ──────────────────────────────────────────────────────────────────────────────
// Formattazione comune delle celle
// ──────────────────────────────────────────────────────────────────────────────
type TipoColonna = 'valuta' | 'ore' | 'pct' | 'testo';

function tipoPerColonna(tabella: ReportTabella, indice: number): TipoColonna {
  if (tabella.colonneValuta.includes(indice)) return 'valuta';
  if (tabella.colonneOre.includes(indice)) return 'ore';
  if (tabella.colonnePercentuali.includes(indice)) return 'pct';
  return 'testo';
}

/** Rende una cella come stringa leggibile (per il PDF). */
function testoCella(valore: CellaReport, tipo: TipoColonna): string {
  if (valore === null || valore === undefined) return '';
  if (typeof valore === 'number') {
    switch (tipo) {
      case 'valuta':
        return valore.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
      case 'pct':
        return valore.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' %';
      case 'ore':
        return valore.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' h';
      default:
        return String(valore);
    }
  }
  return valore;
}

/** Applica il formato numerico reale a una cella Excel (celle sommabili). */
function applicaFormatoExcel(cell: ExcelJS.Cell, tipo: TipoColonna): void {
  switch (tipo) {
    case 'valuta':
      cell.numFmt = '#,##0.00 "€"';
      break;
    case 'pct':
      cell.numFmt = '0.0"%"';
      break;
    case 'ore':
      cell.numFmt = '#,##0.0';
      break;
    default:
      break;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// PDF — pdfkit
// ──────────────────────────────────────────────────────────────────────────────
const MARGINE = 36;
const ALTEZZA_RIGA = 16;
const FONT = 'Helvetica';

function pdfDocToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Larghezze colonne proporzionali: testo 2 unità, numeriche 1 unità. */
function calcolaLarghezze(tabella: ReportTabella, larghezzaTotale: number): number[] {
  const pesi = tabella.intestazioni.map((_, i) => (tipoPerColonna(tabella, i) === 'testo' ? 2 : 1));
  const sommaPesi = pesi.reduce((s, p) => s + p, 0) || 1;
  return pesi.map((p) => (p / sommaPesi) * larghezzaTotale);
}

/** Disegna la banda di testata (titolo + sottotitolo + data) in cima alla pagina. */
function disegnaTestata(doc: PDFKit.PDFDocument, tabella: ReportTabella, y: number): number {
  doc.font(FONT).fontSize(15).fillColor('#0f172a').text(tabella.titolo, MARGINE, y, { align: 'left' });
  y += 20;
  doc.font(FONT).fontSize(9).fillColor('#64748b').text(tabella.sottotitolo, MARGINE, y, { align: 'left' });
  y += 13;
  doc.font(FONT).fontSize(7.5).fillColor('#94a3b8')
    .text(`Elaborato il ${new Date().toLocaleDateString('it-IT')} alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`, MARGINE, y, { align: 'left' });
  y += 18;
  return y;
}

/** Disegna la riga di intestazione della tabella (sfondo grigio, grassetto). */
function disegnaIntestazioni(
  doc: PDFKit.PDFDocument,
  tabella: ReportTabella,
  larghezze: number[],
  y: number,
): number {
  const x0 = MARGINE;
  const totale = larghezze.reduce((s, w) => s + w, 0);
  doc.rect(x0, y - 3, totale, ALTEZZA_RIGA).fill('#e2e8f0');
  let x = x0;
  doc.font(FONT + '-Bold').fontSize(8).fillColor('#0f172a');
  for (let i = 0; i < tabella.intestazioni.length; i++) {
    const tipo = tipoPerColonna(tabella, i);
    const label = tabella.intestazioni[i] ?? '';
    if (tipo === 'testo') {
      doc.text(label, x + 4, y, { width: (larghezze[i] ?? 60) - 8, align: 'left', lineBreak: false });
    } else {
      doc.text(label, x + 4, y, { width: (larghezze[i] ?? 60) - 8, align: 'right', lineBreak: false });
    }
    x += larghezze[i] ?? 60;
  }
  return y + ALTEZZA_RIGA;
}

/** Disegna una riga dati; ritorna la nuova y. Allineamento a destra per le numeriche. */
function disegnaRiga(
  doc: PDFKit.PDFDocument,
  tabella: ReportTabella,
  riga: CellaReport[],
  larghezze: number[],
  y: number,
  grassetto: boolean,
  sfondo: string | null,
): number {
  const x0 = MARGINE;
  const totale = larghezze.reduce((s, w) => s + w, 0);
  if (sfondo) doc.rect(x0, y - 3, totale, ALTEZZA_RIGA).fill(sfondo);
  let x = x0;
  doc.font(grassetto ? FONT + '-Bold' : FONT).fontSize(8).fillColor('#1e293b');
  for (let i = 0; i < riga.length; i++) {
    const tipo = tipoPerColonna(tabella, i);
    const testo = testoCella(riga[i] ?? null, tipo);
    const w = (larghezze[i] ?? 60) - 8;
    if (tipo === 'testo') {
      doc.text(testo, x + 4, y, { width: w, align: 'left', lineBreak: false });
    } else {
      doc.text(testo, x + 4, y, { width: w, align: 'right', lineBreak: false });
    }
    x += larghezze[i] ?? 60;
  }
  return y + ALTEZZA_RIGA;
}

/**
 * Genera il PDF del report come Buffer. A4 orizzontale, tabella paginata.
 */
export async function generaPdfReport(tabella: ReportTabella): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 30, bottom: 30, left: MARGINE, right: MARGINE }, bufferPages: true });
  const larghezzaUtile = doc.page.width - MARGINE * 2;
  const larghezze = calcolaLarghezze(tabella, larghezzaUtile);
  const fondoPagina = doc.page.height - 40;

  let y = 40;
  y = disegnaTestata(doc, tabella, y);
  y = disegnaIntestazioni(doc, tabella, larghezze, y);

  const tutteRighe: Array<{ riga: CellaReport[]; grassetto: boolean; sfondo: string | null }> = [
    ...tabella.righe.map((r, i) => ({ riga: r, grassetto: false, sfondo: i % 2 === 1 ? '#f8fafc' : null })),
  ];
  if (tabella.totali) {
    for (const t of tabella.totali) tutteRighe.push({ riga: t, grassetto: true, sfondo: '#f1f5f9' });
  }

  for (const elemento of tutteRighe) {
    if (y + ALTEZZA_RIGA > fondoPagina) {
      doc.addPage();
      y = 40;
      y = disegnaIntestazioni(doc, tabella, larghezze, y);
    }
    y = disegnaRiga(doc, tabella, elemento.riga, larghezze, y, elemento.grassetto, elemento.sfondo);
  }

  if (tabella.riepilogo && tabella.riepilogo.length > 0) {
    y += 14;
    if (y + 60 > fondoPagina) {
      doc.addPage();
      y = 40;
    }
    doc.font(FONT + '-Bold').fontSize(9).fillColor('#0f172a').text('Riepilogo', MARGINE, y);
    y += 16;
    for (const voce of tabella.riepilogo) {
      doc.font(FONT).fontSize(8.5).fillColor('#475569')
        .text(`${voce.etichetta}:  `, MARGINE, y, { continued: true })
        .font(FONT + '-Bold').fillColor('#0f172a').text(voce.valore);
      y += 13;
    }
  }

  return pdfDocToBuffer(doc);
}

// ──────────────────────────────────────────────────────────────────────────────
// EXCEL — exceljs
// ──────────────────────────────────────────────────────────────────────────────
const BLU_TESTATA = 'FF0F172A';
const GRIGIO_RIGA = 'FFF1F5F9';

/**
 * Genera il file .xlsx del report come Buffer. Celle numeriche reali con formato.
 */
export async function generaExcelReport(tabella: ReportTabella): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BluMan Studio';
  workbook.created = new Date();
  const ws = workbook.addWorksheet(tabella.titolo.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });

  const nColonne = tabella.intestazioni.length;
  const ultimaColonnaLettera = String.fromCharCode(64 + Math.min(nColonne, 26));

  // Titolo + sottotitolo (celle unite)
  ws.mergeCells(`A1:${ultimaColonnaLettera}1`);
  const titoloCell = ws.getCell('A1');
  titoloCell.value = tabella.titolo;
  titoloCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: BLU_TESTATA } };
  titoloCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${ultimaColonnaLettera}2`);
  const sottotitoloCell = ws.getCell('A2');
  sottotitoloCell.value = tabella.sottotitolo;
  sottotitoloCell.font = { size: 10, color: { argb: 'FF64748B' } };

  ws.mergeCells(`A3:${ultimaColonnaLettera}3`);
  ws.getCell('A3').value = `Elaborato il ${new Date().toLocaleString('it-IT')}`;
  ws.getCell('A3').font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };

  // Intestazioni (riga 4)
  const rigaIntestazioni = ws.getRow(4);
  tabella.intestazioni.forEach((label, i) => {
    const cell = rigaIntestazioni.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLU_TESTATA } };
    cell.alignment = { horizontal: tipoPerColonna(tabella, i) === 'testo' ? 'left' : 'right', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } };
  });
  rigaIntestazioni.height = 24;

  // Larghezze colonne
  tabella.intestazioni.forEach((label, i) => {
    const tipo = tipoPerColonna(tabella, i);
    ws.getColumn(i + 1).width = tipo === 'testo' ? Math.min(32, Math.max(label.length + 6, 14)) : 14;
  });

  // Righe dati
  let numeroRiga = 5;
  tabella.righe.forEach((riga, idx) => {
    const wsRow = ws.getRow(numeroRiga);
    riga.forEach((valore, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.value = valore as ExcelJS.CellValue;
      applicaFormatoExcel(cell, tipoPerColonna(tabella, i));
      cell.font = { size: 10 };
      cell.alignment = { horizontal: tipoPerColonna(tabella, i) === 'testo' ? 'left' : 'right' };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
    numeroRiga++;
  });

  // Righe di totale
  if (tabella.totali) {
    for (const totale of tabella.totali) {
      const wsRow = ws.getRow(numeroRiga);
      totale.forEach((valore, i) => {
        const cell = wsRow.getCell(i + 1);
        cell.value = valore as ExcelJS.CellValue;
        applicaFormatoExcel(cell, tipoPerColonna(tabella, i));
        cell.font = { bold: true, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIGIO_RIGA } };
        cell.alignment = { horizontal: tipoPerColonna(tabella, i) === 'testo' ? 'left' : 'right' };
        cell.border = { top: { style: 'medium', color: { argb: 'FF0F172A' } } };
      });
      numeroRiga++;
    }
  }

  // Riepilogo
  if (tabella.riepilogo && tabella.riepilogo.length > 0) {
    numeroRiga++;
    for (const voce of tabella.riepilogo) {
      const wsRow = ws.getRow(numeroRiga);
      wsRow.getCell(1).value = voce.etichetta;
      wsRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF475569' } };
      ws.mergeCells(`B${numeroRiga}:${ultimaColonnaLettera}${numeroRiga}`);
      wsRow.getCell(2).value = voce.valore;
      wsRow.getCell(2).font = { bold: true, size: 11 };
      numeroRiga++;
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
