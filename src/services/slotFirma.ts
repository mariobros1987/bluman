// §36 — La firma dentro il documento: il vocabolario del segnaposto e le sue primitive.
//
// Prima di questo file la firma del cliente non entrava MAI nel documento firmato: il
// sigillo finiva nella riga `FirmaElettronica` e la grafometrica in un PDF a parte (il
// verbale). Chi apriva il contratto vedeva l'area firme vuota, con il filetto tratteggiato
// che il template aveva previsto e nient'altro — e doveva fidarsi che da qualche altra
// parte esistesse la prova.
//
// Il segnaposto `{{firma_cliente}}` (e il gemello `{{firma_studio}}`) dice al motore di
// generazione DOVE va la firma. Il tag non sopravvive alla generazione: `risolviTagDocumento`
// lo traduce in un marcatore interno, il parser a blocchi lo riconosce e trasforma il
// paragrafo (o la colonna) che lo contiene in uno slot di firma. Al momento della firma il
// documento viene ricomposto da quegli stessi blocchi con l'immagine dentro lo slot.
//
// Qui stanno solo le primitive, senza dipendenze dal motore di resa: così il motore importa
// questo file e non il contrario, e non nasce un ciclo fra i due (regola 8).

/** Chi firma. `cliente` è il firmatario del portale, `studio` il professionista incaricato. */
export type SlotFirma = 'cliente' | 'studio';

/**
 * Tag del vocabolario dei template → slot. Sono gli unici due riconosciuti: un
 * `{{firma_qualcosa}}` diverso resta letterale come ogni altro tag sconosciuto, invece di
 * produrre un'area firma muta che nessuno riempirà mai.
 */
export const TAG_SLOT_FIRMA: Record<string, SlotFirma> = {
  firma_cliente: 'cliente',
  firma_studio: 'studio',
};

/**
 * Marcatore interno che il tag diventa dopo il merge. Le doppie quadre non compaiono nei
 * template (che usano `{{...}}`) e sopravvivono a `testoDaHtml`, che è ciò che serve: il
 * parser lavora sul testo già ripulito dal markup.
 */
export function marcatoreSlot(slot: SlotFirma): string {
  return `[[firma:${slot}]]`;
}

const REGEX_MARCATORE = /\[\[firma:(cliente|studio)\]\]/g;

/**
 * Cerca un marcatore nel testo di un blocco. Ritorna lo slot trovato (il primo, se per
 * distrazione il template ne mette due nello stesso paragrafo) e il testo ripulito da
 * TUTTI i marcatori, che diventa l'etichetta dell'area firma: «Il Cliente», il nome del
 * referente, quello che il template aveva scritto attorno al segnaposto.
 *
 * Il testo ripulito conserva gli a capo e perde le righe rimaste vuote: un
 * `Il Cliente<br/>{{firma_cliente}}` deve dare l'etichetta «Il Cliente», non
 * «Il Cliente\n».
 */
export function estraiSlotFirma(testo: string): { slot: SlotFirma | null; etichetta: string } {
  if (!testo || typeof testo !== 'string') return { slot: null, etichetta: testo ?? '' };
  REGEX_MARCATORE.lastIndex = 0;
  const trovato = REGEX_MARCATORE.exec(testo);
  if (!trovato) return { slot: null, etichetta: testo };

  const slot = trovato[1] as SlotFirma;
  const etichetta = testo
    .replace(REGEX_MARCATORE, '')
    .split('\n')
    .map((riga) => riga.replace(/[ \t]+/g, ' ').trim())
    .filter((riga) => riga !== '')
    .join('\n');
  return { slot, etichetta };
}

/** Vero se il testo contiene almeno un marcatore di slot. */
export function contieneSlotFirma(testo: string | undefined): boolean {
  if (!testo) return false;
  REGEX_MARCATORE.lastIndex = 0;
  return REGEX_MARCATORE.test(testo);
}

/**
 * Dati che il momento della firma consegna al motore di resa per un singolo slot. Le righe
 * di attestazione le compone chi ha in mano il sigillo (`copiaFirmata.ts`): il renderer non
 * inventa testo e non formatta date, così i test sono deterministici e nessun dato che il
 * database non ha può nascere qui (regola 7).
 */
export interface FirmaDaApporre {
  /** Grafometrica: data URL `data:image/png;base64,...` oppure base64 puro. */
  immaginePng?: string | null;
  /** Righe stampate sotto la riga di firma, in piccolo: nome, data, ID firma, sigillo. */
  righe?: string[];
}

export type FirmeDaApporre = Partial<Record<SlotFirma, FirmaDaApporre>>;

const MAGIC_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Converte la grafometrica in byte disegnabili, o ritorna null.
 *
 * Il controllo sui magic bytes non è pedanteria: pdfkit accetta solo PNG e JPEG, e su un
 * buffer che non è né l'uno né l'altro solleva dentro il rendering — cioè romperebbe la
 * generazione della copia firmata a metà. Meglio nessuna immagine e le righe di
 * attestazione (che dicono chi ha firmato e quando) di un documento che non esce.
 */
export function bytePngFirma(valore: string | null | undefined): Buffer | null {
  if (typeof valore !== 'string' || valore.trim() === '') return null;
  const base64 = valore.replace(/^data:image\/[a-zA-Z+]+;base64,/, '').trim();
  if (base64 === '') return null;
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < MAGIC_PNG.length) return null;
    return buffer.subarray(0, MAGIC_PNG.length).equals(MAGIC_PNG) ? buffer : null;
  } catch {
    return null;
  }
}
