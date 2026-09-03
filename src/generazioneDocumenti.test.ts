/**
 * Punto 1 piano gap — Export contestuale PDF + Word.
 *
 * Tre livelli di copertura:
 * 1. Il motore di generazione puro (`services/generazioneDocumenti.ts`): merge dei tag
 *    con gli stessi fallback del client (mai dati inventati), parser a blocchi
 *    (titolo/intestazione/paragrafo/evidenza/firma a colonne) e i due render —
 *    pdfkit per il PDF master, docxtemplater per la copia Word.
 * 2. `POST /documenti/genera`: due upload dallo stesso merge (fileUrl == filePdfUrl,
 *    l'hash della firma resterà ancorato al PDF), audit DOCUMENTO_GENERATO, notifica
 *    documento_da_firmare solo se pubblicato; se il Word fallisce il PDF esce comunque
 *    e l'anomalia resta nell'audit.
 * 3. `GET /portal/documenti/:id/download`: il cliente ottiene l'URL firmato del formato
 *    richiesto; 404 esplicito se il Word non esiste (documenti storici), 409 se la
 *    scansione di sicurezza non è «pulito».
 *
 * Il client Prisma è mockato (pattern di verbaleFirma.test.ts) e con lui l'upload su
 * storage: la generazione non deve scrivere file né toccare Supabase nei test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import PizZip from 'pizzip';
import {
  contestoTagDocumento,
  risolviTagDocumento,
  blocchiDaHtml,
  generaPdfDocumento,
  generaDocxDocumento,
  paragrafiDocx,
} from './services/generazioneDocumenti.js';

/** Stato restituito dal finto client, riscritto da ogni test prima dell'uso. */
const stato = {
  progetto: null as any,
  tenant: null as any,
  modello: null as any,
  documentoPortale: null as any,
  uploadFails: false,
  uploadDocxFails: false,
  // Registri per asserire cosa il server ha scritto davvero (con i byte caricati).
  upload: [] as { filename: string; buffer: Buffer }[],
  documentiCreati: [] as any[],
  notifiche: [] as any[],
  audit: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    progetto: { findFirst: async () => stato.progetto },
    tenant: { findFirst: async () => stato.tenant },
    modelloDocumentoCustom: { findFirst: async () => stato.modello },
    documento: {
      findFirst: async () => stato.documentoPortale,
      create: async (args: any) => {
        stato.documentiCreati.push(args.data);
        return { ...args.data, id: 'doc-gen-1', versione: 1 };
      },
    },
    notifica: {
      create: async (args: any) => {
        stato.notifiche.push(args.data);
        // `createdAt` serve a serializzaNotifica per il frame SSE.
        return { id: `not-${stato.notifiche.length}`, createdAt: new Date(), ...args.data };
      },
    },
    auditLog: {
      create: async (args: any) => {
        stato.audit.push(args.data);
        return {};
      },
    },
    $transaction: async (fn: any) => (typeof fn === 'function' ? fn(finto) : Promise.all(fn)),
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// Né Supabase né filesystem locale: i byte restano nel registro `stato.upload`
// così i test possono ispezionare PDF e DOCX davvero generati.
vi.mock('./services/storageService.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    uploadDocumento: async (filename: string, contentBase64: string) => {
      if (stato.uploadFails) return { ok: false, url: '', name: filename, size: '0 KB' };
      if (stato.uploadDocxFails && filename.endsWith('.docx')) {
        return { ok: false, url: '', name: filename, size: '0 KB' };
      }
      stato.upload.push({ filename, buffer: Buffer.from(contentBase64, 'base64') });
      return { ok: true, url: `https://storage.example/${filename}`, name: filename, size: '1 KB' };
    },
  };
});

// Importati dopo `vi.mock`: `server.js` risolve i moduli mockati al proprio import.
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';
const CLIENTE_ID = 'cli-42';

function tokenCliente() {
  return signJwt({
    userId: `client-${CLIENTE_ID}`,
    tenantId: TENANT_STUDIO,
    email: 'cliente@esempio.it',
    ruolo: 'cliente',
  });
}

