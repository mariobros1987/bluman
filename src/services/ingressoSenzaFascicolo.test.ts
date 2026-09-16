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
});
