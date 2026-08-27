// Punto 2 piano gap — Verbale di firma.
//
// FirmaElettronica contiene i dati probatori (hash, IP, canale verificato, OTP collegata,
// eventuale grafometrica) ma non un documento umano-leggibile che riassuma l'evento. Questo
// builder puro genera il PDF del verbale con pdfkit a partire dai dati del sigillo e della
// firma: nessuna lettura DB qui, solo resa grafica di dati già raccolti dal chiamante.
//
// Il verbale è un atto certificativo: dice esattamente quello che la piattaforma ha
// registrato, niente di più. Se l'IP manca scrive "non registrato", se l'OTP non c'è
// (manuale_scansionata / qualificata_esterna) la sezione è omessa, e per la firma
// qualificata esterna dichiara che il certificato non è stato validato — un'etichetta non
// può promettere più di quanto è avvenuto.

import PDFDocument from 'pdfkit';
import { mascheraRecapito } from './otpService.js';

export interface DatiOtpVerbale {
  canale: string;
  target: string;
  targetDichiarato: boolean;
  targetAnagrafica: string | null;
  ultimoInvioAt?: Date | string | null;
  usatoAt?: Date | string | null;
}

export interface DatiVerbaleFirma {
  signatureId: string;
  tipoFirma: string; // fea_otp | manuale_scansionata | qualificata_esterna
  standard: string;
  documentoTitolo: string;
  /** SHA-256 del contenuto firmato: è l'impronta su cui si fissa il valore probatorio. */
  documentoHash: string;
  firmatarioNome: string;
  firmatarioRuolo: string | null;
  /** Nome del cliente (scheda anagrafica) a cui appartiene il firmatario. */
  clienteNome?: string | null;
  canaleVerificato: string | null;
  timestampIso: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** Impronta SHA-256 del sigillo: lega insieme tutti gli elementi del verbale. */
  sha256Digest: string;
  /** Presente solo se un codice OTP è stato effettivamente usato per questa firma. */
  otp?: DatiOtpVerbale | null;
  /** Data URL della grafometrica raccolta sul portale (§1.11), se presente. */
  firmaGrafometricaPng?: string | null;
  /** Per manuale_scansionata/qualificata_esterna: impronta del file ricaricato. */
  fileFirmatoHash?: string | null;
}

/** Descrizione in chiaro del tipo di firma: il valore tecnico da solo non parla. */
export function descrizioneTipoFirma(tipoFirma: string): string {
  switch (tipoFirma) {
    case 'fea_otp':
      return 'Firma Elettronica Avanzata (FEA) con codice OTP monouso';
    case 'manuale_scansionata':
      return 'Sottoscrizione autografa su carta, scansionata e ricaricata dal firmatario';
    case 'qualificata_esterna':
      return 'Firma Elettronica Qualificata (QES) apposta con provider esterno';
    default:
      return tipoFirma;
  }
}

function formattaData(iso: Date | string | null | undefined): string {
  if (!iso) return 'non registrato';
  const data = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(data.getTime())) return 'non registrato';
  return data.toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Converte un data URL in Buffer per pdfkit; null se non è un'immagine incorporabile. */
function dataUrlABuffer(dataUrl: string): Buffer | null {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl.trim());
  const base64 = match?.[2];
  if (!base64) return null;
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

const MARGINE = 46;
const FONT = 'Helvetica';
const NERO = '#0f172a';
const GRIGIO = '#64748b';

function pdfDocToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Intestazione di sezione: filetto grigio + titolo maiuscolo. */
function sezione(doc: PDFKit.PDFDocument, titolo: string): void {
  doc.moveDown(0.9);
  const y = doc.y;
  doc.moveTo(MARGINE, y).lineTo(doc.page.width - MARGINE, y).lineWidth(0.6).stroke('#cbd5e1');
  doc.moveDown(0.4);
  doc.font(`${FONT}-Bold`).fontSize(10).fillColor(NERO).text(titolo.toUpperCase(), MARGINE);
  doc.moveDown(0.35);
}

/** Coppia etichetta/valore su una riga; il valore lungo va a capo rientrato. */
function riga(doc: PDFKit.PDFDocument, etichetta: string, valore: string): void {
  doc.font(`${FONT}-Bold`).fontSize(9).fillColor(GRIGIO).text(etichetta, MARGINE, doc.y, { continued: false });
  doc.font(FONT).fontSize(9.5).fillColor(NERO).text(valore, MARGINE + 8, doc.y + 1.5, {
    width: doc.page.width - MARGINE * 2 - 8,
    lineBreak: true,
  });
  doc.moveDown(0.25);
}

