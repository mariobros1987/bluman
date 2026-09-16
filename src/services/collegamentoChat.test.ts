/**
 * Il collegamento fra una chat e una pratica.
 *
 * Il comportamento da presidiare è **lo spostamento**: la chiave unica è sulla chat, non sulla
 * pratica. Un secondo `/start` dalla stessa chat non deve creare un secondo collegamento — se lo
 * facesse, la stessa chat scriverebbe in due fascicoli e `findUnique` su quella chiave smetterebbe
 * di funzionare, cioè il messaggio non entrerebbe più da nessuna parte. È anche la via d'uscita per
 * il cliente che ha toccato il link sbagliato.
 *
 * Il secondo è il **rifiuto della pratica chiusa**: meglio dirlo al cliente mentre è nella chat che
 * accogliere i suoi messaggi in una pratica che non li raccoglie più.
 *
 * Il prisma è finto e con stato (la mappa `collegamenti`): un finto che risponde sempre lo stesso
 * oggetto non saprebbe distinguere «crea» da «sposta», che è esattamente la differenza in prova.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const progettoFindFirst = vi.fn<any>(async () => null);
const collegamentoFindUnique = vi.fn<any>(async () => null);
const collegamentoFindMany = vi.fn<any>(async () => []);
const collegamentoDeleteMany = vi.fn<any>(async () => ({ count: 1 }));

/** Lo stato del finto: chiave `tenant:canale:chat` → riga. */
const collegamenti = new Map<string, any>();
const collegamentoUpsert = vi.fn<any>(async ({ where, create, update }: any) => {
  const { tenantId, canale, chatId } = where.tenantId_canale_chatId;
  const chiave = `${tenantId}:${canale}:${chatId}`;
  const esistente = collegamenti.get(chiave);
  const riga = esistente
    ? { ...esistente, ...update }
    : { id: `coll-${collegamenti.size + 1}`, ...create };
  collegamenti.set(chiave, riga);
  return riga;
});

vi.mock('../util/prismaClient.js', () => ({
  prisma: {
    progetto: { findFirst: progettoFindFirst },
    collegamentoChatProgetto: {
      findUnique: collegamentoFindUnique,
      findMany: collegamentoFindMany,
      upsert: collegamentoUpsert,
      deleteMany: collegamentoDeleteMany,
    },
  },
}));

const {
  collegaChatAProgetto,
  elencaCollegamentiProgetto,
  progettoChiuso,
  risolviFascicoloDaChat,
  scollegaPerId,
} = await import('./collegamentoChat.js');

const TENANT = '00000000-0000-4000-8000-000000000001';
const PROGETTO_A = '00000000-0000-4000-8000-0000000000a1';
const PROGETTO_B = '00000000-0000-4000-8000-0000000000a2';
const CHAT = '99';

/** Ciò che `collegaChatAProgetto` legge dal database prima di scrivere. */
const pratica = (id: string, stato: string, nome = 'Pratica') => ({
  id,
  nome,
  stato,
  cliente: { id: 'cli-1', nome: 'Mario Emirati' },
});

beforeEach(() => {
  vi.clearAllMocks();
  collegamenti.clear();
  progettoFindFirst.mockResolvedValue(null);
  collegamentoFindUnique.mockResolvedValue(null);
  collegamentoFindMany.mockResolvedValue([]);
  collegamentoDeleteMany.mockResolvedValue({ count: 1 });
});

describe('progettoChiuso', () => {
  it('solo conclusa e archiviata fermano la raccolta dei messaggi', () => {
    expect(progettoChiuso('completed')).toBe(true);
    expect(progettoChiuso('archived')).toBe(true);
    // `pre_project` è la pratica appena creata: è esattamente quella per cui si manda il link,
    // quindi non può contare come chiusa.
    expect(progettoChiuso('pre_project')).toBe(false);
    expect(progettoChiuso('in_progress')).toBe(false);
  });
});