function tokenAdvisor() {
  return signJwt({ userId: 'usr-advisor', tenantId: TENANT_STUDIO, email: 'advisor@studio.example', ruolo: 'advisor' });
}

function serverConToken(token: string | null) {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts?.headers || {}) },
    });
  return server;
}

/**
 * pdfkit scrive il testo come stringhe esadecimali dentro array `TJ` con
 * kerning: concatenando le stringhe esadecimali in ordine si ricostruisce il
 * testo leggibile (font standard → i byte sono latin1).
 */
function testoPdf(pdf: Buffer): string {
  const grezzo = pdf.toString('latin1');
  const parti: string[] = [];
  for (const m of grezzo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    parti.push(Buffer.from(m[1] ?? '', 'hex').toString('latin1'));
  }
  return parti.join('');
}

/** Fixture di contesto completa, con data fissa per determinismo. */
function contestoFisso() {
  return contestoTagDocumento({
    tenant: {
      ragioneSociale: 'Studio BluMan',
      piva: 'IT01234567890',
      sedeLegale: 'Via Roma 1, Milano',
      iban: 'IT60X0542811101000000123456',
      leadAdvisorNome: 'Mario Rossi',
      telefono: '02 1234567',
      email: 'info@studio.example',
    },
    cliente: {
      nome: 'Rossi Spa',
      piva: 'IT09876543210',
      codiceFiscale: 'RSSMRA80A01H501U',
      sedeLegale: 'Via Torino 2, Torino',
      sdiCode: 'ABC1234',
      iban: 'IT28W0123456789000000098765',
      cellulare: '+39 333 1234567',
      ubo: 'Anna Verdi',
      referentiJson: { referente: 'Luigi Bianchi' },
    },
    progetto: { nome: 'Incarico consulenza 2026', valoreTotale: 12500 },
    dataOdierna: new Date(2026, 7, 27),
  });
}

/** Template HTML che esercita tutti i tipi di blocco e buona parte dei tag. */
const TEMPLATE_HTML = [
  '<h1 style="text-align:center">CONTRATTO DI CONSULENZA</h1>',
  '<p>Spett.le {{cliente.ragione_sociale}}, P.IVA {{cliente.partita_iva}}, data {{data_odierna}}.</p>',
  "<h2>Oggetto dell'incarico</h2>",
  '<p>Progetto {{progetto.titolo}} per un importo di {{progetto.importo_totale}}.</p>',
  '<div style="background:#f8fafc">Da firmare entro il {{data_odierna}}</div>',
  '<div style="display:flex;justify-content:space-between"><div>Lo Studio<br/>{{studio.lead_advisor}}</div><div>Il Cliente<br/>{{cliente.referente}}</div></div>',
].join('');

beforeEach(() => {
  stato.progetto = {
    id: 'prog-1',
    clienteId: CLIENTE_ID,
    nome: 'Incarico consulenza 2026',
    valoreTotale: 12500,
    cliente: {
      nome: 'Rossi Spa',
      piva: 'IT09876543210',
      codiceFiscale: null,
      sedeLegale: 'Via Torino 2, Torino',
      sdiCode: 'ABC1234',
      iban: null,
      cellulare: null,
      ubo: null,
      referentiJson: null,
    },
  };
  stato.tenant = {
    ragioneSociale: 'Studio BluMan',
    piva: 'IT01234567890',
    sedeLegale: 'Via Roma 1, Milano',
    iban: null,
    leadAdvisorNome: 'Mario Rossi',
    telefono: null,
    email: null,
  };
  stato.modello = null;
  stato.documentoPortale = null;
  stato.uploadFails = false;
  stato.uploadDocxFails = false;
  stato.upload.length = 0;
  stato.documentiCreati.length = 0;
  stato.notifiche.length = 0;
  stato.audit.length = 0;
});

// ---------------------------------------------------------------------------
// 1. Motore di generazione puro
// ---------------------------------------------------------------------------

