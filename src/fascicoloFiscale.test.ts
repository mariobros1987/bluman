import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import PizZip from 'pizzip';
import {
  calcolaAnteprimaFascicoloFiscale,
  generaFascicoloFiscaleZip,
} from './services/fascicoloFiscaleZipEngine.js';
import { prisma } from './util/prismaClient.js';
import { buildServer } from './server.js';
import { signJwt } from './util/jwt.js';

// Mock di Prisma e CalcolaLiquidazioneIvaPeriodo
vi.mock('./util/prismaClient.js', () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'tenant-commercialista-test',
        ragioneSociale: 'Studio Fiscale & Advisory Demo',
        piva: '01234567890',
        codiceFiscale: '01234567890',
      }),
    },
    fattura: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'ft-1',
          tenantId: 'tenant-commercialista-test',
          serie: 'FT',
          numeroProgressivoSerie: 1,
          tipoDocumento: 'fattura',
          data: new Date('2026-03-15'),
          totaleImponibileCentesimi: 100000,
          totaleIvaCentesimi: 22000,
          totaleDocumentoCentesimi: 122000,
          stato: 'emessa',
          // Il nome contiene una `&` di proposito: l'XML scritto a mano non la escapava e
          // produceva un file non valido per SdI.
          cliente: { nome: 'Cliente Alfa & Beta S.r.l.', piva: '11111111111' },
          righe: [],
        },
      ]),
    },
    fatturaRicevuta: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'fp-1',
          tenantId: 'tenant-commercialista-test',
          numero: 'FAT-99',
          data: new Date('2026-03-20'),
          imponibileCentesimi: 40000,
          ivaCentesimi: 8800,
          totaleCentesimi: 48800,
          esigibilitaIva: 'immediata',
          pagata: true,
          fornitore: { ragioneSociale: 'Forniture Ufficio Spa', partitaIva: '22222222222' },
          xmlSdiRaw: '<xml>passiva</xml>',
        },
      ]),
    },
    movimentoPrimaNota: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'mov-1',
          tenantId: 'tenant-commercialista-test',
          tipo: 'entrata',
          data: new Date('2026-03-18'),
          importoCentesimi: 122000,
          descrizione: 'Incasso FT 1',
          metodoPagamento: 'bonifico',
          contoBancario: { nomeConto: 'Conto Corrente Principale' },
          fattura: { serie: 'FT', numeroProgressivoSerie: 1 },
        },
      ]),
    },
  },
  prismaAmministrativo: () => ({}),
  attivaContestoTenant: vi.fn(),
}));

