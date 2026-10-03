/**
 * §36 — La firma dentro il documento.
 *
 * Prima di §36 il documento firmato non conteneva la firma: il sigillo stava nella riga
 * `FirmaElettronica`, la grafometrica nel verbale allegato, e l'area firme del contratto
 * restava vuota. Qui si copre la catena completa:
 *
 * 1. il vocabolario: `{{firma_cliente}}` → marcatore → blocco `firma` con `slotColonne`;
 * 2. la resa: `generaPdfDocumento(blocchi, firme)` disegna la grafometrica nello slot giusto
 *    e stampa le righe di attestazione, mentre senza `firme` il PDF resta quello di prima;
 * 3. l'archiviazione: `generaCopiaFirmata` crea una riga NUOVA (`tipo='firmato'`,
 *    `documentoPadreId` → originale) e non tocca il file su cui è fissato l'hash del sigillo;
 * 4. i casi in cui la copia NON si fa e non deve sollevare: documento generato prima di §36,
 *    template senza segnaposto, upload dello storage fallito.
 *
 * Prisma e storage sono mockati come in `generazioneDocumenti.test.ts`: i byte del PDF
 * restano nel registro così i test possono leggere dentro il file davvero generato.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stato = {
  documento: null as any,
  /** Le firme già apposte sul documento, come le restituisce `firmaElettronica.findMany`. */
  firmeDb: [] as any[],
  upload: [] as { filename: string; buffer: Buffer }[],
  creati: [] as any[],
  uploadFails: false,
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    documento: {
      findFirst: async () => stato.documento,
      create: async (args: any) => {
        stato.creati.push(args.data);
        return { ...args.data, id: 'doc-firmato-1' };
      },
    },
    firmaElettronica: { findMany: async () => stato.firmeDb },
    auditLog: { create: async () => ({}) },
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

vi.mock('./services/storageService.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    uploadDocumento: async (filename: string, contentBase64: string) => {
      if (stato.uploadFails) throw new Error('storage non raggiungibile (simulato)');
      stato.upload.push({ filename, buffer: Buffer.from(contentBase64, 'base64') });
      return { ok: true, url: `https://storage.example/${filename}`, name: filename, size: '2 KB' };
    },
  };
});

const { generaCopiaFirmata, blocchiSalvati, haSlotFirma, righeAttestazione } = await import(
  './services/copiaFirmata.js'
);
const { contestoTagDocumento, risolviTagDocumento, blocchiDaHtml, generaPdfDocumento, paragrafiDocx } =
  await import('./services/generazioneDocumenti.js');
const { marcatoreSlot } = await import('./services/slotFirma.js');

/** pdfkit scrive il testo come stringhe esadecimali dentro gli array `TJ`. */
function testoPdf(pdf: Buffer): string {
  const grezzo = pdf.toString('latin1');
  const parti: string[] = [];
  for (const m of grezzo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    parti.push(Buffer.from(m[1] ?? '', 'hex').toString('latin1'));
  }
  return parti.join('');
}

/** 1x1 PNG valido in data URL: la grafometrica minima incorporabile. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Contesto di merge minimo: qui interessano i segnaposto di firma, non i dati anagrafici. */
function contesto() {
  return contestoTagDocumento({ tenant: null, cliente: null, progetto: null, dataOdierna: new Date(2026, 7, 29) });
}

/** Il template con le due aree firma, come lo scrive un operatore nel Document Studio. */
const HTML_CON_SLOT = [
  '<h1>LETTERA DI INCARICO</h1>',
  '<p>Il presente incarico è conferito allo Studio.</p>',
  '<div style="display:flex;justify-content:space-between">',
  '<div>Lo Studio<br/>{{firma_studio}}</div>',
  '<div>Il Cliente<br/>{{firma_cliente}}</div>',
  '</div>',
].join('');

function blocchiConSlot() {
  return blocchiDaHtml(risolviTagDocumento(HTML_CON_SLOT, contesto()));
}