describe('contestoTagDocumento — merge dei tag dal database', () => {
  it('mappa i campi di tenant, cliente e progetto con la formattazione del client', () => {
    const contesto = contestoFisso();
    expect(contesto.dataOdierna).toBe('27 agosto 2026');
    expect(contesto.studio.ragioneSociale).toBe('Studio BluMan');
    expect(contesto.studio.leadAdvisor).toBe('Mario Rossi');
    expect(contesto.cliente.ragioneSociale).toBe('Rossi Spa');
    expect(contesto.cliente.partitaIva).toBe('IT09876543210');
    expect(contesto.cliente.codiceFiscale).toBe('RSSMRA80A01H501U');
    expect(contesto.cliente.sdi).toBe('ABC1234');
    expect(contesto.cliente.referente).toBe('Luigi Bianchi');
    expect(contesto.cliente.ubo).toBe('Anna Verdi');
    // Il modello Cliente non ha un campo PEC: il tag risolve a vuoto, mai inventato.
    expect(contesto.cliente.pec).toBe('');
    expect(contesto.progetto.titolo).toBe('Incarico consulenza 2026');
    expect(contesto.progetto.importoTotale).toBe('€ 12.500,00');
  });

  it('senza entità usa le etichette neutre del client, mai dati di fantasia', () => {
    const contesto = contestoTagDocumento({ dataOdierna: new Date(2026, 7, 27) });
    expect(contesto.studio.ragioneSociale).toBe('Studio Professionale');
    expect(contesto.studio.leadAdvisor).toBe('Lead Senior Advisor');
    expect(contesto.cliente.ragioneSociale).toBe('Cliente Committente');
    expect(contesto.cliente.referente).toBe('Legale Rappresentante');
    // L'UBO ripiega sul referente quando manca.
    expect(contesto.cliente.ubo).toBe('Legale Rappresentante');
    expect(contesto.progetto.titolo).toBe('Incarico Professionale');
    expect(contesto.progetto.importoTotale).toBe('€ 0,00');
  });

  it('partita IVA assente → ripiega sul codice fiscale; referenti in array → primo nome leggibile', () => {
    const contesto = contestoTagDocumento({
      cliente: { nome: 'Ditta Verdi', piva: null, codiceFiscale: 'VRDLCU70B41F205X', referentiJson: [{ nome: 'Primo Referente' }] },
      dataOdierna: new Date(2026, 7, 27),
    });
    expect(contesto.cliente.partitaIva).toBe('VRDLCU70B41F205X');
    expect(contesto.cliente.referente).toBe('Primo Referente');
  });
});

describe('risolviTagDocumento — sostituzione tag', () => {
  it('sostituisce i tag conosciuti e lascia letterali gli sconosciuti', () => {
    const risolto = risolviTagDocumento(
      '<p>Spett.le {{cliente.ragione_sociale}} ({{cliente.nome}}), {{tag_sconosciuto}}, {{data_odierna}}</p>',
      contestoFisso(),
    );
    expect(risolto).toContain('Spett.le Rossi Spa (Rossi Spa)');
    expect(risolto).toContain('27 agosto 2026');
    // Come nel client: un tag non mappato resta visibile, non viene cancellato.
    expect(risolto).toContain('{{tag_sconosciuto}}');
  });

  it('HTML vuoto → stringa vuota', () => {
    expect(risolviTagDocumento('', contestoFisso())).toBe('');
  });
});

