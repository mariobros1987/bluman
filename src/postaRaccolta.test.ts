// Accentratore delle mail — il giro di raccolta, con un lettore finto al posto di IMAP.
// Si guarda ciò che costa: un messaggio perso o doppio, la posta sotto il cliente sbagliato,
// una raccolta ferma che sembra «niente di nuovo».
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  caselle: [] as any[],
  clienti: [] as any[],
  messaggi: [] as any[],
  allegati: [] as any[],
  /** Quando il messaggio finto risulta salvato (`raccolto_at`, che nel database vero è `now()`). */
  raccoltoAt: new Date(0),
  /** Fa fallire la scrittura dell'allegato numero N (da 1), come un database che cade a metà. */
  rompiAllegatoNumero: 0,
  allegatiTentati: 0,
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    casellaPosta: {
      findMany: async (args: any) => db.caselle.filter((c) => c.tenantId === args.where.tenantId && c.attiva === args.where.attiva),
      update: async (args: any) => {
        const riga = db.caselle.find((c) => c.id === args.where.id);
        Object.assign(riga, args.data);
        return riga;
      },
    },
    cliente: { findMany: async () => db.clienti },
    messaggioPosta: {
      findFirst: async (args: any) => {
        const w = args.where;
        const stessa = (campo: string) => !(campo in w) || m_uguale(w[campo]);
        let riga: any;
        const m_uguale = (atteso: any) => {
          const valore = riga[cercato];
          if (atteso instanceof Date) return valore instanceof Date && valore.getTime() === atteso.getTime();
          if (atteso && typeof atteso === 'object' && 'not' in atteso) return valore !== atteso.not;
          return (valore ?? null) === atteso;
        };
        let cercato = '';
        const trovato = db.messaggi.find((m) => {
          riga = m;
          return ['casellaId', 'uid', 'uidValidity', 'messageId', 'mittenteEmail', 'oggetto', 'ricevutoAt'].every((campo) => { cercato = campo; return stessa(campo); });
        });
        if (!trovato) return null;
        return { ...trovato, _count: { allegati: db.allegati.filter((a) => a.messaggioId === trovato.id).length } };
      },
      create: async (args: any) => {
        const d = args.data;
        if (db.messaggi.some((m) => m.casellaId === d.casellaId && m.uidValidity === d.uidValidity && m.uid === d.uid)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const riga = { id: `m-${db.messaggi.length + 1}`, raccoltoAt: db.raccoltoAt, ...d };
        db.messaggi.push(riga);
        return riga;
      },
    },
    allegatoPosta: {
      create: async (args: any) => {
        db.allegatiTentati += 1;
        if (db.allegatiTentati === db.rompiAllegatoNumero) throw new Error('database non raggiungibile');
        db.allegati.push(args.data);
        return args.data;
      },
    },
  };
  return { prisma, contestoTenant: { run: (_c: unknown, fn: () => unknown) => fn() }, prismaAmministrativo: () => prisma };
});

const { raccogliPostaDelTenant, AMBITO_PASSWORD_CASELLA, MAX_MESSAGGI_PER_GIRO } = await import('./services/postaRaccolta.js');
const { cifraSegreto } = await import('./util/cifraturaSegreti.js');

const TENANT = 't-1';
const ADESSO = new Date('2026-11-28T10:00:00.000Z');

function casella(extra: Record<string, unknown> = {}) {
  return {
    id: 'cas-1', tenantId: TENANT, nome: 'Raccolta', host: 'imap.example.com', servername: null, porta: 993,
    utente: 'raccolta@studio.example', passwordCifrata: cifraSegreto('pw-vera', AMBITO_PASSWORD_CASELLA), cartella: 'INBOX',
    tipo: 'raccolta', clienteId: null, raccogliDal: null, uidValidity: null, ultimoUid: 0, attiva: true,
    ultimoErrore: null, ultimoSuccessoAt: null,
    ...extra,
  };
}

function messaggio(uid: number, extra: Record<string, unknown> = {}) {
  return {
    uid, messageId: `<${uid}@example.org>`, mittenteEmail: 'banca@example.org', mittenteNome: 'Banca', destinatari: 'mario.rossi@example.com',
    oggetto: `Oggetto ${uid}`, data: new Date('2026-11-27T09:00:00.000Z'),
    intestazioni: { deliveredTo: 'raccolta+k7m2p9xq@studio.example', to: 'mario.rossi@example.com' },
    testo: `Testo ${uid}`, html: null, allegati: [] as any[],
    ...extra,
  };
}

