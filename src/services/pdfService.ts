// Servizio Server-Side di Generazione PDF nativi conformi A4 per Fatture e Documenti
import PDFDocument from 'pdfkit';

export interface FatturaPdfRigaData {
  descrizione: string;
  quantita?: number;
  unitaMisura?: string;
  prezzoUnitarioCent?: number;
  aliquotaIva?: number;
  importo: number; // centesimi
}

export interface FatturaPdfData {
  numero: string;
  data: string;
  tipoDocumento: string;
  clienteNome: string;
  clientePiva?: string;
  clienteCodiceFiscale?: string;
  clienteSede?: string;
  clienteSdiCode?: string;
  tenantNome: string;
  tenantIban?: string;
  tenantPiva?: string;
  tenantCodiceFiscale?: string;
  tenantSede?: string;
  righe: FatturaPdfRigaData[];
  totaleImponibileEuro?: number;
  totaleCassaEuro?: number;
  tipoCassa?: string;
  totaleIvaEuro?: number;
  totaleRitenutaEuro?: number;
  totaleBolloEuro?: number;
  totaleEuro: number;
  nettoAPagareEuro?: number;
  condizionePagamento?: string;
  scadenze?: Array<{ numeroRata: number; importoEuro: number; dataScadenza: string }>;
  note?: string;
}

const MARGINE = 40;
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

