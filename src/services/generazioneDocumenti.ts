// Punto 1 piano gap — Export contestuale PDF + Word.
//
// Prima il PDF dei documenti da template veniva composto NEL BROWSER (jsPDF + html2canvas)
// e il bottone Word fabbricava un .doc con testo inventato. La generazione ora è
// server-side, da un unico merge dati, con due motori (decisione titolare 27/08/2026,
// niente LibreOffice su Railway):
//   - pdfkit        → PDF master: `fileUrl` e `filePdfUrl` puntano qui, e l'hash legale
//                     della firma si fissa su questo file per costruzione;
//   - docxtemplater → copia Word di cortesia per la firma autografa (`fileDocxUrl`).
//
// Il merge dati (`risolviTagDocumento`) replica fedelmente il vocabolario tag del client
// (frontend/src/utils/documentTemplates.ts :: resolveDocumentTemplateHtml), leggendo però
// da database invece che da localStorage: stessi tag, stessi fallback, niente dati
// inventati (regola 7 — il frontend non inventa ciò che il database non ha). Unica
// differenza voluta: il client avvolge i valori in <strong>, qui no — il parser a blocchi
// scarta comunque il markup inline e l'enfasi è data dal tipo di blocco (titolo,
// intestazione, evidenza).

import PDFDocument from 'pdfkit';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

// ---------------------------------------------------------------------------
// Merge dei tag
// ---------------------------------------------------------------------------

export interface ContestoTagDocumento {
  dataOdierna: string;
  studio: {
    ragioneSociale: string;
    piva: string;
    sedeLegale: string;
    iban: string;
    leadAdvisor: string;
    telefono: string;
    email: string;
  };
  cliente: {
    ragioneSociale: string;
    partitaIva: string;
    codiceFiscale: string;
    sedeLegale: string;
    pec: string;
    sdi: string;
    iban: string;
    referente: string;
    cellulare: string;
    ubo: string;
  };
  progetto: {
    titolo: string;
    importoTotale: string;
  };
}

/**
 * Il referente può stare in `referentiJson` come oggetto ({ referente: ... } / { nome: ... })
 * oppure come array di referenti: si prende il primo valore leggibile, senza inventare nulla.
 */
function referenteDaJson(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  if (Array.isArray(json)) {
    const primo = json[0];
    if (primo && typeof primo === 'object') {
      const p = primo as Record<string, unknown>;
      if (typeof p.nome === 'string' && p.nome.trim()) return p.nome.trim();
      if (typeof p.referente === 'string' && p.referente.trim()) return p.referente.trim();
    }
    return null;
  }
  const obj = json as Record<string, unknown>;
  if (typeof obj.referente === 'string' && obj.referente.trim()) return obj.referente.trim();
  if (typeof obj.nome === 'string' && obj.nome.trim()) return obj.nome.trim();
  return null;
}

/**
 * Costruisce il contesto di merge dalle righe Prisma (Tenant, Cliente, Progetto).
 * I fallback replicano quelli del client: etichette neutre («Studio Professionale»,
 * «Incarico Professionale», «Legale Rappresentante»), mai dati di fantasia.
 */