/** Il lettore finto: una casella con questi messaggi. Registra ciò che gli viene chiesto. */
function lettoreFinto(messaggi: any[], opzioni: { uidValidity?: string; rompiSu?: number; allegati?: Record<string, Buffer | null> } = {}) {
  const chiamate = { accesso: null as any, dal: null as Date | null, dopo: null as number | null, chiuso: 0 };
  const crea = (accesso: any) => {
    chiamate.accesso = accesso;
    return {
      apri: async () => ({ uidValidity: opzioni.uidValidity ?? '100', uidNext: (messaggi.at(-1)?.uid ?? 0) + 1 }),
      uidDal: async (giorno: Date) => { chiamate.dal = giorno; return messaggi.map((m) => m.uid); },
      uidDopo: async (ultimo: number) => { chiamate.dopo = ultimo; return messaggi.map((m) => m.uid).filter((u) => u > ultimo); },
      leggi: async (uid: number) => {
        if (uid === opzioni.rompiSu) throw Object.assign(new Error('socket chiuso'), { code: 'ECONNRESET' });
        return messaggi.find((m) => m.uid === uid) ?? null;
      },
      scaricaAllegato: async (_uid: number, parte: string) => (opzioni.allegati && parte in opzioni.allegati ? opzioni.allegati[parte]! : Buffer.from('contenuto')),
      chiudi: async () => { chiamate.chiuso += 1; },
    };
  };
  return { crea, chiamate };
}

const caricaOk = async (nome: string) => ({ ok: true, url: `/uploads/${nome}`, name: nome, size: '1 KB' });

beforeEach(() => {
  db.caselle = [casella()];
  db.clienti = [{ id: 'c-rossi', email: 'mario.rossi@example.com', aliasPosta: 'k7m2p9xq' }];
  db.messaggi = [];
  db.allegati = [];
  db.raccoltoAt = ADESSO;
  db.rompiAllegatoNumero = 0;
  db.allegatiTentati = 0;
});