describe('blocchiDaHtml — parser a blocchi', () => {
  it('riconosce titolo centrato, intestazione, paragrafo, evidenza e firma a colonne', () => {
    const blocchi = blocchiDaHtml(risolviTagDocumento(TEMPLATE_HTML, contestoFisso()));

    expect(blocchi).toHaveLength(6);
    expect(blocchi[0]).toMatchObject({ tipo: 'titolo', testo: 'CONTRATTO DI CONSULENZA', allineamento: 'centro' });
    // Il primo paragrafo contiene il merge: valori reali, markup inline scartato.
    expect(blocchi[1]?.tipo).toBe('paragrafo');
    expect(blocchi[1]?.testo).toContain('Rossi Spa');
    expect(blocchi[1]?.testo).toContain('IT09876543210');
    expect(blocchi[2]).toMatchObject({ tipo: 'intestazione', testo: "Oggetto dell'incarico" });
    expect(blocchi[3]?.tipo).toBe('paragrafo');
    expect(blocchi[3]?.testo).toContain('Incarico consulenza 2026');
    expect(blocchi[3]?.testo).toContain('€ 12.500,00');
    expect(blocchi[4]).toMatchObject({ tipo: 'evidenza', testo: 'Da firmare entro il 27 agosto 2026' });
    expect(blocchi[5]?.tipo).toBe('firma');
    expect(blocchi[5]?.colonne).toEqual(['Lo Studio\nMario Rossi', 'Il Cliente\nLuigi Bianchi']);
  });

  it('i <br> diventano a capo nel testo del blocco', () => {
    const [blocco] = blocchiDaHtml('<p>Prima riga<br/>Seconda riga</p>');
    expect(blocco?.testo).toBe('Prima riga\nSeconda riga');
  });

  it('markup non supportato → ripiego sul testo grezzo, mai un documento vuoto', () => {
    const blocchi = blocchiDaHtml('testo grezzo senza tag');
    expect(blocchi).toEqual([{ tipo: 'paragrafo', testo: 'testo grezzo senza tag' }]);
  });

  it('template senza contenuto leggibile → nessun blocco', () => {
    expect(blocchiDaHtml('<p></p>')).toEqual([]);
    expect(blocchiDaHtml('')).toEqual([]);
  });

  // I 22 modelli di riorganizzazione avvolgono tutto il documento in un
  // `<div style="font-family: Arial">` che contiene intestazione, titolo, corpo e area
  // firme: quattro div figli. Col vecchio criterio («due o più div figli = area firme»)
  // l'intero documento usciva come UNA riga di firme a quattro colonne — e con §36 la
  // grafometrica del cliente sarebbe finita dentro quel blocco.
  it("l'involucro del documento non è un'area firme, nemmeno con più div figli", () => {
    const html = [
      '<div style="font-family: Arial, sans-serif; color: #1e293b;">',
      '<div style="display: flex; justify-content: space-between;"><div><h2>Studio Alfa</h2><p>P.IVA 123</p></div><div><div>Data: oggi</div><div>Rif. pratica</div></div></div>',
      '<h1>DICHIARAZIONE</h1>',
      '<div style="background:#f8fafc">CLIENTE: Rossi Spa</div>',
      '<div><h3>1. Oggetto</h3><p>Il contenuto della dichiarazione.</p></div>',
      '<div style="display: flex; justify-content: space-between;"><div><strong>Per Lo Studio:</strong><br/>Studio Alfa</div><div><strong>Per Il Cliente:</strong><br/>Rossi Spa</div></div>',
      '</div>',
    ].join('');
    const blocchi = blocchiDaHtml(html);

    // Una sola area firme, l'ultima: le colonne sono i due firmatari, non il documento.
    const firme = blocchi.filter((b) => b.tipo === 'firma');
    expect(firme).toHaveLength(1);
    expect(firme[0]?.colonne).toEqual(['Per Lo Studio:\nStudio Alfa', 'Per Il Cliente:\nRossi Spa']);
    // L'intestazione a due colonne (h2 + p dentro i div) resta testo, e il corpo sopravvive.
    expect(blocchi.find((b) => b.tipo === 'titolo')?.testo).toBe('DICHIARAZIONE');
    expect(blocchi.some((b) => b.tipo === 'intestazione' && b.testo === 'Studio Alfa')).toBe(true);
    expect(blocchi.some((b) => b.tipo === 'evidenza' && b.testo === 'CLIENTE: Rossi Spa')).toBe(true);
    expect(blocchi.some((b) => b.testo === 'Il contenuto della dichiarazione.')).toBe(true);
  });

  it('due div affiancati senza flex restano testo: le colonne di firma le dichiara il template', () => {
    const blocchi = blocchiDaHtml('<div><div>Riga A</div><div>Riga B</div></div>');
    expect(blocchi.every((b) => b.tipo === 'paragrafo')).toBe(true);
    expect(blocchi.map((b) => b.testo)).toEqual(['Riga A', 'Riga B']);
  });
});