export function contestoTagDocumento(entita: {
  tenant?: {
    ragioneSociale?: string | null;
    piva?: string | null;
    sedeLegale?: string | null;
    iban?: string | null;
    leadAdvisorNome?: string | null;
    telefono?: string | null;
    email?: string | null;
  } | null;
  cliente?: {
    nome?: string | null;
    piva?: string | null;
    codiceFiscale?: string | null;
    sedeLegale?: string | null;
    sdiCode?: string | null;
    iban?: string | null;
    cellulare?: string | null;
    ubo?: string | null;
    referentiJson?: unknown;
  } | null;
  progetto?: { nome?: string | null; valoreTotale?: number | null } | null;
  /** Determinismo per i test: di default è la data odierna del server. */
  dataOdierna?: Date;
}): ContestoTagDocumento {
  const { tenant, cliente, progetto } = entita;

  const referente = referenteDaJson(cliente?.referentiJson) ?? 'Legale Rappresentante';
  const valore = progetto?.valoreTotale ?? 0;

  return {
    dataOdierna: (entita.dataOdierna ?? new Date()).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
    studio: {
      ragioneSociale: tenant?.ragioneSociale || 'Studio Professionale',
      piva: tenant?.piva || '',
      sedeLegale: tenant?.sedeLegale || '',
      iban: tenant?.iban || '',
      leadAdvisor: tenant?.leadAdvisorNome || 'Lead Senior Advisor',
      telefono: tenant?.telefono || '',
      email: tenant?.email || '',
    },
    cliente: {
      ragioneSociale: cliente?.nome || 'Cliente Committente',
      partitaIva: cliente?.piva || cliente?.codiceFiscale || '',
      codiceFiscale: cliente?.codiceFiscale || cliente?.piva || '',
      sedeLegale: cliente?.sedeLegale || '',
      // Cliente non ha un campo PEC a schema: come il client, il tag risolve a vuoto.
      pec: '',
      sdi: cliente?.sdiCode || '',
      iban: cliente?.iban || '',
      referente,
      cellulare: cliente?.cellulare || '',
      ubo: cliente?.ubo || referente,
    },
    progetto: {
      titolo: progetto?.nome || 'Incarico Professionale',
      importoTotale: valore ? `€ ${Number(valore).toLocaleString('it-IT')},00` : '€ 0,00',
    },
  };
}

/**
 * Sostituisce i tag {{...}} conosciuti con i valori del contesto. I tag sconosciuti
 * restano letterali, esattamente come nel client: un template che usa un tag non ancora
 * mappato lo mostra così com'è, invece di nascondere il dato mancante.
 */