describe('📦 Motore Fascicolo Fiscale ZIP per Commercialista', () => {
  /** Il modulo è mockato: questi sono i `vi.fn()` dichiarati sopra, non i client Prisma. */
  const findManyFatture = prisma.fattura.findMany as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('genera un archivio ZIP valido con la corretta alberatura e indice', async () => {
    const res = await generaFascicoloFiscaleZip({
      tenantId: 'tenant-commercialista-test',
      anno: 2026,
      tipo: 'mensile',
      mese: 3,
    });

    expect(res.buffer).toBeInstanceOf(Buffer);
    expect(res.nomeFile).toContain('Fascicolo_Fiscale_Studio_Fiscale___Advisory_Demo_Mese_03_2026.zip');
    expect(res.conteggioFattureAttive).toBe(1);
    expect(res.conteggioFatturePassive).toBe(1);
    expect(res.conteggioMovimentiPrimaNota).toBe(1);
    expect(res.conteggioXmlAttiviGenerati).toBe(1);
    expect(res.conteggioBozzeEscluseDaXml).toBe(0);
    expect(res.conteggioXmlPassiviAllegati).toBe(1);
    expect(res.totaleImponibileVenditeEuro).toBe(1000);
    expect(res.totaleIvaVenditeEuro).toBe(220);
    expect(res.totaleImponibileAcquistiEuro).toBe(400);
    expect(res.totaleIvaAcquistiEuro).toBe(88);
    expect(res.saldoIvaEuro).toBe(132);

    // Decomprimi lo ZIP per verificare l'alberatura
    const zip = new PizZip(res.buffer);
    const files = Object.keys(zip.files);

    expect(files).toContain('00_INDICE_FASCICOLO_FISCALE.txt');
    expect(files).toContain('01_Fatture_Attive_Vendite/Registro_Fatture_Vendite.csv');
    expect(files).toContain('01_Fatture_Attive_Vendite/Fattura_FT_0001.xml');
    expect(files).toContain('02_Fatture_Passive_Acquisti/Registro_Fatture_Acquisti.csv');
    expect(files).toContain('02_Fatture_Passive_Acquisti/Acquisto_FAT-99_Forniture_Ufficio_Sp.xml');
    expect(files).toContain('03_Liquidazione_IVA_LIPE/Prospetto_LIPE_F24_Mese_03_2026.csv');
    expect(files).toContain('03_Liquidazione_IVA_LIPE/Prospetto_LIPE_F24_Mese_03_2026.txt');
    expect(files).toContain('04_Prima_Nota_Cassa_Banca/Prima_Nota_Mese_03_2026.csv');

    // Verifica contenuto indice
    const indiceContenuto = zip.file('00_INDICE_FASCICOLO_FISCALE.txt')?.asText();
    expect(indiceContenuto).toContain('Studio Fiscale & Advisory Demo');
    expect(indiceContenuto).toContain('01234567890');
    expect(indiceContenuto).toContain('Codice tributo F24:  6003');
    expect(indiceContenuto).toContain('Da versare in F24:   € 132.00');
    // L'indice dichiara quanti XML ci sono davvero, non quanti dovrebbero essercene.
    expect(indiceContenuto).toContain('1 file XML in formato FatturaPA 1.2');
    expect(indiceContenuto).toContain('1 XML originali del fornitore allegati');
    expect(indiceContenuto).toContain('Nessun documento in bozza nel periodo.');

    // L'XML del ciclo attivo passa dal generatore vero: entità XML escapate (il cliente si
    // chiama «Alfa & Beta»), TipoDocumento dal documento e aliquota dedotta, non 22 fissa.
    const xmlAttiva = zip.file('01_Fatture_Attive_Vendite/Fattura_FT_0001.xml')?.asText() || '';
    expect(xmlAttiva).toContain('<TipoDocumento>TD01</TipoDocumento>');
    expect(xmlAttiva).toContain('Cliente Alfa &amp; Beta S.r.l.');
    expect(xmlAttiva).not.toContain('Cliente Alfa & Beta');

    // Il CSV è separato da punto e virgola su OGNI riga, compresa quella del codice tributo.
    const csvLipe = zip.file('03_Liquidazione_IVA_LIPE/Prospetto_LIPE_F24_Mese_03_2026.csv')?.asText() || '';
    expect(csvLipe).toContain('F24_CODICE_TRIBUTO;Codice tributo Modello F24;6003');
  });

  it('tiene le bozze nel registro CSV ma non fra gli XML delle fatture emesse', async () => {
    findManyFatture.mockResolvedValueOnce([
      {
        id: 'ft-1',
        serie: 'FT',
        numeroProgressivoSerie: 1,
        tipoDocumento: 'fattura',
        data: new Date('2026-03-15'),
        totaleImponibileCentesimi: 100000,
        totaleIvaCentesimi: 22000,
        totaleDocumentoCentesimi: 122000,
        stato: 'emessa',
        cliente: { nome: 'Cliente Emesso', piva: '11111111111' },
        righe: [],
      },
      {
        id: 'ft-2',
        serie: 'FT',
        numeroProgressivoSerie: 2,
        tipoDocumento: 'fattura',
        data: new Date('2026-03-16'),
        totaleImponibileCentesimi: 50000,
        totaleIvaCentesimi: 11000,
        totaleDocumentoCentesimi: 61000,
        stato: 'bozza',
        cliente: { nome: 'Cliente In Bozza', piva: '33333333333' },
        righe: [],
      },
    ]);

    const res = await generaFascicoloFiscaleZip({
      tenantId: 'tenant-commercialista-test',
      anno: 2026,
      tipo: 'mensile',
      mese: 3,
    });

    expect(res.conteggioFattureAttive).toBe(2);
    expect(res.conteggioXmlAttiviGenerati).toBe(1);
    expect(res.conteggioBozzeEscluseDaXml).toBe(1);

    const zip = new PizZip(res.buffer);
    const files = Object.keys(zip.files);
    expect(files).toContain('01_Fatture_Attive_Vendite/Fattura_FT_0001.xml');
    // Una bozza non ha numerazione definitiva né trasmissione: non è un documento fiscale.
    expect(files).not.toContain('01_Fatture_Attive_Vendite/Fattura_FT_0002.xml');

    const registro = zip.file('01_Fatture_Attive_Vendite/Registro_Fatture_Vendite.csv')?.asText() || '';
    expect(registro).toContain('Cliente In Bozza');
    expect(registro).toContain(';bozza');

    const indice = zip.file('00_INDICE_FASCICOLO_FISCALE.txt')?.asText() || '';
    expect(indice).toContain('1 documento/i in stato «bozza»');
  });

  it('risponde correttamente via API Fastify con token JWT autenticato', async () => {
    const mockApp = {} as any;
    const server = buildServer(mockApp);
    await server.ready();

    const token = signJwt({
      userId: 'admin-1',
      tenantId: 'tenant-commercialista-test',
      ruolo: 'advisor',
      email: 'advisor@studio.it',
    });

    const response = await server.inject({
      method: 'GET',
      url: '/contabilita/export-fascicolo-commercialista?anno=2026&tipo=mensile&mese=3',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toContain('Fascicolo_Fiscale_');
    expect(response.rawPayload.length).toBeGreaterThan(100);
  });

  it("l'anteprima restituisce i conteggi senza costruire l'archivio", async () => {
    const anteprima = await calcolaAnteprimaFascicoloFiscale({
      tenantId: 'tenant-commercialista-test',
      anno: 2026,
      tipo: 'mensile',
      mese: 3,
    });

    expect(anteprima).not.toHaveProperty('buffer');
    expect(anteprima.nomeFile).toContain('Mese_03_2026.zip');
    expect(anteprima.conteggioFattureAttive).toBe(1);
    expect(anteprima.conteggioXmlAttiviGenerati).toBe(1);
    expect(anteprima.conteggioXmlPassiviAllegati).toBe(1);
    expect(anteprima.saldoIvaEuro).toBe(132);
  });

  it('nega il fascicolo al ruolo cliente su download e anteprima', async () => {
    const server = buildServer({} as any);
    await server.ready();

    const tokenCliente = signJwt({
      userId: 'cli-1',
      tenantId: 'tenant-commercialista-test',
      ruolo: 'cliente',
      email: 'cliente@esterno.it',
    });

    for (const rotta of [
      '/contabilita/export-fascicolo-commercialista?anno=2026&tipo=mensile&mese=3',
      '/contabilita/anteprima-fascicolo-commercialista?anno=2026&tipo=mensile&mese=3',
    ]) {
      const res = await server.inject({
        method: 'GET',
        url: rotta,
        headers: { authorization: `Bearer ${tokenCliente}` },
      });
      // Il fascicolo contiene i registri IVA e la prima nota dello studio: dentro ci sono
      // i dati di tutti gli altri clienti.
      expect(res.statusCode).toBe(403);
    }
  });

  it('rifiuta con 400 i parametri di periodo non numerici invece di andare in errore 500', async () => {
    const server = buildServer({} as any);
    await server.ready();

    const token = signJwt({
      userId: 'admin-1',
      tenantId: 'tenant-commercialista-test',
      ruolo: 'advisor',
      email: 'advisor@studio.it',
    });

    for (const query of ['anno=pippo', 'anno=2026&tipo=mensile&mese=13', 'anno=2026&tipo=inventato']) {
      const res = await server.inject({
        method: 'GET',
        url: `/contabilita/export-fascicolo-commercialista?${query}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