describe('paragrafiDocx — bandierine di variante per il loop', () => {
  it('una voce per blocco, due voci per le colonne di firma, una sola bandierina attiva per voce', () => {
    const blocchi = blocchiDaHtml(risolviTagDocumento(TEMPLATE_HTML, contestoFisso()));
    const voci = paragrafiDocx(blocchi);

    // 5 blocchi di testo + 2 colonne di firma.
    expect(voci).toHaveLength(7);
    expect(voci[0]).toMatchObject({ testo: 'CONTRATTO DI CONSULENZA', vTitoloCentro: true });
    expect(voci[1]).toMatchObject({ vParagrafoGiustificato: true });
    expect(voci[2]).toMatchObject({ vIntestazioneSinistra: true });
    expect(voci[3]).toMatchObject({ vParagrafoGiustificato: true });
    expect(voci[4]).toMatchObject({ testo: 'Da firmare entro il 27 agosto 2026', vEvidenza: true });
    expect(voci[5]).toMatchObject({ testo: 'Lo Studio\nMario Rossi', vFirma: true });
    expect(voci[6]).toMatchObject({ testo: 'Il Cliente\nLuigi Bianchi', vFirma: true });

    for (const voce of voci) {
      const bandierine = Object.entries(voce)
        .filter(([k, v]) => k.startsWith('v') && v === true)
        .map(([k]) => k);
      expect(bandierine).toHaveLength(1);
    }
  });
});

describe('generaPdfDocumento — PDF master (pdfkit)', () => {
  it('emette un PDF valido con il testo mergiato dal contesto', async () => {
    const blocchi = blocchiDaHtml(risolviTagDocumento(TEMPLATE_HTML, contestoFisso()));
    const pdf = await generaPdfDocumento(blocchi);

    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const testo = testoPdf(pdf);
    expect(testo).toContain('CONTRATTO DI CONSULENZA');
    expect(testo).toContain('Rossi Spa');
    expect(testo).toContain('IT09876543210');
    // Il simbolo € non sopravvive al decoder latin1: si controlla il solo importo.
    expect(testo).toContain('12.500,00');
    expect(testo).toContain('27 agosto 2026');
  });

  it('senza blocchi solleva un errore esplicito', async () => {
    await expect(generaPdfDocumento([])).rejects.toThrow(/vuoto/);
  });
});

