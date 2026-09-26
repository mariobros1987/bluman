/**
 * KYC/AML Fase K8b (spec §5.3/§10) — il dossier PDF della segnalazione FIAU (STR).
 *
 * Rende leggibile per l'MLRO lo snapshot `DossierStr` congelato dal service: è il documento che l'MLRO
 * usa per compilare la segnalazione sul portale goAML/FIAU. NON è il tracciato regolatorio XSD (in
 * prima fase nessuna integrazione diretta, spec §10). Documento riservato: l'intestazione lo dichiara
 * — nulla di questo flusso è comunicabile al cliente (spec §5.3, «Vincolo critico»).
 */
import PDFDocument from 'pdfkit';
import type { DossierStr } from '../domain/segnalazioneFiau.js';

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
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('it-IT', { timeZone: 'UTC' }) + ' UTC';
}

export async function generaDossierStrPdf(d: DossierStr, opts?: { riferimentoGoaml?: string | null; trasmessaAt?: string | null }): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGINE,
    compress: false,
    info: { Title: 'Segnalazione operazione sospetta (STR)', Author: d.studio.ragioneSociale ?? 'Studio', Subject: 'Dossier riservato MLRO — FIAU/goAML' },
  });
  const larghezza = doc.page.width - MARGINE * 2;

  // Intestazione + banda di riservatezza (spec §5.3).
  doc.font(`${FONT}-Bold`).fontSize(15).fillColor('#7f1d1d').text('SEGNALAZIONE DI OPERAZIONE SOSPETTA (STR)', MARGINE, MARGINE, { width: larghezza });
  doc.font(FONT).fontSize(8).fillColor('#991b1b').text('Documento riservato all’MLRO — uso interno per la compilazione sul portale FIAU/goAML. Vietato comunicarne l’esistenza o il contenuto al cliente (spec §5.3).', MARGINE, MARGINE + 20, { width: larghezza });

  let y = MARGINE + 46;
  const linea = () => { doc.moveTo(MARGINE, y).lineTo(MARGINE + larghezza, y).strokeColor('#cbd5e1').lineWidth(1).stroke(); y += 8; };
  const titolo = (t: string) => { doc.font(`${FONT}-Bold`).fontSize(10).fillColor('#0f172a').text(t, MARGINE, y); y += 15; };
  const riga = (k: string, v: string | null) => {
    doc.font(`${FONT}-Bold`).fontSize(8.5).fillColor('#334155').text(`${k}: `, MARGINE, y, { continued: true });
    doc.font(FONT).fillColor('#0f172a').text(v && v.trim() ? v : '—', { width: larghezza - 8 });
    y = doc.y + 2;
  };

  linea();
  titolo('Ente segnalante');
  riga('Studio', d.studio.ragioneSociale);
  riga('P.IVA', d.studio.partitaIva);
  riga('MLRO (userId)', d.studio.mlroUserId);
  y += 4; linea();

  titolo('Soggetto segnalato');
  riga('Denominazione', d.soggetto.denominazione);
  riga('Tipo', d.soggetto.tipo);
  riga('Codice fiscale', d.soggetto.codiceFiscale);
  riga('Paese di residenza', d.soggetto.paeseResidenza);
  riga('PEP', d.soggetto.pep ? 'Sì' : 'No');
  y += 4; linea();

  titolo('Titolari effettivi');
  if (d.titolariEffettivi.length === 0) {
    doc.font(FONT).fontSize(8.5).fillColor('#64748b').text('Nessun titolare effettivo registrato nel fascicolo.', MARGINE, y, { width: larghezza }); y = doc.y + 2;
  } else {
    d.titolariEffettivi.forEach((t) => riga(t.denominazione ?? 'TE', `${t.criterio ?? '—'}${t.percentuale ? ` · ${t.percentuale}%` : ''}${t.fonte ? ` · fonte: ${t.fonte}` : ''}`));
  }
  y += 4; linea();

  titolo('Valutazione del rischio (4 pilastri)');
  if (d.rischio) {
    riga('Livello complessivo', d.rischio.livelloComplessivo);
    riga('Cliente / Geografia / Prodotto / Canale', `${d.rischio.cliente} / ${d.rischio.geografia} / ${d.rischio.prodotto} / ${d.rischio.canale}`);
    riga('Motivazione', d.rischio.motivazione);
  } else {
    doc.font(FONT).fontSize(8.5).fillColor('#64748b').text('Nessuna valutazione di rischio registrata.', MARGINE, y, { width: larghezza }); y = doc.y + 2;
  }
  y += 4; linea();

  titolo('Screening (sanzioni / PEP / media negativi)');
  if (d.screening.length === 0) {
    doc.font(FONT).fontSize(8.5).fillColor('#64748b').text('Nessuno screening registrato.', MARGINE, y, { width: larghezza }); y = doc.y + 2;
  } else {
    d.screening.forEach((s) => riga(`${s.tipo} (${dataIt(s.dataScreening)})`, `${s.esito}${s.note ? ` — ${s.note}` : ''}`));
  }
  y += 4; linea();

  titolo('Anomalia e decisione MLRO');
  riga('Tipo anomalia', d.anomalia.tipo);
  riga('Rilevata il', dataIt(d.anomalia.rilevataIl));
  riga('Descrizione', d.anomalia.descrizione);
  if (d.decisioneMlro) {
    riga('Decisione MLRO', d.decisioneMlro.decisione);
    riga('Motivazione', d.decisioneMlro.motivazione);
    riga('Decisa il', dataIt(d.decisioneMlro.decisaIl));
  }
  y += 4; linea();

  titolo('Stato invio FIAU / goAML');
  riga('Riferimento goAML', opts?.riferimentoGoaml ?? null);
  riga('Trasmessa il', opts?.trasmessaAt ? dataIt(opts.trasmessaAt) : null);

  y = doc.y + 10;
  doc.font(FONT).fontSize(7.5).fillColor('#64748b').text(
    `Dossier preparato il ${dataIt(d.preparatoIl)}. Il sistema prepara i dati e registra il riferimento; l’invio avviene manualmente sul portale FIAU a cura dell’MLRO (spec §5.3/§10).`,
    MARGINE, y, { width: larghezza },
  );

  return pdfDocToBuffer(doc);
}
