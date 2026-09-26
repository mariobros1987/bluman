/**
 * KYC/AML Fase K9/§5.5 — il PDF del report di STUDIO: la panoramica del presidio AML complessivo.
 *
 * Fotografia d'insieme per l'MLRO / le ispezioni: valutazione del rischio dell'attività corrente,
 * registro formazione, questionario FIAU e conteggi aggregati delle pratiche. I dati li aggrega la
 * rotta (query DB); qui si formatta soltanto. Documento interno riservato. Modulo a sé (regola 8).
 */
import PDFDocument from 'pdfkit';

export interface ReportStudioData {
  generatoIl: string; // ISO
  studio: { ragioneSociale: string | null; partitaIva: string | null; mlroUserId: string | null };
  businessRisk: { versione: number; livelloComplessivo: string; prossimaRevisione: string | null } | null;
  formazione: { ultima: string | null; totale: number };
  questionari: Array<{ anno: number; stato: string; riferimento: string | null }>;
  conteggi: {
    fascicoliTotali: number;
    perStato: Array<{ stato: string; n: number }>;
    perRischio: Array<{ rischio: string; n: number }>;
    anomalieTotali: number;
    segnalazioniTrasmesse: number;
    conservazioniInScadenza: number;
  };
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

function dataIt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('it-IT');
}

export async function generaReportStudioPdf(r: ReportStudioData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGINE, compress: false, info: { Title: 'Report compliance di studio', Author: r.studio.ragioneSociale ?? 'Studio', Subject: 'Panoramica AML complessiva' } });
  const larghezza = doc.page.width - MARGINE * 2;

  doc.font(`${FONT}-Bold`).fontSize(15).fillColor('#0f172a').text('REPORT COMPLIANCE DI STUDIO (AML)', MARGINE, MARGINE, { width: larghezza });
  doc.font(FONT).fontSize(8).fillColor('#64748b').text('Panoramica del presidio antiriciclaggio dello studio — documento interno per l’MLRO e le ispezioni.', MARGINE, MARGINE + 20, { width: larghezza });

  let y = MARGINE + 44;
  const linea = () => { doc.moveTo(MARGINE, y).lineTo(MARGINE + larghezza, y).strokeColor('#cbd5e1').lineWidth(1).stroke(); y += 8; };
  const titolo = (t: string) => { if (y > doc.page.height - 80) { doc.addPage(); y = MARGINE; } doc.font(`${FONT}-Bold`).fontSize(10).fillColor('#0f172a').text(t, MARGINE, y); y += 15; };
  const riga = (k: string, v: string | null) => {
    if (y > doc.page.height - 60) { doc.addPage(); y = MARGINE; }
    doc.font(`${FONT}-Bold`).fontSize(8.5).fillColor('#334155').text(`${k}: `, MARGINE, y, { continued: true });
    doc.font(FONT).fillColor('#0f172a').text(v && v.trim() ? v : '—', { width: larghezza - 8 });
    y = doc.y + 2;
  };

  linea();
  titolo('Studio');
  riga('Ragione sociale', r.studio.ragioneSociale);
  riga('P.IVA', r.studio.partitaIva);
  riga('MLRO (userId)', r.studio.mlroUserId);
  y += 4; linea();

  titolo('Valutazione del rischio dell’attività (business risk assessment)');
  if (r.businessRisk) {
    riga('Versione', String(r.businessRisk.versione));
    riga('Livello complessivo', r.businessRisk.livelloComplessivo);
    riga('Prossima revisione', dataIt(r.businessRisk.prossimaRevisione));
  } else riga('Stato', 'nessuna valutazione registrata');
  y += 4; linea();

  titolo('Formazione AML');
  riga('Attività registrate', String(r.formazione.totale));
  riga('Ultima formazione', dataIt(r.formazione.ultima));
  y += 4; linea();

  titolo('Questionario FIAU (REQ)');
  if (r.questionari.length === 0) riga('Stato', 'nessun questionario registrato');
  else r.questionari.forEach((q) => riga(String(q.anno), `${q.stato}${q.riferimento ? ` · rif. ${q.riferimento}` : ''}`));
  y += 4; linea();

  titolo('Pratiche KYC — conteggi');
  riga('Fascicoli totali', String(r.conteggi.fascicoliTotali));
  riga('Per stato', r.conteggi.perStato.map((s) => `${s.stato}: ${s.n}`).join(' · ') || '—');
  riga('Per rischio', r.conteggi.perRischio.map((s) => `${s.rischio}: ${s.n}`).join(' · ') || '—');
  riga('Anomalie totali', String(r.conteggi.anomalieTotali));
  riga('Segnalazioni FIAU trasmesse', String(r.conteggi.segnalazioniTrasmesse));
  riga('Conservazioni in scadenza', String(r.conteggi.conservazioniInScadenza));

  y = doc.y + 10;
  doc.font(FONT).fontSize(7.5).fillColor('#64748b').text(`Report generato il ${dataIt(r.generatoIl)}.`, MARGINE, y, { width: larghezza });
  return pdfDocToBuffer(doc);
}