describe('generaDocxDocumento — copia Word (docxtemplater)', () => {
  it('emette un docx valido: zip OOXML, stili applicati, zero tag residui, testo mergiato', () => {
    const blocchi = blocchiDaHtml(risolviTagDocumento(TEMPLATE_HTML, contestoFisso()));
    const docx = generaDocxDocumento(blocchi);

    expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');
    const zip = new PizZip(docx);
    const documentXml = zip.file('word/document.xml')!.asText();
    const stylesXml = zip.file('word/styles.xml')!.asText();

    // Le 5 parti OOXML richieste da docxtemplater ci sono tutte.
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('_rels/.rels')).toBeTruthy();
    expect(zip.file('word/_rels/document.xml.rels')).toBeTruthy();

    expect(stylesXml).toContain('TitoloDoc');
    expect(stylesXml).toContain('EvidenzaDoc');
    expect(stylesXml).toContain('FirmaDoc');

    expect(documentXml).toContain('CONTRATTO DI CONSULENZA');
    expect(documentXml).toContain('€ 12.500,00');
    expect(documentXml).toContain('Da firmare entro il 27 agosto 2026');
    // Nessun tag di loop/sezione sopravvive al render.
    expect(documentXml).not.toMatch(/\{[#/^]?[a-zA-Z]/);
  });

  it('senza blocchi solleva un errore esplicito', () => {
    expect(() => generaDocxDocumento([])).toThrow(/vuoto/);
  });
});

// ---------------------------------------------------------------------------
// 2. POST /documenti/genera
// ---------------------------------------------------------------------------

describe('POST /documenti/genera — doppio formato dallo stesso merge', () => {
  it('pubblicato: crea il documento con PDF master + Word, audit e notifica al cliente', async () => {
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', contenutoHtml: TEMPLATE_HTML, titolo: 'Contratto di consulenza', statoDoc: 'pubblicato' },
    });

    expect(ris.statusCode).toBe(200);
    const corpo = ris.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.documento.id).toBe('doc-gen-1');
    expect(corpo.documento.firmato).toBe(false);

    const creato = stato.documentiCreati.at(-1);
    expect(creato.tipo).toBe('compilato');
    // Il PDF è il master: fileUrl e filePdfUrl coincidono, l'hash firma si fisserà lì.
    expect(creato.fileUrl).toBe(creato.filePdfUrl);
    expect(creato.fileUrl).toBe('https://storage.example/contratto-di-consulenza.pdf');
    expect(creato.fileDocxUrl).toBe('https://storage.example/contratto-di-consulenza.docx');
    expect(creato.formatoOrigine).toBe('pdf');
    expect(creato.statoScansione).toBe('pulito');
    expect(creato.statoDoc).toBe('pubblicato');
    expect(creato.pubblicatoAt).toBeInstanceOf(Date);
    expect(creato.caricatoDa).toBe('usr-advisor');
    expect(creato.categoriaDoc).toBe('generico');

    // §36 — i blocchi risolti restano attaccati alla riga: sono l'unica cosa da cui, alla
    // firma, si può ricomporre il documento con la grafometrica dentro l'area firma. Il
    // merge è già avvenuto: nel JSON non ci sono più segnaposto.
    expect(Array.isArray(creato.contenutoBlocchiJson)).toBe(true);
    expect(creato.contenutoBlocchiJson).toHaveLength(6);
    expect(JSON.stringify(creato.contenutoBlocchiJson)).toContain('Rossi Spa');
    expect(JSON.stringify(creato.contenutoBlocchiJson)).not.toContain('{{');

    // Due upload dallo stesso merge, con lo stesso slug.
    const nomi = stato.upload.map((u) => u.filename);
    expect(nomi).toEqual(['contratto-di-consulenza.pdf', 'contratto-di-consulenza.docx']);

    // I byte caricati contengono il merge reale in entrambi i formati.
    const pdf = stato.upload.find((u) => u.filename.endsWith('.pdf'))!.buffer;
    const testo = testoPdf(pdf);
    expect(testo).toContain('Rossi Spa');
    expect(testo).toContain('Incarico consulenza 2026');
    const documentXml = new PizZip(stato.upload.find((u) => u.filename.endsWith('.docx'))!.buffer)
      .file('word/document.xml')!.asText();
    expect(documentXml).toContain('Rossi Spa');
    expect(documentXml).toContain('€ 12.500,00');

    expect(stato.audit.some((a) => a.azione === 'DOCUMENTO_GENERATO' && a.entita === 'doc-gen-1')).toBe(true);
    expect(stato.notifiche.some((n) => n.tipoEvento === 'documento_da_firmare' && n.destinatarioClienteId === CLIENTE_ID)).toBe(true);
  });

  it('bozza (default): niente pubblicazione, niente notifica', async () => {
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', contenutoHtml: '<h1>Bozza interna</h1><p>Contenuto.</p>' },
    });

    expect(ris.statusCode).toBe(200);
    const creato = stato.documentiCreati.at(-1);
    expect(creato.statoDoc).toBe('bozza');
    expect(creato.pubblicatoAt).toBeNull();
    expect(stato.notifiche).toHaveLength(0);
  });

  it('modelloId: template, titolo e categoria arrivano dal ModelloDocumentoCustom', async () => {
    stato.modello = {
      id: 'mod-1',
      tenantId: TENANT_STUDIO,
      titolo: 'Lettera modello',
      categoria: 'contratto',
      contenutoHtml: '<h1>Lettera modello</h1><p>Spett.le {{cliente.ragione_sociale}}.</p>',
    };

    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', modelloId: 'mod-1' },
    });

    expect(ris.statusCode).toBe(200);
    const creato = stato.documentiCreati.at(-1);
    expect(creato.categoriaDoc).toBe('contratto');
    expect(stato.upload.map((u) => u.filename)).toContain('lettera-modello.pdf');
    const testo = testoPdf(stato.upload.find((u) => u.filename === 'lettera-modello.pdf')!.buffer);
    expect(testo).toContain('Rossi Spa');
  });

  it('400 senza progettoId', async () => {
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { contenutoHtml: '<p>X</p>' },
    });
    expect(ris.statusCode).toBe(400);
    expect(ris.json().errore).toContain('progettoId');
  });

  it('400 senza modello né contenuto HTML', async () => {
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1' },
    });
    expect(ris.statusCode).toBe(400);
    expect(ris.json().errore).toContain('modello');
  });

  it('404 con progetto inesistente', async () => {
    stato.progetto = null;
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-inesistente', contenutoHtml: '<p>X</p>' },
    });
    expect(ris.statusCode).toBe(404);
    expect(ris.json().errore).toBe('Progetto non trovato.');
  });

  it('404 con modello inesistente', async () => {
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', modelloId: 'mod-inesistente' },
    });
    expect(ris.statusCode).toBe(404);
    expect(ris.json().errore).toBe('Modello documento non trovato.');
  });

  it('400 con template vuoto o che non produce blocchi', async () => {
    const vuoto = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', contenutoHtml: '   ' },
    });
    expect(vuoto.statusCode).toBe(400);
    expect(vuoto.json().errore).toContain('non ha contenuto');

    const senzaBlocchi = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', contenutoHtml: '<p></p>' },
    });
    expect(senzaBlocchi.statusCode).toBe(400);
    expect(senzaBlocchi.json().errore).toContain('non produce contenuto');
    expect(stato.documentiCreati).toHaveLength(0);
  });

  it('upload PDF fallito → 500, nessun documento creato', async () => {
    stato.uploadFails = true;
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', contenutoHtml: '<p>X</p>' },
    });
    expect(ris.statusCode).toBe(500);
    expect(ris.json().errore).toContain('PDF');
    expect(stato.documentiCreati).toHaveLength(0);
  });

  it('upload Word fallito → il PDF esce comunque, fileDocxUrl null e audit DOCUMENTO_WORD_FALLITO', async () => {
    stato.uploadDocxFails = true;
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'POST',
      url: '/documenti/genera',
      payload: { progettoId: 'prog-1', contenutoHtml: TEMPLATE_HTML, titolo: 'Contratto di consulenza' },
    });

    expect(ris.statusCode).toBe(200);
    const creato = stato.documentiCreati.at(-1);
    expect(creato.fileUrl).toBe(creato.filePdfUrl);
    expect(creato.fileDocxUrl).toBeNull();
    expect(stato.upload.map((u) => u.filename)).toEqual(['contratto-di-consulenza.pdf']);
    expect(stato.audit.some((a) => a.azione === 'DOCUMENTO_WORD_FALLITO')).toBe(true);
    const generato = stato.audit.find((a) => a.azione === 'DOCUMENTO_GENERATO');
    expect(generato?.dettagli).toContain('(solo PDF)');
  });
});