export function risolviTagDocumento(html: string, contesto: ContestoTagDocumento): string {
  if (!html || typeof html !== 'string') return '';
  const { studio, cliente, progetto } = contesto;

  const sostituzioni: Record<string, string> = {
    'data_odierna': contesto.dataOdierna,
    'cliente.ragione_sociale': cliente.ragioneSociale,
    'cliente.nome': cliente.ragioneSociale,
    'cliente.partita_iva': cliente.partitaIva,
    'cliente.codice_fiscale': cliente.codiceFiscale,
    'cliente.sede_legale': cliente.sedeLegale,
    'cliente.pec': cliente.pec,
    'cliente.sdi': cliente.sdi,
    'cliente.iban': cliente.iban,
    'cliente.referente': cliente.referente,
    'cliente.cellulare': cliente.cellulare,
    'cliente.ubo': cliente.ubo,
    'progetto.titolo': progetto.titolo,
    'progetto.importo_totale': progetto.importoTotale,
    'studio.ragione_sociale': studio.ragioneSociale,
    'studio.piva': studio.piva,
    'studio.sede_legale': studio.sedeLegale,
    'studio.iban': studio.iban,
    'studio.lead_advisor': studio.leadAdvisor,
    'studio.telefono': studio.telefono,
    'studio.email': studio.email,
  };

  let out = html;
  for (const [tag, valore] of Object.entries(sostituzioni)) {
    // split/join invece di replace+regex: nessun carattere del valore o del tag deve
    // essere interpretato come metacarattere.
    out = out.split(`{{${tag}}}`).join(valore);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modello a blocchi + parser HTML
// ---------------------------------------------------------------------------
//
// I template (prebuilt e ModelloDocumentoCustom) usano solo p, div, h1-h4, strong, span,
// code e br: niente tabelle né liste. Il parser riduce l'HTML a una sequenza di blocchi
// tipizzati, che è l'unica cosa che i due motori di resa sanno disegnare.

export interface BloccoDocumento {
  tipo: 'titolo' | 'intestazione' | 'paragrafo' | 'evidenza' | 'firma';
  /** Testo già ripulito dal markup inline, con gli a capo preservati come \n. */
  testo?: string;
  /** Solo per tipo 'firma': una colonna per firmatario. */
  colonne?: string[];
  allineamento?: 'sinistra' | 'centro' | 'destra';
}

interface ElementoHtml {
  tag: string;
  attrs: string;
  inner: string;
}

/** Estrae il testo da un frammento HTML: via i tag inline, entità decodificate, <br> → \n. */
function testoDaHtml(html: string): string {
  const testo = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split('\n')
    .map((riga) => riga.replace(/[ \t]+/g, ' ').trim())
    .filter((riga) => riga !== '')
    .join('\n');
  return testo.trim();
}

function allineamentoDa(attrs: string): 'sinistra' | 'centro' | 'destra' | undefined {
  if (/text-align\s*:\s*center/i.test(attrs)) return 'centro';
  if (/text-align\s*:\s*right/i.test(attrs)) return 'destra';
  if (/text-align\s*:\s*left/i.test(attrs)) return 'sinistra';
  return undefined;
}

/**
 * Estrae gli elementi blocco di PRIMO LIVELLO in un frammento, contando la profondità per
 * gestire le annidature dello stesso tag (div dentro div): quando si apre un <div> mentre
 * se ne sta già scandendo uno, si scende di livello invece di chiudere il primo.
 */
function trovaElementiFigli(html: string): ElementoHtml[] {
  const out: ElementoHtml[] = [];
  const re = /<(h1|h2|h3|h4|p|div)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = (m[1] ?? '').toLowerCase();
    const attrs = m[2] ?? '';
    const inizioContenuto = m.index + m[0].length;

    const reConfronto = new RegExp(`<${tag}(?:\\b[^>]*)?>|</${tag}\\s*>`, 'gi');
    reConfronto.lastIndex = inizioContenuto;
    let profondita = 1;
    let fine = -1;
    let t: RegExpExecArray | null;
    while ((t = reConfronto.exec(html))) {
      if (t[0][1] === '/') {
        profondita -= 1;
        if (profondita === 0) {
          fine = t.index;
          break;
        }
      } else {
        profondita += 1;
      }
    }
    const fineContenuto = fine === -1 ? html.length : fine;
    out.push({ tag, attrs, inner: html.slice(inizioContenuto, fineContenuto) });
    // Salta l'elemento appena chiuso così lo scanner riprende dopo il suo </tag>.
    re.lastIndex = fine === -1 ? html.length : fine + tag.length + 3;
  }
  return out;
}

function blocchiDaElemento(el: ElementoHtml): BloccoDocumento[] {
  const allineamento = allineamentoDa(el.attrs);

  if (el.tag === 'h1') {
    const testo = testoDaHtml(el.inner);
    return testo ? [{ tipo: 'titolo', testo, allineamento }] : [];
  }
  if (el.tag === 'h2' || el.tag === 'h3' || el.tag === 'h4') {
    const testo = testoDaHtml(el.inner);
    return testo ? [{ tipo: 'intestazione', testo, allineamento }] : [];
  }
  if (el.tag === 'p') {
    const testo = testoDaHtml(el.inner);
    return testo ? [{ tipo: 'paragrafo', testo, allineamento }] : [];
  }

  // div: può essere un contenitore (area firma, wrapper) oppure un blocco di testo.
  const figli = trovaElementiFigli(el.inner);
  const figliDiv = figli.filter((f) => f.tag === 'div');

  if (figliDiv.length >= 2) {
    // Due o più div affiancati = area firme (flex con space-between nei template):
    // ogni div figlio diventa una colonna.
    const colonne = figliDiv.map((f) => testoDaHtml(f.inner)).filter(Boolean);
    return colonne.length ? [{ tipo: 'firma', colonne }] : [];
  }
  if (figli.length > 0) {
    // Contenitore con figli blocco ma non colonnare: si scende dentro.
    return figli.flatMap(blocchiDaElemento);
  }

  const testo = testoDaHtml(el.inner);
  if (!testo) return [];
  const tipo = /background\s*:/i.test(el.attrs) ? 'evidenza' : 'paragrafo';
  return [{ tipo, testo, allineamento }];
}

/**
 * Riduce l'HTML risolto (tag già sostituiti) in blocchi. Se il markup non produce nulla
 * (template con elementi non supportati) ripiega sul testo grezzo, così la generazione
 * non restituisce mai un documento vuoto quando c'è contenuto leggibile.
 */
export function blocchiDaHtml(html: string): BloccoDocumento[] {
  const pulito = (html || '').replace(/<!--[\s\S]*?-->/g, '');
  const blocchi = trovaElementiFigli(pulito).flatMap(blocchiDaElemento);
  const pieni = blocchi.filter((b) =>
    b.tipo === 'firma' ? (b.colonne?.length ?? 0) > 0 : Boolean((b.testo ?? '').trim()),
  );
  if (pieni.length > 0) return pieni;
  const grezzo = testoDaHtml(pulito);
  return grezzo ? [{ tipo: 'paragrafo', testo: grezzo }] : [];
}

// ---------------------------------------------------------------------------
// Motore PDF (pdfkit)
// ---------------------------------------------------------------------------
//
// Stessa scuola grafica di verbaleFirma.ts: A4, Helvetica, margini 46pt, compress:false
// perché il contenuto resti ispezionabile nei byte (e verificabile nei test con il
// decoder delle stringhe esadecimali di pdfkit).

const MARGINE = 46;
const FONT = 'Helvetica';
const NERO = '#0f172a';
const GRIGIO = '#64748b';
const ACCENTO = '#4338ca';
const FILOTTO = '#e2e8f0';
const FIRMA_LINEA = '#94a3b8';
const FONDO_EVIDENZA = '#f8fafc';

function pdfDocToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function allineamentoPdf(blocco: BloccoDocumento, predefinito: 'left' | 'center' | 'right' | 'justify'): 'left' | 'center' | 'right' | 'justify' {
  if (blocco.allineamento === 'centro') return 'center';
  if (blocco.allineamento === 'destra') return 'right';
  if (blocco.allineamento === 'sinistra') return 'left';
  return predefinito;
}

function renderizzaTitolo(doc: PDFKit.PDFDocument, blocco: BloccoDocumento, larghezzaUtile: number): void {
  doc.moveDown(0.2);
  doc.font(`${FONT}-Bold`).fontSize(14.5).fillColor('#1e1b4b').text(blocco.testo ?? '', MARGINE, doc.y, {
    width: larghezzaUtile,
    align: allineamentoPdf(blocco, 'center'),
    lineGap: 2.5,
  });
  doc.moveDown(0.7);
}

function renderizzaIntestazione(doc: PDFKit.PDFDocument, blocco: BloccoDocumento, larghezzaUtile: number): void {
  doc.moveDown(0.55);
  const y = doc.y;
  doc.moveTo(MARGINE, y).lineTo(MARGINE + larghezzaUtile, y).lineWidth(0.6).stroke(FILOTTO);
  doc.moveDown(0.4);
  doc.font(`${FONT}-Bold`).fontSize(11).fillColor('#1e1b4b').text(blocco.testo ?? '', MARGINE, doc.y, {
    width: larghezzaUtile,
    align: allineamentoPdf(blocco, 'left'),
  });
  doc.moveDown(0.3);
}

function renderizzaParagrafo(doc: PDFKit.PDFDocument, blocco: BloccoDocumento, larghezzaUtile: number): void {
  doc.font(FONT).fontSize(9.5).fillColor(NERO).text(blocco.testo ?? '', MARGINE, doc.y + 2, {
    width: larghezzaUtile,
    align: allineamentoPdf(blocco, 'justify'),
    lineGap: 3.5,
  });
  doc.moveDown(0.45);
}

function renderizzaEvidenza(doc: PDFKit.PDFDocument, blocco: BloccoDocumento, larghezzaUtile: number): void {
  const padding = 12;
  const larghezzaTesto = larghezzaUtile - padding * 2 - 4;
  doc.font(FONT).fontSize(9.5);
  const altezzaTesto = doc.heightOfString(blocco.testo ?? '', { width: larghezzaTesto, lineGap: 3.5 });
  const altezzaTotale = altezzaTesto + padding * 2;
  if (doc.y + altezzaTotale > doc.page.height - MARGINE) doc.addPage();

  const y0 = doc.y + 4;
  doc.save();
  doc.rect(MARGINE, y0, larghezzaUtile, altezzaTotale).fill(FONDO_EVIDENZA);
  doc.rect(MARGINE, y0, 3, altezzaTotale).fill(ACCENTO);
  doc.restore();
  doc.font(FONT).fontSize(9.5).fillColor(NERO).text(blocco.testo ?? '', MARGINE + padding + 4, y0 + padding, {
    width: larghezzaTesto,
    align: 'left',
    lineGap: 3.5,
  });
  doc.y = y0 + altezzaTotale + 10;
  doc.x = MARGINE;
}

function renderizzaFirma(doc: PDFKit.PDFDocument, blocco: BloccoDocumento, larghezzaUtile: number): void {
  const colonne = blocco.colonne ?? [];
  if (colonne.length === 0) return;
  const gap = 18;
  const wCol = (larghezzaUtile - gap * (colonne.length - 1)) / colonne.length;

  const righePerColonna = colonne.map((c) => c.split('\n'));
  doc.font(FONT).fontSize(9);
  const altezzaMax = Math.max(
    ...righePerColonna.map((righe) => righe.reduce((a, r) => a + doc.heightOfString(r || ' ', { width: wCol }), 0)),
  );
  if (doc.y + altezzaMax + 40 > doc.page.height - MARGINE) doc.addPage();

  const y = doc.y + 16;
  colonne.forEach((testoColonna, i) => {
    const x = MARGINE + i * (wCol + gap);
    doc.save();
    doc.moveTo(x, y).lineTo(x + wCol, y).dash(3, { space: 2 }).lineWidth(0.7).stroke(FIRMA_LINEA);
    doc.restore();
    doc.font(FONT).fontSize(9).fillColor(NERO).text(testoColonna, x, y + 8, {
      width: wCol,
      align: 'center',
      lineGap: 3,
    });
  });
  doc.y = y + 8 + altezzaMax + 16;
  doc.x = MARGINE;
}

/** Genera il PDF master del documento a partire dai blocchi. */
export async function generaPdfDocumento(blocchi: BloccoDocumento[]): Promise<Buffer> {
  if (!blocchi.length) throw new Error('Nessun contenuto da generare: il documento è vuoto.');
  const doc = new PDFDocument({ size: 'A4', margin: MARGINE, compress: false, bufferPages: true });
  const larghezzaUtile = doc.page.width - MARGINE * 2;

  for (const blocco of blocchi) {
    switch (blocco.tipo) {
      case 'titolo':
        renderizzaTitolo(doc, blocco, larghezzaUtile);
        break;
      case 'intestazione':
        renderizzaIntestazione(doc, blocco, larghezzaUtile);
        break;
      case 'evidenza':
        renderizzaEvidenza(doc, blocco, larghezzaUtile);
        break;
      case 'firma':
        renderizzaFirma(doc, blocco, larghezzaUtile);
        break;
      default:
        renderizzaParagrafo(doc, blocco, larghezzaUtile);
    }
  }
  return pdfDocToBuffer(doc);
}

// ---------------------------------------------------------------------------
// Motore Word (docxtemplater)
// ---------------------------------------------------------------------------
//
// Il file .docx è assemblato in memoria (PizZip) con le cinque parti OOXML minime e poi
// renderizzato da docxtemplater. Vincoli della versione free verificati sperimentalmente:
//   - i tag sono sostituiti solo DENTRO <w:t> (non nei valori degli attributi): quindi lo
//     stile del paragrafo non può essere un tag, e si usano sezioni condizionali — una per
//     variante tipo×allineamento — con lo stile già scritto nel template;
//   - i valori sono SEMPRE escaped (& < > ") e con linebreaks:true gli \n diventano <w:br/>;
//   - paragraphLoop:true elimina i paragrafi che contengono solo i tag di sezione, quindi
//     le varianti false non lasciano righe vuote.
// Ogni voce di `paragrafi` porta esattamente una bandierina di variante a true.

const CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const DOCUMENT_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

// stili.xml — gli stessi caratteri della resa PDF: titolo indigo scuro 15pt, corpo 9.5pt
// giustificato, evidenza con fondo chiaro e barra sinistra, firme centrate con filetto.
// Le dimensioni sono in mezzi punti (sz 19 = 9.5pt).
const STILI_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="20"/><w:szCs w:val="20"/>' +
  '</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  // Titolo: bold 15pt, indigo scuro, centrato
  '<w:style w:type="paragraph" w:styleId="TitoloDoc"><w:name w:val="TitoloDoc"/>' +
  '<w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="260"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="1E1B4B"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="TitoloDocSx"><w:name w:val="TitoloDocSx"/>' +
  '<w:pPr><w:spacing w:before="120" w:after="260"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="1E1B4B"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
  // Intestazione: bold 11pt, indigo scuro, filetto sotto
  '<w:style w:type="paragraph" w:styleId="IntestazioneDoc"><w:name w:val="IntestazioneDoc"/>' +
  '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CBD5E1"/></w:pBdr>' +
  '<w:spacing w:before="260" w:after="140"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="1E1B4B"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="IntestazioneDocCentro"><w:name w:val="IntestazioneDocCentro"/>' +
  '<w:pPr><w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CBD5E1"/></w:pBdr>' +
  '<w:spacing w:before="260" w:after="140"/></w:pPr>' +
  '<w:rPr><w:b/><w:color w:val="1E1B4B"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>' +
  // Paragrafo: 9.5pt, giustificato, interlinea 1.3
  '<w:style w:type="paragraph" w:styleId="ParagrafoDoc"><w:name w:val="ParagrafoDoc"/>' +
  '<w:pPr><w:jc w:val="both"/><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr>' +
  '<w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ParagrafoDocCentro"><w:name w:val="ParagrafoDocCentro"/>' +
  '<w:pPr><w:jc w:val="center"/><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr>' +
  '<w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ParagrafoDocDestra"><w:name w:val="ParagrafoDocDestra"/>' +
  '<w:pPr><w:jc w:val="right"/><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr>' +
  '<w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
  // Evidenza: fondo chiaro, barra sinistra indigo, rientri
  '<w:style w:type="paragraph" w:styleId="EvidenzaDoc"><w:name w:val="EvidenzaDoc"/>' +
  '<w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>' +
  '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="4338CA"/></w:pBdr>' +
  '<w:spacing w:before="140" w:after="180" w:line="300" w:lineRule="auto"/>' +
  '<w:ind w:left="120" w:right="120"/></w:pPr>' +
  '<w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>' +
  // Firma: 9pt centrato, filetto tratteggiato sopra (la riga della firma)
  '<w:style w:type="paragraph" w:styleId="FirmaDoc"><w:name w:val="FirmaDoc"/>' +
  '<w:pPr><w:jc w:val="center"/>' +
  '<w:pBdr><w:top w:val="dashed" w:sz="4" w:space="6" w:color="94A3B8"/></w:pBdr>' +
  '<w:spacing w:before="220" w:after="80" w:line="280" w:lineRule="auto"/></w:pPr>' +
  '<w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
  '</w:styles>';

// document.xml — un solo loop; la variante di stile è scelta dalle sezioni condizionali.
// Le bandierine vX sono mutamente esclusive per costruzione (vedi paragrafiDocx).
const TEMPLATE_DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  '<w:p><w:r><w:t>{#paragrafi}</w:t></w:r></w:p>' +
  // titolo
  '<w:p><w:r><w:t>{#vTitoloCentro}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="TitoloDoc"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vTitoloCentro}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{#vTitoloSinistra}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="TitoloDocSx"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vTitoloSinistra}</w:t></w:r></w:p>' +
  // intestazione
  '<w:p><w:r><w:t>{#vIntestazioneSinistra}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="IntestazioneDoc"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vIntestazioneSinistra}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{#vIntestazioneCentro}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="IntestazioneDocCentro"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vIntestazioneCentro}</w:t></w:r></w:p>' +
  // paragrafo
  '<w:p><w:r><w:t>{#vParagrafoGiustificato}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="ParagrafoDoc"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vParagrafoGiustificato}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{#vParagrafoCentro}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="ParagrafoDocCentro"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vParagrafoCentro}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{#vParagrafoDestra}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="ParagrafoDocDestra"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vParagrafoDestra}</w:t></w:r></w:p>' +
  // evidenza
  '<w:p><w:r><w:t>{#vEvidenza}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="EvidenzaDoc"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vEvidenza}</w:t></w:r></w:p>' +
  // firma: una colonna = un paragrafo centrato con filetto sopra
  '<w:p><w:r><w:t>{#vFirma}</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:pStyle w:val="FirmaDoc"/></w:pPr><w:r><w:t>{testo}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/vFirma}</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>{/paragrafi}</w:t></w:r></w:p>' +
  // A4, margini 2cm (twip: 1134)
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>' +
  '</w:sectPr></w:body></w:document>';

interface ParagrafoDocx {
  testo: string;
  vTitoloCentro?: boolean;
  vTitoloSinistra?: boolean;
  vIntestazioneSinistra?: boolean;
  vIntestazioneCentro?: boolean;
  vParagrafoGiustificato?: boolean;
  vParagrafoCentro?: boolean;
  vParagrafoDestra?: boolean;
  vEvidenza?: boolean;
  vFirma?: boolean;
}

/** Traduce i blocchi nelle voci del loop docxtemplater: una bandierina di variante per voce. */
export function paragrafiDocx(blocchi: BloccoDocumento[]): ParagrafoDocx[] {
  const out: ParagrafoDocx[] = [];
  for (const blocco of blocchi) {
    if (blocco.tipo === 'firma') {
      for (const colonna of blocco.colonne ?? []) {
        if (colonna.trim()) out.push({ testo: colonna, vFirma: true });
      }
      continue;
    }
    const testo = blocco.testo ?? '';
    if (blocco.tipo === 'titolo') {
      out.push({ testo, vTitoloCentro: blocco.allineamento !== 'sinistra' && blocco.allineamento !== 'destra', vTitoloSinistra: blocco.allineamento === 'sinistra' || blocco.allineamento === 'destra' });
      continue;
    }
    if (blocco.tipo === 'intestazione') {
      out.push({ testo, vIntestazioneCentro: blocco.allineamento === 'centro', vIntestazioneSinistra: blocco.allineamento !== 'centro' });
      continue;
    }
    if (blocco.tipo === 'evidenza') {
      out.push({ testo, vEvidenza: true });
      continue;
    }
    out.push({
      testo,
      vParagrafoCentro: blocco.allineamento === 'centro',
      vParagrafoDestra: blocco.allineamento === 'destra',
      vParagrafoGiustificato: blocco.allineamento !== 'centro' && blocco.allineamento !== 'destra',
    });
  }
  return out;
}

/** Genera il file .docx del documento a partire dai blocchi. */
export function generaDocxDocumento(blocchi: BloccoDocumento[]): Buffer {
  if (!blocchi.length) throw new Error('Nessun contenuto da generare: il documento è vuoto.');

  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', ROOT_RELS_XML);
  zip.file('word/document.xml', TEMPLATE_DOCUMENT_XML);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  zip.file('word/styles.xml', STILI_XML);

  // Il generics della classe (`TZip = any`) accetta il PizZip senza cast.
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render({ paragrafi: paragrafiDocx(blocchi) });

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
