/**
 * Test unitari per `registraIngressoSenzaFascicolo`.
 *
 * Tre proprietà da presidiare:
 * 1. **Idempotenza sul replay**: un secondo invio dello stesso eventId deve silenziosamente
 *    non produrre un secondo avviso (P2002 → return early).
 * 2. **Troncamento del testo**: il corpo dell'avviso non riporta più di 500 caratteri del testo
 *    ricevuto, per non intasare la campanella.
 * 3. **Motivo che nomina i progetti**: l'operatore deve sapere *perché* il messaggio non è
 *    entrato e *come* sbloccarlo — il motivo elenca i nomi dei progetti aperti.
 * 4. **Destinazione del clic** (voce 6, 09/10/2026): il link porta all'anagrafica del cliente o
 *    alla pratica, e resta `null` quando il mittente non è stato identificato.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock di prisma ────────────────────────────────────────────────────────────
// Il modulo usa `prisma` da `../util/prismaClient`; lo mochiamo in-memory.
const mockCreate = vi.fn();
const mockDeleteMany = vi.fn();
const mockNotificaStudio = vi.fn();

vi.mock('../util/prismaClient', () => ({
  prisma: {
    webhookInbox: { create: mockCreate, deleteMany: mockDeleteMany },
  },
}));

vi.mock('./notificheService', () => ({
  notificaStudio: mockNotificaStudio,
}));

// Importiamo DOPO aver installato i mock (vi.mock è hoistato, ma l'import deve venire dopo)
const { registraIngressoSenzaFascicolo } = await import('./ingressoSenzaFascicolo.js');

// ─────────────────────────────────────────────────────────────────────────────

const TENANT = 'tenant-test-01';
const CANALE = 'telegram';

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({});        // default: creazione riuscita
  mockDeleteMany.mockResolvedValue({ count: 1 });
  mockNotificaStudio.mockResolvedValue({}); // default: notifica riuscita
});

describe('registraIngressoSenzaFascicolo', () => {
  // ─── 1. Idempotenza ────────────────────────────────────────────────────────
  describe('idempotenza sul replay', () => {
    it('se la riga webhook_inbox esiste già (P2002), non avvisa lo studio una seconda volta', async () => {
      // Simula la violazione del vincolo unico: l'eventId è già in tabella
      const errP2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      mockCreate.mockRejectedValueOnce(errP2002);

      await registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-42', {
        mittente: 'Mario Rossi',
        testo: 'Ciao, come procede?',
        motivo: 'Ha 2 progetti aperti.',
      });

      // La notifica NON deve essere stata invocata
      expect(mockNotificaStudio).not.toHaveBeenCalled();
    });

    it("se la creazione webhook_inbox fallisce per un altro motivo, rilancia l'errore", async () => {
      const errGenerico = new Error('DB offline');
      mockCreate.mockRejectedValueOnce(errGenerico);

      await expect(
        registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-43', {
          mittente: 'Mario Rossi',
          testo: 'Messaggio qualunque',
          motivo: 'Nessun progetto aperto.',
        }),
      ).rejects.toThrow('DB offline');

      expect(mockNotificaStudio).not.toHaveBeenCalled();
    });
  });

  // ─── 2. Troncamento ───────────────────────────────────────────────────────
  describe('troncamento del testo a 500 caratteri', () => {
    it('tronca a 500 caratteri un testo lungo', async () => {
      const testoLungo = 'A'.repeat(600);

      await registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-100', {
        mittente: 'Cliente Verboso',
        testo: testoLungo,
        motivo: 'Nessun progetto aperto.',
      });

      const chiamata = mockNotificaStudio.mock.calls[0];
      expect(chiamata).toBeDefined();
      const corpo: string = chiamata![1].corpo;

      // Il testo troncato deve apparire nel corpo, ma non superare 500 caratteri
      expect(corpo).toContain('A'.repeat(500));
      expect(corpo).not.toContain('A'.repeat(501));
    });

    it('un testo breve non viene troncato', async () => {
      const testoBreve = 'Ciao!';

      await registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-101', {
        mittente: 'Cliente Breve',
        testo: testoBreve,
        motivo: 'Ha 1 progetto aperto.',
      });

      const chiamata = mockNotificaStudio.mock.calls[0];
      expect(chiamata).toBeDefined();
      const corpo: string = chiamata![1].corpo;
      expect(corpo).toContain('Ciao!');
    });
  });

  // ─── 3. Motivo che nomina i progetti ──────────────────────────────────────
  describe('il motivo che nomina i progetti appare nella notifica', () => {
    it('riporta il motivo passato nel corpo della notifica', async () => {
      const motivo = 'Ha 2 progetti aperti (Emirati Arabi 123, Ciaociao): chiudi quelli conclusi.';

      await registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-200', {
        mittente: 'Mario Emirati',
        testo: 'Salve',
        motivo,
      });

      const chiamata = mockNotificaStudio.mock.calls[0];
      expect(chiamata).toBeDefined();
      const corpo: string = chiamata![1].corpo;

      // Il corpo deve contenere i nomi dei progetti
      expect(corpo).toContain('Emirati Arabi 123');
      expect(corpo).toContain('Ciaociao');
      // E il mittente
      expect(corpo).toContain('Mario Emirati');
    });

    it("l'oggetto della notifica nomina il mittente e il canale", async () => {
      await registraIngressoSenzaFascicolo(TENANT, 'whatsapp', 'update-201', {
        mittente: 'Anna Verdi',
        testo: 'Ok',
        motivo: 'Nessun progetto aperto.',
      });

      const chiamata = mockNotificaStudio.mock.calls[0];
      expect(chiamata).toBeDefined();
      const oggetto: string = chiamata![1].oggetto;

      expect(oggetto).toContain('Whatsapp'); // nome con prima maiuscola
      expect(oggetto).toContain('Anna Verdi');
    });

    it("l'evento è sempre messaggio_non_instradabile", async () => {
      await registraIngressoSenzaFascicolo(TENANT, 'signal', 'update-202', {
        mittente: 'Luca Neri',
        testo: 'Prova',
        motivo: 'Ha 3 progetti aperti.',
      });

      const chiamata = mockNotificaStudio.mock.calls[0];
      expect(chiamata).toBeDefined();
      const tipoEvento: string = chiamata![1].tipoEvento;
      expect(tipoEvento).toBe('messaggio_non_instradabile');
    });
  });

  // ─── 5. Avviso fallito: la riga di idempotenza non deve restare orfana ────
  describe("se l'avviso allo studio fallisce", () => {
    it("rimuove la riga di idempotenza e rilancia, così il rinvio del provider può riprovare", async () => {
      mockNotificaStudio.mockRejectedValueOnce(new Error('campanella non raggiungibile'));

      await expect(
        registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-400', {
          mittente: 'Mario Rossi',
          testo: 'Messaggio qualunque',
          motivo: 'Ha 2 progetti aperti.',
        }),
      ).rejects.toThrow('campanella non raggiungibile');

      // La riga scritta prima dell'avviso dev'essere tolta: se restasse, il rinvio dello
      // stesso update troverebbe P2002 e uscirebbe in silenzio, senza avvisare mai.
      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, provider: `${CANALE}_update`, eventId: 'update-400' },
      });
    });

    it("se anche la rimozione fallisce, l'errore originale dell'avviso resta quello che emerge", async () => {
      mockNotificaStudio.mockRejectedValueOnce(new Error('errore originale'));
      mockDeleteMany.mockRejectedValueOnce(new Error('DB caduto'));

      await expect(
        registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-401', {
          mittente: 'Mario Rossi',
          testo: 'Messaggio qualunque',
          motivo: 'Ha 2 progetti aperti.',
        }),
      ).rejects.toThrow('errore originale');
    });

    it("un avviso riuscito non tocca la riga di idempotenza", async () => {
      await registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-402', {
        mittente: 'Mario Rossi',
        testo: 'Messaggio qualunque',
        motivo: 'Ha 2 progetti aperti.',
      });

      expect(mockDeleteMany).not.toHaveBeenCalled();
    });
  });

  // ─── 4. Scrive la riga di idempotenza prima di avvisare ──────────────────
  it('scrive prima webhook_inbox, poi notificaStudio', async () => {
    const ordine: string[] = [];
    mockCreate.mockImplementationOnce(async () => { ordine.push('inbox'); });
    mockNotificaStudio.mockImplementationOnce(async () => { ordine.push('notifica'); });

    await registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-300', {
      mittente: 'Ordine Test',
      testo: 'Testo',
      motivo: 'Motivo.',
    });

    expect(ordine).toEqual(['inbox', 'notifica']);
  });

  // ─── 5. La destinazione del clic (voce 6, 09/10/2026) ────────────────────
  // L'avviso aveva `link: null`: la campanella diceva che un messaggio esisteva e non portava
  // da nessuna parte. Qui si presidia che la destinazione sia quella giusta, e soprattutto che
  // resti `null` quando non c'è nessuna scheda da aprire — perché inventare un link a vuoto
  // sarebbe lo stesso difetto con un'altra faccia.
  describe('la destinazione del clic', () => {
    /** Il `link` passato a `notificaStudio` nell'unica chiamata fatta. */
    async function linkDi(dati: Parameters<typeof registraIngressoSenzaFascicolo>[3]) {
      await registraIngressoSenzaFascicolo(TENANT, CANALE, 'update-link', dati);
      const chiamata = mockNotificaStudio.mock.calls[0];
      expect(chiamata).toBeDefined();
      return chiamata![1].link as string | null;
    }

    it("con il cliente noto apre l'anagrafica, con il parametro che la distingue dal Magic Link", async () => {
      const link = await linkDi({
        mittente: 'Anna Verdi',
        testo: 'Buongiorno',
        motivo: 'Ha 2 progetti aperti.',
        clienteId: 'cl-123',
      });

      expect(link).toBe('/clients?client=cl-123&azione=anagrafica');
      // `?client=` da solo apre il modale del Magic Link: senza `azione=anagrafica` l'operatore
      // finirebbe davanti la finestra sbagliata credendola quella giusta.
      expect(link).toContain('azione=anagrafica');
    });

    it('con la pratica nota apre la pratica, e vince sul cliente', async () => {
      const link = await linkDi({
        mittente: 'Anna Verdi',
        testo: 'Buongiorno',
        motivo: 'La chat è collegata a una pratica conclusa.',
        clienteId: 'cl-123',
        progettoId: 'pr-9',
      });

      // La pratica è la destinazione più specifica: il gesto richiesto («ripristinala») si fa
      // sulla sua scheda, mentre l'anagrafica sarebbe un giro a vuoto.
      expect(link).toBe('/projects/pr-9');
    });

    it('senza cliente e senza pratica il link resta null: non c\'è nessuna scheda da aprire', async () => {
      const link = await linkDi({
        mittente: 'Chat Telegram 245520495',
        testo: 'Ciao',
        motivo: 'Il chat id non è in nessuna scheda cliente.',
      });

      // Il mittente non è stato identificato: aprire una ricerca vuota sarebbe un finto rimedio.
      // Il `motivo` dice cosa cercare, ed è l'unica indicazione onesta che si possa dare.
      expect(link).toBeNull();
    });

    it("l'id finisce nell'URL codificato, non grezzo", async () => {
      const link = await linkDi({
        mittente: 'Anna Verdi',
        testo: 'Buongiorno',
        motivo: 'Ha 2 progetti aperti.',
        clienteId: 'cl/123 & altro',
      });

      // Gli id oggi non contengono caratteri da codificare, ma il giorno in cui li contenessero
      // un link rotto passerebbe inosservato fino a che qualcuno non lo clicca.
      expect(link).toBe('/clients?client=cl%2F123%20%26%20altro&azione=anagrafica');
    });
  });
});