// ---------------------------------------------------------------------------
// 3. GET /portal/documenti/:id/download
// ---------------------------------------------------------------------------

describe('GET /portal/documenti/:id/download — export per il cliente', () => {
  beforeEach(() => {
    stato.documentoPortale = {
      id: 'doc-9',
      fileUrl: 'https://storage.example/1756000000000_contratto-master.pdf',
      filePdfUrl: 'https://storage.example/1756000000000_contratto-master.pdf',
      fileDocxUrl: 'https://storage.example/1756000000000_contratto-copia.docx',
      statoScansione: 'pulito',
      versione: 2,
      microvoceProgetto: { nome: 'Microvoce Alfa' },
      progetto: { nome: 'Incarico consulenza 2026' },
    };
  });

  it('PDF: URL firmato, nome file senza prefisso timestamp, contentType corretto', async () => {
    const ris = await serverConToken(tokenCliente()).inject({
      method: 'GET',
      url: '/portal/documenti/doc-9/download',
    });

    expect(ris.statusCode).toBe(200);
    const corpo = ris.json();
    expect(corpo.formato).toBe('pdf');
    expect(corpo.contentType).toBe('application/pdf');
    expect(corpo.url).toContain('contratto-master.pdf');
    expect(corpo.filename).toBe('contratto-master.pdf');
  });

  it('Word: contentType OOXML e nome file dal fileDocxUrl', async () => {
    const ris = await serverConToken(tokenCliente()).inject({
      method: 'GET',
      url: '/portal/documenti/doc-9/download?formato=docx',
    });

    expect(ris.statusCode).toBe(200);
    const corpo = ris.json();
    expect(corpo.formato).toBe('docx');
    expect(corpo.contentType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(corpo.url).toContain('contratto-copia.docx');
    expect(corpo.filename).toBe('contratto-copia.docx');
  });

  it('documento storico senza filePdfUrl → il PDF ripiega sul file originale', async () => {
    stato.documentoPortale.filePdfUrl = null;
    stato.documentoPortale.fileUrl = 'https://storage.example/1756000000000_originale.pdf';

    const ris = await serverConToken(tokenCliente()).inject({
      method: 'GET',
      url: '/portal/documenti/doc-9/download',
    });

    expect(ris.statusCode).toBe(200);
    expect(ris.json().url).toContain('originale.pdf');
  });

  it('404 esplicito se il formato Word non esiste (documento storico)', async () => {
    stato.documentoPortale.fileDocxUrl = null;

    const ris = await serverConToken(tokenCliente()).inject({
      method: 'GET',
      url: '/portal/documenti/doc-9/download?formato=docx',
    });

    expect(ris.statusCode).toBe(404);
    expect(ris.json().errore).toBe('Formato Word non disponibile per questo documento.');
  });

  it('409 se la scansione di sicurezza non è «pulito»', async () => {
    stato.documentoPortale.statoScansione = 'in_corso';

    const ris = await serverConToken(tokenCliente()).inject({
      method: 'GET',
      url: '/portal/documenti/doc-9/download',
    });

    expect(ris.statusCode).toBe(409);
    expect(ris.json().errore).toContain('scansione');
  });

  it('404 se il documento non è nel fascicolo del cliente', async () => {
    stato.documentoPortale = null;

    const ris = await serverConToken(tokenCliente()).inject({
      method: 'GET',
      url: '/portal/documenti/doc-di-altri/download',
    });

    expect(ris.statusCode).toBe(404);
    expect(ris.json().errore).toContain('fascicolo del cliente');
  });

  it('400 se la sessione non identifica un cliente (operatore senza clienteId)', async () => {
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'GET',
      url: '/portal/documenti/doc-9/download',
    });
    expect(ris.statusCode).toBe(400);
    expect(ris.json().errore).toContain('Cliente non identificato');
  });

  it("l'operatore può scaricare per conto del cliente indicando il clienteId", async () => {
    const ris = await serverConToken(tokenAdvisor()).inject({
      method: 'GET',
      url: `/portal/documenti/doc-9/download?clienteId=${CLIENTE_ID}&formato=docx`,
    });
    expect(ris.statusCode).toBe(200);
    expect(ris.json().formato).toBe('docx');
  });
});