describe('raccogliPostaDelTenant', () => {
  it('prima lettura: prende gli ultimi 30 giorni, attribuisce per alias e sposta il segnalibro', async () => {
    const { crea, chiamate } = lettoreFinto([messaggio(7), messaggio(9)]);
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });

    expect(esito).toEqual({ caselle: [{ casellaId: 'cas-1', nome: 'Raccolta', ok: true, nuovi: 2 }], nuovi: 2 });
    expect(chiamate.dal?.toISOString()).toBe('2026-10-29T10:00:00.000Z');
    // La password arriva al lettore decifrata, e solo a lui.
    expect(chiamate.accesso).toMatchObject({ host: 'imap.example.com', utente: 'raccolta@studio.example', password: 'pw-vera', cartella: 'INBOX' });
    expect(db.messaggi.map((m) => [m.uid, m.clienteId, m.attribuzione, m.criterio])).toEqual([[7, 'c-rossi', 'automatica', 'alias'], [9, 'c-rossi', 'automatica', 'alias']]);
    expect(db.caselle[0]).toMatchObject({ uidValidity: '100', ultimoUid: 9, ultimoErrore: null, ultimoSuccessoAt: ADESSO });
    expect(chiamate.chiuso).toBe(1);
  });

  it('giri successivi: solo ciò che viene dopo il segnalibro, al massimo un giro alla volta', async () => {
    db.caselle = [casella({ uidValidity: '100', ultimoUid: 10 })];
    const tanti = Array.from({ length: MAX_MESSAGGI_PER_GIRO + 5 }, (_, i) => messaggio(11 + i));
    const { crea, chiamate } = lettoreFinto(tanti);
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });

    expect(chiamate.dopo).toBe(10);
    expect(chiamate.dal).toBeNull();
    expect(esito.nuovi).toBe(MAX_MESSAGGI_PER_GIRO);
    expect(db.caselle[0].ultimoUid).toBe(10 + MAX_MESSAGGI_PER_GIRO);
  });

  it('la casella di un cliente è tutta sua, qualunque cosa dicano le intestazioni', async () => {
    db.caselle = [casella({ tipo: 'cliente', clienteId: 'c-verdi' })];
    const { crea } = lettoreFinto([messaggio(1)]);
    await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    expect(db.messaggi[0]).toMatchObject({ clienteId: 'c-verdi', attribuzione: 'automatica', criterio: 'casella' });
  });

  it('un messaggio senza cliente riconosciuto resta da smistare, non va perso', async () => {
    const { crea } = lettoreFinto([messaggio(1, { intestazioni: { to: 'raccolta@studio.example' }, mittenteEmail: 'ignoto@example.org' })]);
    await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    expect(db.messaggi[0]).toMatchObject({ clienteId: null, attribuzione: 'da_smistare' });
  });

  it('se la lettura si interrompe, il segnalibro resta sull’ultimo salvato e l’errore è scritto sulla casella', async () => {
    const { crea, chiamate } = lettoreFinto([messaggio(1), messaggio(2), messaggio(3)], { rompiSu: 2 });
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });

    expect(esito.caselle[0]).toMatchObject({ ok: false, nuovi: 1 });
    expect(esito.caselle[0]!.errore).toContain('messaggio 2');
    expect(db.messaggi.map((m) => m.uid)).toEqual([1]);
    expect(db.caselle[0].ultimoUid).toBe(1);
    expect(db.caselle[0].ultimoErrore).toContain('ECONNRESET');
    expect(db.caselle[0].ultimoSuccessoAt).toBeNull();
    expect(chiamate.chiuso).toBe(1);
  });

  it('rileggere lo stesso messaggio non crea un doppione', async () => {
    const { crea } = lettoreFinto([messaggio(1)]);
    await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    db.caselle[0].ultimoUid = 0; // come se il segnalibro non fosse stato scritto
    const secondo = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    expect(secondo.nuovi).toBe(0);
    expect(db.messaggi).toHaveLength(1);
  });

  it('se il server rinumera la cartella (UIDVALIDITY) si riparte, senza risalvare ciò che c’era', async () => {
    db.caselle = [casella({ uidValidity: '100', ultimoUid: 40 })];
    db.messaggi = [{ id: 'm-0', casellaId: 'cas-1', uidValidity: '100', uid: 40, messageId: '<1@example.org>' }];
    const { crea, chiamate } = lettoreFinto([messaggio(1), messaggio(2)], { uidValidity: '200' });
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });

    expect(chiamate.dal).not.toBeNull();
    expect(esito.nuovi).toBe(1);
    expect(db.caselle[0]).toMatchObject({ uidValidity: '200', ultimoUid: 2 });
  });

  it('dopo una rinumerazione, un messaggio senza Message-ID già raccolto non si risalva', async () => {
    // Senza Message-ID resta l'impronta: stesso mittente, stessa data, stesso oggetto.
    db.caselle = [casella({ uidValidity: '100', ultimoUid: 40 })];
    db.messaggi = [{
      id: 'm-0', casellaId: 'cas-1', uidValidity: '100', uid: 40, messageId: null,
      mittenteEmail: 'banca@example.org', oggetto: 'Oggetto 1', ricevutoAt: new Date('2026-11-27T09:00:00.000Z'),
    }];
    const { crea } = lettoreFinto([messaggio(1, { messageId: null }), messaggio(2, { messageId: null })], { uidValidity: '200' });
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });

    expect(esito.nuovi).toBe(1);
    expect(db.messaggi.map((m) => [m.uidValidity, m.oggetto])).toEqual([['100', 'Oggetto 1'], ['200', 'Oggetto 2']]);
    expect(db.caselle[0]).toMatchObject({ uidValidity: '200', ultimoUid: 2 });
  });

  it('nella stessa numerazione due messaggi uguali senza Message-ID sono due consegne vere: restano entrambi', async () => {
    const uguali = { messageId: null, oggetto: 'Avviso' };
    const { crea } = lettoreFinto([messaggio(1, uguali), messaggio(2, uguali)]);
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    expect(esito.nuovi).toBe(2);
    expect(db.messaggi).toHaveLength(2);
  });

  it('allegati rimasti a metà per un errore del database: il giro dopo li completa, senza doppioni e senza saltarli', async () => {
    const allegati = [
      { parte: '2', nome: 'uno.pdf', mime: 'application/pdf', dimensioneByte: 9 },
      { parte: '3', nome: 'due.pdf', mime: 'application/pdf', dimensioneByte: 9 },
      { parte: '4', nome: 'tre.pdf', mime: 'application/pdf', dimensioneByte: 9 },
    ];
    const { crea } = lettoreFinto([messaggio(1, { allegati }), messaggio(2)]);
    const fra = (minuti: number) => new Date(ADESSO.getTime() + minuti * 60_000);

    // Primo giro: il database cade mentre scrive il secondo allegato.
    db.rompiAllegatoNumero = 2;
    const primo = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    expect(primo.caselle[0]).toMatchObject({ ok: false, nuovi: 0 });
    expect(primo.caselle[0]!.errore).toContain('database non raggiungibile');
    expect(db.allegati.map((a) => a.nome)).toEqual(['uno.pdf']);
    expect(db.caselle[0].ultimoUid).toBe(0);

    // Subito dopo il messaggio può essere ancora in lavorazione (un altro processo): ci si ferma
    // lì senza toccarlo, senza superarlo e senza cancellare l'errore di prima.
    const presto = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: fra(5) });
    expect(presto.caselle[0]).toMatchObject({ ok: true, nuovi: 0 });
    expect(db.allegati.map((a) => a.nome)).toEqual(['uno.pdf']);
    expect(db.messaggi.map((m) => m.uid)).toEqual([1]);
    expect(db.caselle[0].ultimoUid).toBe(0);
    expect(db.caselle[0].ultimoErrore).toContain('database non raggiungibile');

    // Passato il tempo di un salvataggio, quel messaggio è fermo: si completano gli allegati mancanti.
    const dopo = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: fra(20) });
    expect(dopo.caselle[0]).toMatchObject({ ok: true, nuovi: 1 });
    expect(db.allegati.map((a) => [a.nome, a.messaggioId])).toEqual([['uno.pdf', 'm-1'], ['due.pdf', 'm-1'], ['tre.pdf', 'm-1']]);
    expect(db.messaggi.map((m) => m.uid)).toEqual([1, 2]);
    expect(db.caselle[0]).toMatchObject({ ultimoUid: 2, ultimoErrore: null });
  });

  it('un allegato troppo grande o rifiutato non ferma il messaggio: resta la riga con il motivo', async () => {
    const allegati = [
      { parte: '2', nome: 'contratto.pdf', mime: 'application/pdf', dimensioneByte: 9 },
      { parte: '3', nome: 'enorme.zip', mime: 'application/zip', dimensioneByte: 99_000_000 },
      { parte: '4', nome: 'pagina.html', mime: 'text/html', dimensioneByte: 5 },
    ];
    const { crea } = lettoreFinto([messaggio(1, { allegati })], { allegati: { '3': null } });
    const carica = async (nome: string) => {
      if (nome.endsWith('.html')) throw new Error('HTML, SVG, XML e contenuti web attivi non sono ammessi');
      return caricaOk(nome);
    };
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: carica as any, adesso: ADESSO });

    expect(esito.nuovi).toBe(1);
    expect(db.messaggi[0].haAllegati).toBe(true);
    expect(db.allegati.map((a) => [a.nome, a.url, a.motivoNonSalvato])).toEqual([
      ['contratto.pdf', '/uploads/contratto.pdf', null],
      ['enorme.zip', null, 'supera 15 MB'],
      ['pagina.html', null, 'HTML, SVG, XML e contenuti web attivi non sono ammessi'],
    ]);
    expect(db.allegati.every((a) => a.tenantId === TENANT && a.messaggioId === 'm-1')).toBe(true);
  });

  it('una casella senza password non si collega nemmeno, e lo dice', async () => {
    db.caselle = [casella({ passwordCifrata: null })];
    const { crea, chiamate } = lettoreFinto([messaggio(1)]);
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    expect(esito.caselle[0]).toMatchObject({ ok: false, nuovi: 0 });
    expect(db.caselle[0].ultimoErrore).toContain('non ha una password salvata');
    expect(chiamate.accesso).toBeNull();
  });

  it('la casella di un cliente eliminato si ferma invece di finire nella raccolta generale', async () => {
    db.caselle = [casella({ tipo: 'cliente', clienteId: null })];
    const { crea, chiamate } = lettoreFinto([messaggio(1)]);
    const esito = await raccogliPostaDelTenant(TENANT, { creaLettore: crea, carica: caricaOk as any, adesso: ADESSO });
    expect(esito.caselle[0]!.ok).toBe(false);
    expect(db.messaggi).toHaveLength(0);
    expect(chiamate.accesso).toBeNull();
  });

  it('senza caselle attive non fa niente', async () => {
    db.caselle = [casella({ attiva: false })];
    expect(await raccogliPostaDelTenant(TENANT, { adesso: ADESSO })).toEqual({ caselle: [], nuovi: 0 });
  });
});