describe('collegaChatAProgetto', () => {
  it('il primo collegamento crea la riga, con il cliente preso dalla pratica', async () => {
    progettoFindFirst.mockResolvedValue(pratica(PROGETTO_A, 'pre_project', 'Emirati Arabi 123'));

    const esito = await collegaChatAProgetto(TENANT, 'telegram', CHAT, PROGETTO_A, 'link');

    expect(esito.ok).toBe(true);
    expect(esito.ok && esito.progetto.nome).toBe('Emirati Arabi 123');
    expect(collegamentoUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_canale_chatId: { tenantId: TENANT, canale: 'telegram', chatId: CHAT } },
      create: expect.objectContaining({
        tenantId: TENANT,
        canale: 'telegram',
        chatId: CHAT,
        clienteId: 'cli-1',
        progettoId: PROGETTO_A,
        creatoDa: 'link',
      }),
    }));
    expect(collegamenti.get(`${TENANT}:telegram:${CHAT}`).progettoId).toBe(PROGETTO_A);
  });

  it('un secondo link dalla stessa chat sposta il collegamento invece di crearne un altro', async () => {
    progettoFindFirst.mockResolvedValue(pratica(PROGETTO_A, 'in_progress'));
    await collegaChatAProgetto(TENANT, 'telegram', CHAT, PROGETTO_A);

    progettoFindFirst.mockResolvedValue(pratica(PROGETTO_B, 'in_progress'));
    const esito = await collegaChatAProgetto(TENANT, 'telegram', CHAT, PROGETTO_B);

    expect(esito.ok).toBe(true);
    // Una riga sola, e punta alla seconda pratica: è il senso della chiave unica sulla chat.
    expect(collegamenti.size).toBe(1);
    expect(collegamenti.get(`${TENANT}:telegram:${CHAT}`).progettoId).toBe(PROGETTO_B);
    // Entrambe le scritture sono passate per la stessa chiave: la seconda è un aggiornamento.
    const chiavi = collegamentoUpsert.mock.calls.map((c: any) => JSON.stringify(c[0].where));
    expect(new Set(chiavi).size).toBe(1);
  });

  it('la pratica di un altro studio non è collegabile', async () => {
    progettoFindFirst.mockResolvedValue(null);

    const esito = await collegaChatAProgetto(TENANT, 'telegram', CHAT, PROGETTO_A);

    expect(esito).toEqual({ ok: false, motivo: 'progetto_non_trovato' });
    expect(collegamentoUpsert).not.toHaveBeenCalled();
    // Il filtro sul tenant è nella lettura: è ciò che rende impossibile collegarsi a una pratica
    // che questo studio non vede.
    expect(progettoFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: PROGETTO_A, tenantId: TENANT },
    }));
  });

  it('una pratica conclusa o archiviata rifiuta il collegamento, e dice quale stato ha', async () => {
    progettoFindFirst.mockResolvedValue(pratica(PROGETTO_A, 'archived'));

    const esito = await collegaChatAProgetto(TENANT, 'telegram', CHAT, PROGETTO_A);

    expect(esito).toEqual({ ok: false, motivo: 'progetto_chiuso', stato: 'archived' });
    expect(collegamentoUpsert).not.toHaveBeenCalled();
  });
});

describe('risolviFascicoloDaChat', () => {
  it('senza collegamento non risolve nulla', async () => {
    expect(await risolviFascicoloDaChat(TENANT, 'telegram', CHAT)).toBeNull();
    expect(collegamentoFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_canale_chatId: { tenantId: TENANT, canale: 'telegram', chatId: CHAT } },
    }));
  });

  it('risolve il fascicolo con il cliente e lo stato della pratica', async () => {
    collegamentoFindUnique.mockResolvedValue({
      id: 'coll-1',
      cliente: { id: 'cli-1', nome: 'Mario Emirati' },
      progetto: { id: PROGETTO_A, nome: 'Emirati Arabi 123', stato: 'archived' },
    });

    const esito = await risolviFascicoloDaChat(TENANT, 'telegram', CHAT);

    expect(esito).toEqual({
      collegamentoId: 'coll-1',
      cliente: { id: 'cli-1', nome: 'Mario Emirati' },
      progetto: { id: PROGETTO_A, nome: 'Emirati Arabi 123', stato: 'archived' },
    });
  });
});

describe('elenco e revoca', () => {
  it("l'elenco è filtrato sulla pratica e sullo studio", async () => {
    await elencaCollegamentiProgetto(TENANT, PROGETTO_A);
    expect(collegamentoFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT, progettoId: PROGETTO_A },
    }));
  });

  it('la revoca è vincolata alla pratica, non solo al collegamento', async () => {
    // Senza `progettoId` nella `where`, l'identificativo di un collegamento basterebbe a revocare
    // quello di un'altra pratica dello stesso studio.
    await scollegaPerId(TENANT, PROGETTO_A, 'coll-1');
    expect(collegamentoDeleteMany).toHaveBeenCalledWith({
      where: { id: 'coll-1', tenantId: TENANT, progettoId: PROGETTO_A },
    });
  });

  it('una revoca che non trova niente risponde false invece di lanciare', async () => {
    collegamentoDeleteMany.mockResolvedValue({ count: 0 });
    expect(await scollegaPerId(TENANT, PROGETTO_A, 'coll-inesistente')).toBe(false);
    collegamentoDeleteMany.mockResolvedValue({ count: 1 });
    expect(await scollegaPerId(TENANT, PROGETTO_A, 'coll-1')).toBe(true);
  });
});