export async function generateInvoicePdfBuffer(data: FatturaPdfData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGINE,
    compress: false,
    info: {
      Title: `Fattura ${data.numero}`,
      Author: data.tenantNome,
      Subject: data.tipoDocumento === 'nota_credito' ? 'Nota di Credito' : 'Fattura Elettronica',
    },
  });

  const isNote = data.tipoDocumento === 'nota_credito';
  const titoloDoc = isNote ? 'NOTA DI CREDITO' : 'FATTURA ELETTRONICA';
  const larghezzaUtile = doc.page.width - MARGINE * 2;

  // 1. Intestazione Studio
  doc.font(`${FONT}-Bold`).fontSize(16).fillColor('#1e3a8a').text(data.tenantNome.toUpperCase(), MARGINE, MARGINE, { width: larghezzaUtile });
  doc.font(FONT).fontSize(8.5).fillColor('#475569');
  let yStudio = MARGINE + 22;
  if (data.tenantSede) {
    doc.text(`Sede: ${data.tenantSede}`, MARGINE, yStudio);
    yStudio += 12;
  }
  const codiciStudio = [
    data.tenantPiva ? `P.IVA: ${data.tenantPiva}` : null,
    data.tenantCodiceFiscale ? `C.F.: ${data.tenantCodiceFiscale}` : null,
  ].filter(Boolean).join(' | ');
  if (codiciStudio) {
    doc.text(codiciStudio, MARGINE, yStudio);
    yStudio += 12;
  }

  // Filetto separatore
  yStudio += 4;
  doc.moveTo(MARGINE, yStudio).lineTo(MARGINE + larghezzaUtile, yStudio).strokeColor('#cbd5e1').lineWidth(1).stroke();
  yStudio += 10;

  // 2. Riquadro Dati Documento & Riquadro Committente (2 Colonne affiancate)
  const colWidth = (larghezzaUtile - 16) / 2;
  const col1X = MARGINE;
  const col2X = MARGINE + colWidth + 16;
  const yBoxes = yStudio;

  // Colonna Sinistra: Dati Documento
  doc.rect(col1X, yBoxes, colWidth, 76).fillAndStroke('#f8fafc', '#e2e8f0');
  doc.font(`${FONT}-Bold`).fontSize(10).fillColor('#0f172a').text(titoloDoc, col1X + 8, yBoxes + 8);
  doc.font(FONT).fontSize(8.5).fillColor('#334155');
  doc.text(`Numero: ${data.numero}`, col1X + 8, yBoxes + 24);
  doc.text(`Data: ${data.data}`, col1X + 8, yBoxes + 38);
  doc.text(`Pagamento: ${data.condizionePagamento || 'Bonifico 30 gg'}`, col1X + 8, yBoxes + 52);

  // Colonna Destra: Cessionario / Committente
  doc.rect(col2X, yBoxes, colWidth, 76).fillAndStroke('#f8fafc', '#e2e8f0');
  doc.font(`${FONT}-Bold`).fontSize(10).fillColor('#0f172a').text('COMMITTENTE / CESSIONARIO', col2X + 8, yBoxes + 8);
  doc.font(`${FONT}-Bold`).fontSize(9).fillColor('#1e293b').text(data.clienteNome, col2X + 8, yBoxes + 24, { width: colWidth - 16, ellipsis: true });
  doc.font(FONT).fontSize(8).fillColor('#475569');
  const codiciCliente = [
    data.clientePiva ? `P.IVA: ${data.clientePiva}` : null,
    data.clienteCodiceFiscale ? `C.F.: ${data.clienteCodiceFiscale}` : null,
  ].filter(Boolean).join(' | ');
  doc.text(codiciCliente || 'Codice Fiscale / P.IVA non specificati', col2X + 8, yBoxes + 38, { width: colWidth - 16, ellipsis: true });
  doc.text(`SDI: ${data.clienteSdiCode || '0000000'} | Sede: ${data.clienteSede || 'Italia'}`, col2X + 8, yBoxes + 52, { width: colWidth - 16, ellipsis: true });

  let curY = yBoxes + 90;

  // 3. Tabella Righe Prestazioni / Articoli
  doc.rect(MARGINE, curY, larghezzaUtile, 18).fill('#1e3a8a');
  doc.font(`${FONT}-Bold`).fontSize(8).fillColor('#ffffff');
  doc.text('DESCRIZIONE PRESTAZIONE / ARTICOLO', MARGINE + 8, curY + 5, { width: larghezzaUtile * 0.5 });
  doc.text('Q.TÀ', MARGINE + larghezzaUtile * 0.52, curY + 5, { width: larghezzaUtile * 0.1, align: 'center' });
  doc.text('P.UNITARIO', MARGINE + larghezzaUtile * 0.63, curY + 5, { width: larghezzaUtile * 0.15, align: 'right' });
  doc.text('IVA', MARGINE + larghezzaUtile * 0.79, curY + 5, { width: larghezzaUtile * 0.08, align: 'center' });
  doc.text('IMPORTO', MARGINE + larghezzaUtile * 0.88, curY + 5, { width: larghezzaUtile * 0.11, align: 'right' });

  curY += 20;

  doc.font(FONT).fontSize(8.5).fillColor('#0f172a');
  for (const [i, r] of data.righe.entries()) {
    const isEven = i % 2 === 0;
    const rigaH = 18;
    if (isEven) {
      doc.rect(MARGINE, curY - 2, larghezzaUtile, rigaH).fill('#f8fafc');
    }
    doc.fillColor('#0f172a');
    doc.text(r.descrizione, MARGINE + 8, curY + 2, { width: larghezzaUtile * 0.5, ellipsis: true });
    doc.text(`${r.quantita || 1} ${r.unitaMisura || ''}`.trim(), MARGINE + larghezzaUtile * 0.52, curY + 2, { width: larghezzaUtile * 0.1, align: 'center' });
    const pUnit = r.prezzoUnitarioCent !== undefined ? (r.prezzoUnitarioCent / 100).toFixed(2) : (r.importo / 100).toFixed(2);
    doc.text(`€ ${pUnit}`, MARGINE + larghezzaUtile * 0.63, curY + 2, { width: larghezzaUtile * 0.15, align: 'right' });
    doc.text(`${r.aliquotaIva !== undefined ? r.aliquotaIva : 22}%`, MARGINE + larghezzaUtile * 0.79, curY + 2, { width: larghezzaUtile * 0.08, align: 'center' });
    doc.text(`€ ${(r.importo / 100).toFixed(2)}`, MARGINE + larghezzaUtile * 0.88, curY + 2, { width: larghezzaUtile * 0.11, align: 'right' });
    curY += rigaH;
  }

  curY += 10;
  doc.moveTo(MARGINE, curY).lineTo(MARGINE + larghezzaUtile, curY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
  curY += 12;

  // 4. Sezione Totali & Coordinate Bancarie (2 Colonne affiancate)
  const sumColWidth = larghezzaUtile * 0.45;
  const bankColWidth = larghezzaUtile * 0.5;
  const ySummary = curY;

  // Box Coordinate Bancarie a Sinistra
  doc.rect(MARGINE, ySummary, bankColWidth, 110).fillAndStroke('#f1f5f9', '#cbd5e1');
  doc.font(`${FONT}-Bold`).fontSize(9).fillColor('#1e293b').text('MODALITÀ DI PAGAMENTO & ACCREDITO', MARGINE + 8, ySummary + 8);
  doc.font(FONT).fontSize(8).fillColor('#475569');
  doc.text(`IBAN: ${data.tenantIban || 'Nessun IBAN configurato nelle impostazioni'}`, MARGINE + 8, ySummary + 24, { width: bankColWidth - 16 });
  doc.text(`Causale: Saldo ${data.numero} - ${data.clienteNome}`, MARGINE + 8, ySummary + 40, { width: bankColWidth - 16, ellipsis: true });

  if (data.scadenze && data.scadenze.length > 0) {
    doc.font(`${FONT}-Bold`).fontSize(8).fillColor('#334155').text('Scadenze Rate:', MARGINE + 8, ySummary + 58);
    doc.font(FONT).fontSize(7.5).fillColor('#475569');
    let scY = ySummary + 70;
    for (const sc of data.scadenze.slice(0, 3)) {
      doc.text(`• Rata #${sc.numeroRata}: € ${sc.importoEuro.toFixed(2)} entro il ${sc.dataScadenza}`, MARGINE + 12, scY);
      scY += 11;
    }
  }

  // Box Totali Finanziari a Destra
  const sumX = MARGINE + larghezzaUtile - sumColWidth;
  doc.rect(sumX, ySummary, sumColWidth, 110).fillAndStroke('#f8fafc', '#e2e8f0');
  let sumY = ySummary + 8;

  const rigaTotale = (label: string, valoreEur: number, isBold: boolean = false, isNegative: boolean = false) => {
    doc.font(isBold ? `${FONT}-Bold` : FONT).fontSize(8.5).fillColor(isBold ? '#0f172a' : '#475569');
    doc.text(label, sumX + 8, sumY, { width: sumColWidth * 0.6 });
    const pref = isNegative ? '-€ ' : '€ ';
    doc.text(`${pref}${valoreEur.toFixed(2)}`, sumX + sumColWidth * 0.6, sumY, { width: sumColWidth * 0.35, align: 'right' });
    sumY += 13;
  };

  const impEur = data.totaleImponibileEuro !== undefined ? data.totaleImponibileEuro : data.totaleEuro;
  rigaTotale('Imponibile:', impEur);
  if (data.totaleCassaEuro && data.totaleCassaEuro > 0) {
    rigaTotale(`Rivalsa Cassa (${data.tipoCassa || '4%'}):`, data.totaleCassaEuro);
  }
  if (data.totaleIvaEuro !== undefined && data.totaleIvaEuro > 0) {
    rigaTotale('IVA:', data.totaleIvaEuro);
  }
  if (data.totaleBolloEuro && data.totaleBolloEuro > 0) {
    rigaTotale('Bollo Virtuale:', data.totaleBolloEuro);
  }

  doc.moveTo(sumX + 6, sumY).lineTo(sumX + sumColWidth - 6, sumY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
  sumY += 4;
  rigaTotale('TOTALE FATTURA:', data.totaleEuro, true);

  if (data.totaleRitenutaEuro && data.totaleRitenutaEuro > 0) {
    rigaTotale("Ritenuta d'Acconto:", data.totaleRitenutaEuro, false, true);
  }

  const nettoEur = data.nettoAPagareEuro !== undefined ? data.nettoAPagareEuro : data.totaleEuro;
  doc.rect(sumX + 4, sumY - 2, sumColWidth - 8, 18).fill('#1e3a8a');
  doc.font(`${FONT}-Bold`).fontSize(9).fillColor('#ffffff');
  doc.text('NETTO A PAGARE:', sumX + 8, sumY + 3);
  doc.text(`€ ${nettoEur.toFixed(2)}`, sumX + sumColWidth * 0.5, sumY + 3, { width: sumColWidth * 0.45, align: 'right' });

  // 5. Note a piè di pagina
  if (data.note) {
    curY = ySummary + 120;
    doc.font(`${FONT}-Bold`).fontSize(8).fillColor('#475569').text('Note:', MARGINE, curY);
    doc.font(FONT).fontSize(7.5).fillColor('#64748b').text(data.note, MARGINE, curY + 10, { width: larghezzaUtile });
  }

  // Footer di conformità
  doc.font(FONT).fontSize(7).fillColor('#94a3b8').text(
    `Documento generato da BluMan Advisory Platform • Conforme tracciato SDI FatturaPA 1.2 • Art. 21 DPR 633/72`,
    MARGINE,
    doc.page.height - 30,
    { width: larghezzaUtile, align: 'center' }
  );

  return await pdfDocToBuffer(doc);
}