function firmaFinta(overrides: Record<string, unknown> = {}) {
  return {
    signatureId: 'BLU-SES-20260829-ABCD',
    firmatarioNome: 'Luigi Bianchi',
    firmatoAt: new Date('2026-08-29T18:04:06.000Z'),
    valoreLegale: 'fea',
    firmaGrafometricaPng: PNG_1X1,
    ...overrides,
  };
}

beforeEach(() => {
  stato.documento = null;
  stato.firmeDb.length = 0;
  stato.upload.length = 0;
  stato.creati.length = 0;
  stato.uploadFails = false;
});

// ---------------------------------------------------------------------------
// 1. Il vocabolario del segnaposto
// ---------------------------------------------------------------------------

describe('{{firma_cliente}} — dal template allo slot', () => {
  it('traduce i due tag noti in marcatori e lascia letterale un {{firma_}} inventato', () => {
    const out = risolviTagDocumento('A {{firma_cliente}} B {{firma_studio}} C {{firma_notaio}}', contesto());
    expect(out).toContain(marcatoreSlot('cliente'));
    expect(out).toContain(marcatoreSlot('studio'));
    // Un tag non riconosciuto NON diventa un'area firma muta che nessuno riempirà.
    expect(out).toContain('{{firma_notaio}}');
  });

  it('marca le colonne di firma con lo slot e conserva l\'etichetta del template', () => {
    const blocchi = blocchiConSlot();
    const firma = blocchi.find(b => b.tipo === 'firma');
    expect(firma).toBeTruthy();
    expect(firma?.colonne).toEqual(['Lo Studio', 'Il Cliente']);
    expect(firma?.slotColonne).toEqual(['studio', 'cliente']);
    // Nessun marcatore resta nel testo: il segnaposto non arriva mai sotto gli occhi del cliente.
    expect(JSON.stringify(blocchi)).not.toContain('[[firma:');
  });

  it('trasforma in area firma anche un paragrafo che contiene il segnaposto', () => {
    const blocchi = blocchiDaHtml(risolviTagDocumento('<p>Il Cliente<br/>{{firma_cliente}}</p>', contesto()));
    expect(blocchi).toHaveLength(1);
    expect(blocchi[0]?.tipo).toBe('firma');
    expect(blocchi[0]?.colonne).toEqual(['Il Cliente']);
    expect(blocchi[0]?.slotColonne).toEqual(['cliente']);
  });

  it('tiene la colonna nel Word anche quando lo slot non ha etichetta', () => {
    const blocchi = blocchiDaHtml(
      risolviTagDocumento('<div style="display:flex"><div>{{firma_cliente}}</div></div>', contesto()),
    );
    const paragrafi = paragrafiDocx(blocchi);
    // La riga di firma sopravvive: la copia di cortesia mostra lo spazio da sottoscrivere.
    expect(paragrafi.filter(p => p.vFirma)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. La resa: la grafometrica dentro lo slot
// ---------------------------------------------------------------------------

describe('generaPdfDocumento — le firme negli slot', () => {
  it('senza `firme` produce lo stesso documento di prima di §36', async () => {
    const blocchi = blocchiConSlot();
    const pdf = await generaPdfDocumento(blocchi);
    const testo = testoPdf(pdf);
    expect(testo).toContain('LETTERA DI INCARICO');
    expect(testo).toContain('Il Cliente');
    expect(testo).not.toContain('Firmato elettronicamente da');
  });

  it('stampa le righe di attestazione sotto la firma del cliente', async () => {
    const blocchi = blocchiConSlot();
    const pdf = await generaPdfDocumento(blocchi, {
      cliente: { immaginePng: PNG_1X1, righe: ['Firmato elettronicamente da Luigi Bianchi', 'ID firma BLU-1'] },
    });
    const testo = testoPdf(pdf);
    expect(testo).toContain('Firmato elettronicamente da Luigi Bianchi');
    expect(testo).toContain('ID firma BLU-1');
  });

  it('non cade su una grafometrica corrotta: esce il documento con le attestazioni', async () => {
    const blocchi = blocchiConSlot();
    const pdf = await generaPdfDocumento(blocchi, {
      cliente: { immaginePng: 'data:image/png;base64,bWFsZm9ybWF0bw==', righe: ['ID firma BLU-2'] },
    });
    expect(testoPdf(pdf)).toContain('ID firma BLU-2');
  });
});

// ---------------------------------------------------------------------------
// 3. Le primitive del servizio
// ---------------------------------------------------------------------------

describe('blocchiSalvati / haSlotFirma / righeAttestazione', () => {
  it('accetta solo un array di blocchi con tipo noto', () => {
    expect(blocchiSalvati(blocchiConSlot())).toHaveLength(3);
    expect(blocchiSalvati(null)).toBeNull();
    expect(blocchiSalvati([])).toBeNull();
    expect(blocchiSalvati('non un array')).toBeNull();
    expect(blocchiSalvati([{ tipo: 'paragrafo', testo: 'ok' }, { tipo: 'sconosciuto' }])).toBeNull();
  });

  it('riconosce lo slot che aspetta il cliente', () => {
    const blocchi = blocchiConSlot();
    expect(haSlotFirma(blocchi, 'cliente')).toBe(true);
    expect(haSlotFirma(blocchi, 'studio')).toBe(true);
    expect(haSlotFirma([{ tipo: 'paragrafo', testo: 'niente firme' }], 'cliente')).toBe(false);
  });

  it('scrive il valore legale reale e la data in UTC, non nel fuso della macchina', () => {
    const righe = righeAttestazione({
      firmatarioNome: 'Luigi Bianchi',
      valoreLegale: 'fea',
      signatureId: 'BLU-1',
      firmatoAt: new Date('2026-08-29T18:04:06.000Z'),
      sigilloDigest: 'c'.repeat(64),
    });
    expect(righe[0]).toBe('Firmato elettronicamente da Luigi Bianchi');
    expect(righe[1]).toBe('Firma Elettronica Avanzata · 2026-08-29 18:04:06 UTC');
    expect(righe[2]).toBe('ID firma BLU-1');
    expect(righe[3]).toContain('c'.repeat(64));
    // Il valore legale non si gonfia: senza indicazione è firma semplice.
    const senzaValore = righeAttestazione({
      firmatarioNome: 'Anna Verdi',
      signatureId: 'BLU-2',
      firmatoAt: new Date('2026-01-02T03:04:05.000Z'),
      sigilloDigest: 'd'.repeat(64),
    });
    expect(senzaValore[1]).toContain('Firma Elettronica Semplice');
  });

  // §8.1 — per le firme anteriori al 03/10/2026 il sigillo non era persistito: la riga lo dice
  // invece di stampare l'impronta di un'altra firma (che è ciò che faceva `|| sigilloDigest`).
  it('dichiara «non registrato» il sigillo di una firma precedente alla persistenza', () => {
    const righe = righeAttestazione({
      firmatarioNome: 'Luigi Bianchi',
      signatureId: 'BLU-3',
      firmatoAt: new Date('2026-01-02T03:04:05.000Z'),
      sigilloDigest: null,
    });
    expect(righe[3]).toBe('Sigillo SHA-256 non registrato');
  });
});

// ---------------------------------------------------------------------------
// 4. L'archiviazione della copia firmata
// ---------------------------------------------------------------------------

describe('generaCopiaFirmata', () => {
  function originaleConBlocchi(extra: Record<string, unknown> = {}) {
    return {
      id: 'doc-orig-1',
      tipo: 'compilato',
      fileUrl: 'https://storage.example/1756500000000_lettera-di-incarico.pdf',
      progettoId: 'prog-1',
      microvoceProgettoId: 'mv-9',
      categoriaDoc: 'contratto',
      livelloFirmaRichiesto: 'fea',
      // Come Prisma lo restituisce: JSON già deserializzato.
      contenutoBlocchiJson: JSON.parse(JSON.stringify(blocchiConSlot())),
      ...extra,
    };
  }

  it('archivia una riga nuova senza toccare l\'originale', async () => {
    stato.documento = originaleConBlocchi();
    const esito = await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta(),
      sigilloDigest: 'e'.repeat(64),
    });

    expect(esito).toBeTruthy();
    expect(esito?.documentoId).toBe('doc-firmato-1');
    expect(esito?.nome).toBe('lettera-di-incarico-firmato.pdf');

    // Una sola riga creata, e nessun update sull'originale: il file certificato è intatto.
    expect(stato.creati).toHaveLength(1);
    const copia = stato.creati[0];
    expect(copia.tipo).toBe('firmato');
    expect(copia.documentoPadreId).toBe('doc-orig-1');
    expect(copia.fileUrl).toBe(copia.filePdfUrl);
    expect(copia.fileUrl).not.toBe(stato.documento.fileUrl);
    // Nel fascicolo del documento originale, visibile subito, e senza caricatore umano:
    // il firmatario cliente non è una riga `user`.
    expect(copia.progettoId).toBe('prog-1');
    expect(copia.microvoceProgettoId).toBe('mv-9');
    expect(copia.statoDoc).toBe('firmato');
    expect(copia.pubblicatoAt).toBeInstanceOf(Date);
    expect(copia.caricatoDa).toBeNull();
    expect(copia.statoScansione).toBe('pulito');
  });

  it('mette dentro il PDF il nome del firmatario, l\'ID firma e l\'impronta del sigillo', async () => {
    stato.documento = originaleConBlocchi();
    await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta(),
      sigilloDigest: 'e'.repeat(64),
    });
    expect(stato.upload).toHaveLength(1);
    const testo = testoPdf(stato.upload[0]!.buffer);
    expect(testo).toContain('LETTERA DI INCARICO');
    expect(testo).toContain('Firmato elettronicamente da Luigi Bianchi');
    expect(testo).toContain('BLU-SES-20260829-ABCD');
    expect(testo).toContain('e'.repeat(64));
    // L'etichetta del template resta al suo posto accanto alla firma.
    expect(testo).toContain('Il Cliente');
  });

  it('non produce nulla per un documento generato prima di §36', async () => {
    stato.documento = originaleConBlocchi({ contenutoBlocchiJson: null });
    const esito = await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta(),
      sigilloDigest: 'e'.repeat(64),
    });
    expect(esito).toBeNull();
    expect(stato.creati).toHaveLength(0);
    expect(stato.upload).toHaveLength(0);
  });

  it('non produce nulla se il template non prevede l\'area firma del cliente', async () => {
    stato.documento = originaleConBlocchi({
      contenutoBlocchiJson: [{ tipo: 'paragrafo', testo: 'Nessuna area firma qui.' }],
    });
    const esito = await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta(),
      sigilloDigest: 'e'.repeat(64),
    });
    expect(esito).toBeNull();
    expect(stato.creati).toHaveLength(0);
  });

  it('non firma una copia firmata né un documento di un altro tenant', async () => {
    stato.documento = originaleConBlocchi({ tipo: 'firmato' });
    expect(
      await generaCopiaFirmata({
        tenantId: TENANT,
        documentoId: 'doc-orig-1',
        firma: firmaFinta(),
        sigilloDigest: 'e'.repeat(64),
      }),
    ).toBeNull();

    // La query porta il tenant: fuori dal tenant il documento non esiste.
    stato.documento = null;
    expect(
      await generaCopiaFirmata({
        tenantId: 'altro-tenant',
        documentoId: 'doc-orig-1',
        firma: firmaFinta(),
        sigilloDigest: 'e'.repeat(64),
      }),
    ).toBeNull();
    expect(stato.creati).toHaveLength(0);
  });

  it('se lo storage cade la firma resta valida: ritorna null e non solleva', async () => {
    stato.documento = originaleConBlocchi();
    stato.uploadFails = true;
    const esito = await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta(),
      sigilloDigest: 'e'.repeat(64),
    });
    expect(esito).toBeNull();
    expect(stato.creati).toHaveLength(0);
  });

  it('esce anche senza grafometrica: restano le righe di attestazione', async () => {
    stato.documento = originaleConBlocchi();
    const esito = await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta({ firmaGrafometricaPng: null }),
      sigilloDigest: 'e'.repeat(64),
    });
    expect(esito).toBeTruthy();
    expect(testoPdf(stato.upload[0]!.buffer)).toContain('Firmato elettronicamente da Luigi Bianchi');
  });

  it('appone la firma dello studio nello slot studio quando richiesto', async () => {
    stato.documento = originaleConBlocchi();
    const esito = await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta({ firmatarioNome: 'Avv. Mario Rossi (Studio BluMan)' }),
      sigilloDigest: 's'.repeat(64),
      slot: 'studio',
      userId: 'usr-advisor-1',
    });

    expect(esito).toBeTruthy();
    expect(stato.creati).toHaveLength(1);
    const copia = stato.creati[0];
    expect(copia.tipo).toBe('firmato');
    expect(copia.caricatoDa).toBe('usr-advisor-1');
    const testo = testoPdf(stato.upload[0]!.buffer);
    expect(testo).toContain('Avv. Mario Rossi (Studio BluMan)');
  });

  // §8.1 — la firma della controparte si ricompone con il SUO sigillo, riletto dalla riga
  // `FirmaElettronica`, non con quello dell'evento che sta ricomponendo il PDF. Prima il campo
  // non esisteva nello schema: la lettura dava `undefined` e il ripiego stampava sotto il nome
  // della prima parte l'impronta della seconda — un'attestazione falsa su un documento che fa fede.
  it('stampa il sigillo della prima firma, non quello dell\'evento che la ricompone', async () => {
    stato.documento = originaleConBlocchi();
    stato.firmeDb = [
      {
        parte: 'cliente',
        signatureId: 'BLU-SES-CLIENTE-1',
        firmatarioNome: 'Luigi Bianchi',
        firmatarioRuolo: null,
        valoreLegale: 'ses',
        standard: 'eIDAS / SES (CAD art. 20)',
        firmatoAt: new Date('2026-08-29T18:04:06.000Z'),
        firmaGrafometricaPng: PNG_1X1,
        sigilloDigest: 'a'.repeat(64),
      },
    ];

    await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta({ firmatarioNome: 'Avv. Mario Rossi', firmaGrafometricaPng: null }),
      sigilloDigest: 's'.repeat(64),
      slot: 'studio',
      userId: 'usr-advisor-1',
    });

    const testo = testoPdf(stato.upload[0]!.buffer);
    // La riga della prima parte porta il sigillo della PRIMA firma...
    expect(testo).toContain('Firmato elettronicamente da Luigi Bianchi');
    expect(testo).toContain('a'.repeat(64));
    // ...e quella dello studio il proprio: due sigilli distinti nello stesso PDF.
    expect(testo).toContain('Firmato elettronicamente da Avv. Mario Rossi');
    expect(testo).toContain('s'.repeat(64));
  });

  // §8.1 — la parte si legge dal dato. La firma dello studio via file scrive il MECCANISMO in
  // `tipoFirma` ('qualificata_esterna') e un canale che non contiene la parola «Studio»: la
  // deduzione dalla stringa la classificava come firma del cliente, e la cronologia sul PDF
  // finale diceva «Cliente» sotto il nome del professionista.
  it('riconosce come studio la firma via file nella cronologia, senza annusare la stringa', async () => {
    stato.documento = originaleConBlocchi();
    stato.firmeDb = [
      {
        parte: 'studio',
        signatureId: 'BLU-STD-FILE-1',
        firmatarioNome: 'Avv. Mario Rossi',
        firmatarioRuolo: 'Senior Tax Advisor',
        valoreLegale: 'feq',
        standard: 'eIDAS / FEQ (CAdES/PAdES)',
        firmatoAt: new Date('2026-08-29T09:00:00.000Z'),
        firmaGrafometricaPng: null,
        sigilloDigest: 'f'.repeat(64),
      },
    ];

    await generaCopiaFirmata({
      tenantId: TENANT,
      documentoId: 'doc-orig-1',
      firma: firmaFinta(),
      sigilloDigest: 'e'.repeat(64),
      slot: 'cliente',
    });

    const testo = testoPdf(stato.upload[0]!.buffer);
    expect(testo).toContain('CRONOLOGIA DELLE FIRME');
    // Il ruolo dichiarato dallo studio compare solo se la riga è letta come firma dello studio:
    // con la deduzione dalla stringa sarebbe stato «Cliente», e questo testo non esisterebbe.
    expect(testo).toContain('Senior Tax Advisor');
  });
});
