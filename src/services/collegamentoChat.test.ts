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
const collegamentoFindFirst = vi.fn<any>(async () => null);
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

const contestoDeleteMany = vi.fn<any>(async () => ({ count: 0 }));

/**
 * Il finto Prisma.
 *
 * `$transaction` deve **esistere**, ed è la sola cosa non ovvia di questo finto: il servizio scrive
 * il collegamento e disarma il contesto micro-voce in una transazione sola, e senza questo metodo
 * ogni test che passa da lì esplode con «prisma.$transaction is not a function» — un rosso che
 * sembra un guasto del database e invece è un pezzo mancante nel finto. Qui non c'è un database da
 * isolare, quindi la callback gira sullo stesso oggetto.
 */
const finto = {
  progetto: { findFirst: progettoFindFirst },
  collegamentoChatProgetto: {
    findUnique: collegamentoFindUnique,
    findFirst: collegamentoFindFirst,
    findMany: collegamentoFindMany,
    upsert: collegamentoUpsert,
    deleteMany: collegamentoDeleteMany,
  },
  contestoMicrovoceChat: { deleteMany: contestoDeleteMany },
  $transaction: async (fn: any) => fn(finto),
};

vi.mock('../util/prismaClient.js', () => ({
  prisma: finto,
  // Fuori da una richiesta HTTP non c'è contesto tenant da impostare, quindi la vera
  // `conContestoInTransazione` eseguirebbe la callback e basta. Il finto fa lo stesso, ma deve
  // **esserci**: se manca, vitest rifiuta l'import con «No export is defined on the mock», e il
  // rosso parla di un export mancante invece che del comportamento in prova.
  conContestoInTransazione: async (_tx: any, fn: () => Promise<any>) => fn(),
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
  collegamentoFindUnique.mockImplementation(async ({ where }: any) => {
    // Legge dalla **stessa mappa** in cui scrive l'upsert. Un finto che rispondesse sempre `null`
    // direbbe che nessuna chat è mai collegata due volte, e «sposta» — cioè la cosa che questi test
    // esistono per presidiare — non verrebbe mai esercitato davvero.
    const { tenantId, canale, chatId } = where.tenantId_canale_chatId;
    return collegamenti.get(`${tenantId}:${canale}:${chatId}`) ?? null;
  });
  collegamentoFindFirst.mockResolvedValue(null);
  collegamentoFindMany.mockResolvedValue([]);
  collegamentoDeleteMany.mockResolvedValue({ count: 1 });
  contestoDeleteMany.mockResolvedValue({ count: 0 });
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

  it('spostando la chat su un\'altra pratica, il contesto micro-voce cade con lei', async () => {
    // Il contesto è legato alla **chat**, non alla pratica. Se sopravvivesse allo spostamento, il
    // primo messaggio scritto nella pratica B nascerebbe abbinato a una voce della pratica A —
    // senza che né il cliente né l'operatore se ne accorgano.
    progettoFindFirst.mockResolvedValue(pratica(PROGETTO_B, 'in_progress'));
    collegamentoFindUnique.mockResolvedValue({ progettoId: PROGETTO_A });
    contestoDeleteMany.mockResolvedValue({ count: 1 });

    const esito = await collegaChatAProgetto(TENANT, 'telegram', CHAT, PROGETTO_B);

    expect(esito.ok && esito.contestoDisarmato).toBe(true);
    expect(contestoDeleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, canale: 'telegram', chatId: CHAT },
    });
  });

  it('ritoccare il link della stessa pratica non è un modo per disarmare di nascosto', async () => {
    // Il cliente che riapre il link che ha già — per sbaglio, o perché l'ha ritrovato — non deve
    // perdere il contesto che aveva armato: quello che si tocca è il collegamento, non la voce.
    progettoFindFirst.mockResolvedValue(pratica(PROGETTO_A, 'in_progress'));
    collegamentoFindUnique.mockResolvedValue({ progettoId: PROGETTO_A });

    const esito = await collegaChatAProgetto(TENANT, 'telegram', CHAT, PROGETTO_A);

    expect(esito.ok && esito.contestoDisarmato).toBe(false);
    expect(contestoDeleteMany).not.toHaveBeenCalled();
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
    collegamentoFindFirst.mockResolvedValue({ canale: 'telegram', chatId: CHAT });

    await scollegaPerId(TENANT, PROGETTO_A, 'coll-1');

    expect(collegamentoFindFirst).toHaveBeenCalledWith({
      where: { id: 'coll-1', tenantId: TENANT, progettoId: PROGETTO_A },
      select: { canale: true, chatId: true },
    });
    expect(collegamentoDeleteMany).toHaveBeenCalledWith({
      where: { id: 'coll-1', tenantId: TENANT, progettoId: PROGETTO_A },
    });
  });

  it('revocando, il contesto micro-voce della chat cade con il collegamento', async () => {
    // Non si revoca a metà: la chat non è più legata a nessuna pratica, e un contesto che
    // sopravvivesse continuerebbe ad abbinare i messaggi alla voce della pratica da cui è stata
    // staccata. Le coordinate per trovarlo le dà la lettura, perché l'id del collegamento da solo
    // non dice su quale chat era armato.
    collegamentoFindFirst.mockResolvedValue({ canale: 'telegram', chatId: CHAT });
    contestoDeleteMany.mockResolvedValue({ count: 1 });

    expect(await scollegaPerId(TENANT, PROGETTO_A, 'coll-1')).toEqual({
      rimosso: true,
      contestoDisarmato: true,
    });
    expect(contestoDeleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, canale: 'telegram', chatId: CHAT },
    });
  });

  it('una revoca che non trova niente risponde false invece di lanciare', async () => {
    // Il collegamento non è di questa pratica (la lettura torna null): niente da cancellare, e
    // **niente contesto da disarmare** — disarmarlo qui toglierebbe l'armamento di una chat che non
    // si sta toccando.
    expect(await scollegaPerId(TENANT, PROGETTO_A, 'coll-inesistente')).toEqual({
      rimosso: false,
      contestoDisarmato: false,
    });
    expect(collegamentoDeleteMany).not.toHaveBeenCalled();
    expect(contestoDeleteMany).not.toHaveBeenCalled();
  });

  it('se la cancellazione non tocca righe, la revoca è falsa e il contesto resta', async () => {
    // La lettura l'aveva trovato ma la `where` della cancellazione non lo prende: è il caso della
    // corsa fra due revoche. Il contesto non si disarma, perché non è questa la revoca che è andata
    // a segno.
    collegamentoFindFirst.mockResolvedValue({ canale: 'telegram', chatId: CHAT });
    collegamentoDeleteMany.mockResolvedValue({ count: 0 });

    expect(await scollegaPerId(TENANT, PROGETTO_A, 'coll-1')).toEqual({
      rimosso: false,
      contestoDisarmato: false,
    });
    expect(contestoDeleteMany).not.toHaveBeenCalled();
  });
});
