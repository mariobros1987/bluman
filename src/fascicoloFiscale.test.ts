import { describe, it, expect, vi, beforeEach } from 'vitest';
import PizZip from 'pizzip';
import { generaFascicoloFiscaleZip } from './services/fascicoloFiscaleZipEngine.js';
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
          cliente: { nome: 'Cliente Alfa S.r.l.', piva: '11111111111' },
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
    expect(indiceContenuto).toContain('Codice Tributo F24 Suggerito:  6003');
    expect(indiceContenuto).toContain('TOTALE F24 DA VERSARE:         € 132.00');
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
});
