// §7 — il confine della rotta SDI: quando l'anagrafica dello studio è incompleta la rotta
// **rifiuta** invece di comporre un `CedentePrestatore` inventato. Questa è la prova che il
// rifiuto arriva prima del generatore, e che il messaggio nomina i campi: senza, il difetto
// tornerebbe silenziosamente il giorno in cui qualcuno tocca `sdiXmlGenerator`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from './util/prismaClient.js';
import { buildServer } from './server.js';
import { signJwt } from './util/jwt.js';

vi.mock('./util/prismaClient.js', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.id === 'admin-1'
          ? { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : null,
      ),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'tenant-sdi-test',
        ragioneSociale: 'Studio Fiscale & Advisory Demo',
        piva: '01234567890',
        codiceFiscale: '01234567890',
        sedeLegale: 'Via dei Tribunali 12, 80138 Napoli NA',
        regimeFiscale: 'RF01',
        iban: 'IT60X0542811101000000123456',
      }),
    },
    fattura: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'ft-1',
        tenantId: 'tenant-sdi-test',
        numero: 'FT-0001',
        serie: 'FT',
        numeroProgressivoSerie: 1,
        tipoDocumento: 'fattura',
        data: new Date('2026-03-15'),
        totaleImponibileCentesimi: 100000,
        totaleIvaCentesimi: 22000,
        totaleDocumentoCentesimi: 122000,
        stato: 'emessa',
        cliente: { nome: 'Cliente Alfa & Beta S.r.l.', piva: '11111111111', sedeLegale: 'Via Verdi 3' },
        righe: [],
        progetto: null,
        contoAccredito: null,
        fatturaOrigine: null,
      }),
    },
  },
  // L'hook `onRequest` la chiama a ogni richiesta autenticata: senza questa riga il modulo è
  // mockato a metà, la chiamata esplode dentro il `try` dell'hook e la risposta diventa un 401
  // indistinguibile da un token scaduto — cioè il test misurerebbe l'autenticazione invece
  // dell'anagrafica.
  attivaContestoTenant: vi.fn(),
}));

/** Il token di uno `studio` che ha il diritto di emettere: è il caso normale. */
const tokenAdvisor = () =>
  signJwt({
    userId: 'admin-1',
    tenantId: 'tenant-sdi-test',
    ruolo: 'advisor',
    email: 'advisor@studio.it',
    sessionVersion: 0,
  });

async function scaricaXml(token: string) {
  const server = buildServer({} as any);
  await server.ready();
  return server.inject({
    method: 'GET',
    url: '/invoices/ft-1/sdi-xml',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET /invoices/:id/sdi-xml — l’anagrafica dello studio decide se il documento esiste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("con l'anagrafica incompleta risponde 409 e nomina i campi mancanti", async () => {
    // Manca il codice fiscale, la sede legale, il regime fiscale e l'IBAN: prima il generatore
    // li riempiva da solo (`'00000000000'`, `'Via Roma 1'`, `'RF01'`) e la risposta era un XML
    // con 200 OK — un documento fiscale che non era la fattura di nessuno.
    (prisma.tenant.findUnique as any).mockResolvedValueOnce({
      id: 'tenant-sdi-test',
      ragioneSociale: 'Studio Fiscale & Advisory Demo',
      piva: '01234567890',
    });

    const res = await scaricaXml(tokenAdvisor());

    expect(res.statusCode).toBe(409);
    const body = res.json() as any;
    expect(body.errore).toContain('Codice Fiscale Societario');
    expect(body.errore).toContain('Indirizzo Sede Legale');
    expect(body.errore).toContain('Regime Fiscale');
    expect(body.errore).toContain('IBAN per Accredito Fatture');
    // Il rifiuto dice **dove** si compilano, altrimenti è un vicolo cieco.
    expect(body.errore).toContain('Impostazioni');
    // I campi valorizzati non vengono nominati: l'elenco è dei mancanti, non dei sei.
    expect(body.errore).not.toContain('Partita IVA / VAT Number');
    expect(body.mancanti.map((c: any) => c.chiave)).toEqual([
      'codiceFiscale', 'sedeLegale', 'regimeFiscale', 'iban',
    ]);
    // E soprattutto: nessun XML. È il punto del 409 — un documento fiscale o è giusto o non esce.
    expect(res.headers['content-type']).not.toContain('xml');
    expect(res.body).not.toContain('CedentePrestatore');
  });

  it("con l'anagrafica completa produce l'XML con i dati veri dello studio, non con i ripieghi", async () => {
    const res = await scaricaXml(tokenAdvisor());

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/xml');
    const xml = res.body;

    expect(xml).toContain('<IdCodice>01234567890</IdCodice>');
    expect(xml).toContain('Studio Fiscale &amp; Advisory Demo');
    expect(xml).toContain('<RegimeFiscale>RF01</RegimeFiscale>');
    // I letterali inventati non compaiono più: erano la ragione d'essere del guard.
    expect(xml).not.toContain('00000000000');
    expect(xml).not.toContain('Studio Advisory');
    // L'escape delle entità regge (il cliente si chiama «Alfa & Beta»): un XML non valido
    // verrebbe scartato da SdI, che è l'altro modo di non produrre un documento.
    expect(xml).toContain('Cliente Alfa &amp; Beta S.r.l.');
  });

  it('una riga `tenant` che non si è potuta leggere non autorizza a inventare', async () => {
    // `findUnique` che restituisce `null` significa «non ho potuto guardare», non «va tutto
    // bene»: la rotta rifiuta. È il verso dell'errore che conta.
    (prisma.tenant.findUnique as any).mockResolvedValueOnce(null);

    const res = await scaricaXml(tokenAdvisor());

    expect(res.statusCode).toBe(409);
    expect((res.json() as any).mancanti).toHaveLength(6);
  });
});
