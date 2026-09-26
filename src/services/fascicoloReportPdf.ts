/**
 * KYC/AML Fase K9/§5.5 — il PDF del report riassuntivo del fascicolo per le ispezioni.
 *
 * Rende leggibile la struttura `ReportFascicolo` (assemblata dal builder puro): un documento unico che
 * lo studio consegna all'ispettore FIAU/MFSA con tutto lo stato di adeguata verifica di un cliente.
 * Documento interno riservato — non è comunicabile al cliente. Modulo a sé (regola 8), pdfkit.
 */
import PDFDocument from 'pdfkit';
import type { ReportFascicolo } from '../domain/reportFascicolo.js';

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

export async function generaReportFascicoloPdf(r: ReportFascicolo): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGINE, compress: false, info: { Title: 'Report fascicolo KYC', Author: r.studio.ragioneSociale ?? 'Studio', Subject: 'Report di compliance per ispezione' } });
  const larghezza = doc.page.width - MARGINE * 2;

  doc.font(`${FONT}-Bold`).fontSize(15).fillColor('#0f172a').text('REPORT FASCICOLO KYC / COMPLIANCE', MARGINE, MARGINE, { width: larghezza });
  doc.font(FONT).fontSize(8).fillColor('#64748b').text('Documento interno per ispezione FIAU/MFSA — non comunicabile al cliente.', MARGINE, MARGINE + 20, { width: larghezza });

  let y = MARGINE + 44;
  const linea = () => { doc.moveTo(MARGINE, y).lineTo(MARGINE + larghezza, y).strokeColor('#cbd5e1').lineWidth(1).stroke(); y += 8; };
  const titolo = (t: string) => { if (y > doc.page.height - 80) { doc.addPage(); y = MARGINE; } doc.font(`${FONT}-Bold`).fontSize(10).fillColor('#0f172a').text(t, MARGINE, y); y += 15; };
  const riga = (k: string, v: string | null) => {
    if (y > doc.page.height - 60) { doc.addPage(); y = MARGINE; }
    doc.font(`${FONT}-Bold`).fontSize(8.5).fillColor('#334155').text(`${k}: `, MARGINE, y, { continued: true });
    doc.font(FONT).fillColor('#0f172a').text(v && v.trim() ? v : '—', { width: larghezza - 8 });
    y = doc.y + 2;
  };
  const vuoto = (t: string) => { doc.font(FONT).fontSize(8.5).fillColor('#64748b').text(t, MARGINE, y, { width: larghezza }); y = doc.y + 2; };

  linea();
  titolo('Studio');
  riga('Ragione sociale', r.studio.ragioneSociale);
  riga('P.IVA', r.studio.partitaIva);
  riga('MLRO (userId)', r.studio.mlroUserId);
  y += 4; linea();

  titolo('Stato del fascicolo');
  riga('Stato', r.fascicolo.stato);
  riga('Livello di verifica', r.fascicolo.livelloVerifica);
  riga('Rischio calcolato', r.fascicolo.rischioCalcolato);
  riga('Verificato il / scadenza', `${dataIt(r.fascicolo.dataVerifica)} / ${dataIt(r.fascicolo.dataScadenza)}`);
  if (r.fascicolo.chiusoAt) riga('Chiuso il / conservazione fino al', `${dataIt(r.fascicolo.chiusoAt)} / ${dataIt(r.fascicolo.retentionScadenza)}${r.fascicolo.retentionEsito ? ` · esito: ${r.fascicolo.retentionEsito}` : ''}`);
  y += 4; linea();

  titolo('Soggetto');
  riga('Denominazione', r.soggetto.denominazione);
  riga('Tipo', r.soggetto.tipo);
  riga('Codice fiscale', r.soggetto.codiceFiscale);
  riga('Paese di residenza', r.soggetto.paeseResidenza);
  riga('PEP', r.soggetto.pep ? 'Sì' : 'No');
  y += 4; linea();

  titolo('Titolari effettivi');
  if (r.titolariEffettivi.length === 0) vuoto('Nessun titolare effettivo registrato.');
  else r.titolariEffettivi.forEach((t) => riga(t.denominazione ?? 'TE', `${t.criterio ?? '—'}${t.percentuale ? ` · ${t.percentuale}%` : ''}${t.fonte ? ` · fonte: ${t.fonte}` : ''}`));
  y += 4; linea();

  titolo('Valutazione del rischio (4 pilastri)');
  if (r.rischio) {
    riga('Livello complessivo', r.rischio.livelloComplessivo);
    riga('Cliente / Geografia / Prodotto / Canale', `${r.rischio.cliente} / ${r.rischio.geografia} / ${r.rischio.prodotto} / ${r.rischio.canale}`);
    riga('Motivazione', r.rischio.motivazione);
  } else vuoto('Nessuna valutazione di rischio registrata.');
  y += 4; linea();

  titolo('Screening (sanzioni / PEP / media negativi)');
  if (r.screening.length === 0) vuoto('Nessuno screening registrato.');
  else r.screening.forEach((s) => riga(`${s.tipo} (${dataIt(s.dataScreening)})`, `${s.esito}${s.note ? ` — ${s.note}` : ''}`));
  y += 4; linea();

  titolo('Anomalie e decisioni MLRO');
  if (r.anomalie.length === 0) vuoto('Nessuna anomalia registrata.');
  else r.anomalie.forEach((a) => riga(`${a.tipo} [${a.stato}]`, `${a.descrizione}${a.decisione ? ` — decisione: ${a.decisione}${a.motivazioneDecisione ? ` (${a.motivazioneDecisione})` : ''}` : ''}`));
  y += 4; linea();

  titolo('Segnalazioni FIAU (STR)');
  if (r.segnalazioni.length === 0) vuoto('Nessuna segnalazione.');
  else r.segnalazioni.forEach((s) => riga(s.stato, `${s.riferimentoGoaml ? `rif. ${s.riferimentoGoaml}` : 'nessun riferimento'}${s.trasmessaAt ? ` · ${dataIt(s.trasmessaAt)}` : ''}`));
  y += 4; linea();

  titolo('Storico degli stati');
  if (r.storico.length === 0) vuoto('Nessuno storico.');
  else r.storico.forEach((s) => riga(dataIt(s.data), `${s.statoPrecedente ?? '—'} → ${s.statoNuovo}${s.motivazione ? ` (${s.motivazione})` : ''}`));

  y = doc.y + 10;
  doc.font(FONT).fontSize(7.5).fillColor('#64748b').text(`Report generato il ${dataIt(r.generatoIl)}.`, MARGINE, y, { width: larghezza });
  return pdfDocToBuffer(doc);
}