/**
 * Genera il PDF del verbale di firma. `compress: false` mantiene il contenuto ispezionabile
 * (il verbale è un atto che deve poter essere verificato anche a occhio nudo sul file).
 */
export function generaPdfVerbaleFirma(dati: DatiVerbaleFirma): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGINE, compress: false, bufferPages: true });

  // Testata
  doc.font(`${FONT}-Bold`).fontSize(16).fillColor(NERO)
    .text('Verbale di firma elettronica', MARGINE, MARGINE);
  doc.moveDown(0.3);
  doc.font(FONT).fontSize(9).fillColor(GRIGIO)
    .text('Atto generato automaticamente dalla piattaforma a registrazione della firma. Documento certificativo: non modificabile e non soggetto a richieste di revisione.', MARGINE, doc.y, {
      width: doc.page.width - MARGINE * 2,
    });
  doc.moveDown(0.5);
  doc.font(`${FONT}-Bold`).fontSize(10).fillColor('#4338ca')
    .text(`Identificativo firma: ${dati.signatureId}`, MARGINE);

  // Documento firmato
  sezione(doc, 'Documento sottoscritto');
  riga(doc, 'Titolo', dati.documentoTitolo);
  riga(doc, 'Impronta SHA-256', dati.documentoHash.toLowerCase());
  if (dati.fileFirmatoHash) {
    riga(doc, 'Impronta SHA-256 del file ricaricato', dati.fileFirmatoHash.toLowerCase());
  }

  // Firmatario
  sezione(doc, 'Firmatario');
  riga(doc, 'Nome e cognome', dati.firmatarioNome);
  if (dati.firmatarioRuolo) riga(doc, 'Ruolo dichiarato', dati.firmatarioRuolo);
  if (dati.clienteNome) riga(doc, 'Cliente', dati.clienteNome);

  // Modalità di firma
  sezione(doc, 'Modalità di sottoscrizione');
  riga(doc, 'Tipo di firma', descrizioneTipoFirma(dati.tipoFirma));
  riga(doc, 'Standard di riferimento', dati.standard);
  if (dati.canaleVerificato) riga(doc, 'Verifica del firmatario', dati.canaleVerificato);

  // Dati della registrazione
  sezione(doc, 'Dati della registrazione');
  riga(doc, 'Data e ora (UTC)', formattaData(dati.timestampIso));
  riga(doc, 'Indirizzo IP', dati.ipAddress ?? 'non registrato');
  riga(doc, 'User agent', dati.userAgent ?? 'non registrato');
  riga(doc, 'Impronta SHA-256 del sigillo', dati.sha256Digest.toLowerCase());

  // Sezione OTP — solo se un codice è stato davvero usato: per manuale_scansionata e
  // qualificata_esterna senza OTP va omessa, non lasciata vuota.
  if (dati.otp) {
    const otp = dati.otp;
    sezione(doc, 'Verifica con codice OTP monouso');
    const nomiCanale: Record<string, string> = { whatsapp: 'WhatsApp', email: 'email', telegram: 'Telegram' };
    riga(doc, 'Canale di consegna', nomiCanale[otp.canale] || otp.canale);
    riga(doc, 'Recapito di consegna', mascheraRecapito(otp.target));
    riga(doc, 'Origine del recapito', otp.targetDichiarato
      ? `dichiarato dal firmatario in fase di firma${otp.targetAnagrafica ? ` (in anagrafica: ${mascheraRecapito(otp.targetAnagrafica)})` : ''}`
      : 'da scheda anagrafica');
    riga(doc, 'Ultimo invio del codice', formattaData(otp.ultimoInvioAt));
    riga(doc, 'Codice utilizzato il', formattaData(otp.usatoAt));
  }

  // Firma grafometrica — incorporata solo se presente e decodificabile; un errore di
  // decodifica non deve far fallire l'intero verbale.
  if (dati.firmaGrafometricaPng) {
    const immagine = dataUrlABuffer(dati.firmaGrafometricaPng);
    if (immagine) {
      try {
        sezione(doc, 'Firma grafometrica');
        const larghezzaMax = 180;
        doc.image(immagine, MARGINE, doc.y, { fit: [larghezzaMax, 90] });
      } catch {
        // Immagine non incorporabile: il dato resta nel sigillo, il verbale prosegue.
      }
    }
  }

  // Chiusura
  doc.moveDown(1.2);
  doc.font(FONT).fontSize(8).fillColor(GRIGIO)
    .text('Il presente verbale è stato generato automaticamente dal sistema al momento della registrazione della firma e riflette esclusivamente i dati conservati a database. Non è negoziabile: per contestazioni sul contenuto fa fede il sigillo informatico associato.', MARGINE, doc.y, {
      width: doc.page.width - MARGINE * 2,
    });

  return pdfDocToBuffer(doc);
}
