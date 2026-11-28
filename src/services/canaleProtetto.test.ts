// Canale protetto: ciò che finisce a database e in archivio non si legge, chi ha titolo lo rilegge
// uguale, e al browser non arriva mai il riferimento dell'archivio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const archivio = new Map<string, Buffer>();

vi.mock('./storageService.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./storageService.js')>();
  return {
    ...reale,
    salvaBufferInArchivio: async (nome: string, contenuto: Buffer) => {
      archivio.set(`/uploads/${nome}`, Buffer.from(contenuto));
      return `/uploads/${nome}?firma=prova`;
    },
    leggiFileArchivio: async (riferimento: string) => archivio.get(riferimento) ?? null,
  };
});

const {
  ErroreAllegato,
  TESTO_NON_LEGGIBILE,
  archiviaAllegatiProtetti,
  contenutoDaScrivere,
  contenutoMessaggio,
  ingressoMessaggio,
  leggiAllegatoProtetto,
  messaggioLeggibile,
  preparaMessaggioProtetto,
  rispostaAErroreCanale,
} = await import('./canaleProtetto.js');
const { ErroreCifratura, eTestoCifrato } = await import('./cifraturaCanale.js');

const CHIAVE = 'chiave-di-prova-del-canale-protetto-0001';
const STUDIO = '00000000-0000-0000-0000-000000000001';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nvisura riservata del cliente\n%%EOF');
const base64 = (b: Buffer) => b.toString('base64');
const prima = process.env.CANALE_PROTETTO_CHIAVE;
// Senza chiave dedicata il canale usa il segreto dei token: «senza chiave» vuol dire senza entrambi.
const segretoToken = process.env.JWT_SECRET;
function senzaNessunaChiave() {
  delete process.env.CANALE_PROTETTO_CHIAVE;
  delete process.env.JWT_SECRET;
}

function riga(contenuto: { testo: string; allegatiJson: string | null }, progettoId = 'p-1') {
  return { id: 'msg-1', tenantId: STUDIO, progettoId, canale: 'portal', ...contenuto };
}

beforeEach(() => {
  archivio.clear();
  process.env.CANALE_PROTETTO_CHIAVE = CHIAVE;
});

afterEach(() => {
  if (prima === undefined) delete process.env.CANALE_PROTETTO_CHIAVE;
  else process.env.CANALE_PROTETTO_CHIAVE = prima;
  if (segretoToken !== undefined) process.env.JWT_SECRET = segretoToken;
});

describe('messaggio', () => {
  it('a database testo ed elenco allegati sono cifrati, e chi ha titolo li rilegge uguali', async () => {
    const scritto = await preparaMessaggioProtetto(STUDIO, 'p-1', {
      testo: 'Le mando la visura e il mio IBAN',
      allegatiProtetti: [{ nome: 'visura camerale.pdf', contentBase64: base64(PDF) }],
    });
    expect(eTestoCifrato(scritto.testo)).toBe(true);
    expect(eTestoCifrato(scritto.allegatiJson)).toBe(true);
    expect(`${scritto.testo}${scritto.allegatiJson}`).not.toMatch(/visura|IBAN/);
    expect(scritto.conAllegati).toBe(true);

    const letto = messaggioLeggibile(riga(scritto));
    expect(letto.testo).toBe('Le mando la visura e il mio IBAN');
    expect(letto.cifrato).toBe(true);
    expect(JSON.parse(letto.allegatiJson!)).toEqual([
      { protetto: true, nome: 'visura camerale.pdf', dimensione: '1 KB', mime: 'application/pdf', url: '/progetti/p-1/comunicazioni/msg-1/allegati/0' },
    ]);
  });

  it('al browser non arrivano il riferimento dell’archivio né l’impronta del file', async () => {
    const scritto = await preparaMessaggioProtetto(STUDIO, 'p-1', {
      testo: 'ecco',
      allegatiProtetti: [{ nome: 'visura.pdf', contentBase64: base64(PDF) }],
    });
    const letto = messaggioLeggibile(riga(scritto));
    expect(letto.allegatiJson).not.toMatch(/uploads|oggetto|sha256|protetto\.bin/);
  });

  it('un messaggio scritto prima della cifratura resta com’è, con i suoi allegati', () => {
    const vecchio = riga({ testo: 'Buongiorno', allegatiJson: JSON.stringify([{ nome: 'a.pdf', url: 'https://esempio.test/a.pdf' }]) });
    const letto = messaggioLeggibile(vecchio);
    expect(letto.testo).toBe('Buongiorno');
    expect(letto.cifrato).toBe(false);
    expect(JSON.parse(letto.allegatiJson!)).toEqual([{ nome: 'a.pdf', url: 'https://esempio.test/a.pdf' }]);
  });

  it('un messaggio di un altro canale non viene toccato', () => {
    const email = { ...riga({ testo: 'via email', allegatiJson: null }), canale: 'email' };
    expect(messaggioLeggibile(email)).toEqual({ ...email, cifrato: false });
  });

  it('se la chiave non c’è più il messaggio resta in elenco e dichiara di non potersi aprire', () => {
    const scritto = contenutoDaScrivere(STUDIO, 'p-1', { testo: 'riservato' });
    process.env.CANALE_PROTETTO_CHIAVE = 'un-altra-chiave-lunga-abbastanza-000002';
    const letto = messaggioLeggibile(riga(scritto));
    expect(letto).toMatchObject({ testo: TESTO_NON_LEGGIBILE, allegatiJson: null, cifrato: true, illeggibile: true });
  });

  it('senza chiave scrive in chiaro e non dichiara un lucchetto che non c’è', () => {
    senzaNessunaChiave();
    const scritto = contenutoDaScrivere(STUDIO, 'p-1', { testo: 'in chiaro' });
    expect(scritto.testo).toBe('in chiaro');
    expect(messaggioLeggibile(riga(scritto)).cifrato).toBe(false);
  });

  it('senza chiave dedicata cifra con il segreto dei token', () => {
    delete process.env.CANALE_PROTETTO_CHIAVE;
    const scritto = contenutoDaScrivere(STUDIO, 'p-1', { testo: 'riservato' });
    expect(scritto.testo).not.toContain('riservato');
    expect(messaggioLeggibile(riga(scritto))).toMatchObject({ testo: 'riservato', cifrato: true });
  });

  it('con una chiave non valida rifiuta prima di lasciare file in archivio', async () => {
    process.env.CANALE_PROTETTO_CHIAVE = 'corta';
    await expect(
      preparaMessaggioProtetto(STUDIO, 'p-1', { testo: 'x', allegatiProtetti: [{ nome: 'visura.pdf', contentBase64: base64(PDF) }] }),
    ).rejects.toBeInstanceOf(ErroreCifratura);
    expect(archivio.size).toBe(0);
  });
});

describe('allegati', () => {
  it('in archivio il file è cifrato e ha un nome che non dice niente', async () => {
    await archiviaAllegatiProtetti(STUDIO, 'p-1', [{ nome: 'visura rossi srl.pdf', contentBase64: base64(PDF) }]);
    const [nome, contenuto] = [...archivio.entries()][0]!;
    expect(nome).not.toMatch(/visura|rossi/);
    expect(contenuto.includes(Buffer.from('visura riservata'))).toBe(false);
    expect(contenuto.subarray(0, 4).toString('ascii')).toBe('BMC1');
  });

  it('si riscarica identico, e solo dalla sua pratica', async () => {
    const scritto = await preparaMessaggioProtetto(STUDIO, 'p-1', {
      testo: '',
      allegatiProtetti: [{ nome: 'visura.pdf', contentBase64: base64(PDF) }],
    });
    const scaricato = await leggiAllegatoProtetto(riga(scritto), 0);
    expect(scaricato?.nome).toBe('visura.pdf');
    expect(scaricato?.mime).toBe('application/pdf');
    expect(scaricato?.contenuto.equals(PDF)).toBe(true);
    expect(await leggiAllegatoProtetto(riga(scritto), 1)).toBeNull();
    // La stessa riga spostata a mano su un'altra pratica non si apre.
    await expect(leggiAllegatoProtetto(riga(scritto, 'p-2'), 0)).rejects.toBeInstanceOf(ErroreCifratura);
  });

  it('un file sostituito in archivio non viene consegnato', async () => {
    const scritto = await preparaMessaggioProtetto(STUDIO, 'p-1', {
      testo: '',
      allegatiProtetti: [{ nome: 'visura.pdf', contentBase64: base64(PDF) }],
    });
    const [nome] = [...archivio.keys()];
    const altro = await archiviaAllegatiProtetti(STUDIO, 'p-1', [{ nome: 'altro.pdf', contentBase64: base64(Buffer.concat([PDF, Buffer.from('x')])) }]);
    archivio.set(nome!, archivio.get(altro[0]!.oggetto)!);
    await expect(leggiAllegatoProtetto(riga(scritto), 0)).rejects.toThrow(/non corrisponde/);
  });

  it('un allegato dichiarato con un indirizzo non passa dalla rotta di scarico', async () => {
    const scritto = contenutoDaScrivere(STUDIO, 'p-1', { testo: 'x', allegatiJson: [{ nome: 'a.pdf', url: '/uploads/qualcosa.pdf' }] });
    expect(await leggiAllegatoProtetto(riga(scritto), 0)).toBeNull();
  });

  it('senza chiave il file si archivia in chiaro e si rilegge', async () => {
    senzaNessunaChiave();
    const scritto = await preparaMessaggioProtetto(STUDIO, 'p-1', {
      testo: 'x',
      allegatiProtetti: [{ nome: 'visura.pdf', contentBase64: base64(PDF) }],
    });
    expect((await leggiAllegatoProtetto(riga(scritto), 0))?.contenuto.equals(PDF)).toBe(true);
  });

  it('rifiuta, col motivo, ciò che non è ammesso', async () => {
    const pdf = { nome: 'a.pdf', contentBase64: base64(PDF) };
    await expect(archiviaAllegatiProtetti(STUDIO, 'p-1', Array(6).fill(pdf))).rejects.toThrow(/al massimo 5/);
    await expect(archiviaAllegatiProtetti(STUDIO, 'p-1', [{ nome: 'pagina.html', contentBase64: base64(Buffer.from('<html></html>')) }])).rejects.toBeInstanceOf(ErroreAllegato);
    await expect(archiviaAllegatiProtetti(STUDIO, 'p-1', [{ nome: 'finto.pdf', contentBase64: base64(Buffer.from('MZ eseguibile travestito')) }])).rejects.toThrow(/non corrisponde/);
    await expect(archiviaAllegatiProtetti(STUDIO, 'p-1', [{ nome: 'a.pdf', contentBase64: 'non è base64!' }])).rejects.toThrow(/integro/);
    await expect(archiviaAllegatiProtetti(STUDIO, 'p-1', [{ nome: '  ', contentBase64: base64(PDF) }])).rejects.toThrow(/nome/);
    expect(archivio.size).toBe(0);
  });
});

describe('risposta a un rifiuto', () => {
  it('al cliente non dice quale variabile è sbagliata, allo studio sì', () => {
    const errore = new ErroreCifratura('CANALE_PROTETTO_CHIAVE è più corta di 32 caratteri.');
    expect(rispostaAErroreCanale(errore, true)).toEqual({ stato: 503, errore: expect.not.stringContaining('CANALE_PROTETTO_CHIAVE') });
    expect(rispostaAErroreCanale(errore, false)?.errore).toContain('CANALE_PROTETTO_CHIAVE');
    expect(rispostaAErroreCanale(new ErroreAllegato('troppo grande'), true)).toEqual({ stato: 400, errore: 'troppo grande' });
    expect(rispostaAErroreCanale(new Error('altro'), true)).toBeNull();
  });
});

describe('ingresso di un messaggio', () => {
  const file = { nome: 'visura.pdf', contentBase64: base64(PDF) };

  it('dal portale il canale è quello protetto, qualunque cosa dichiari il cliente', () => {
    expect(ingressoMessaggio({ canale: 'whatsapp', testo: ' ciao ' }, true)).toEqual({ canale: 'portal', protetto: true, testo: 'ciao', allegatiProtetti: [] });
  });

  it('nel canale protetto un file può viaggiare senza testo; altrove no, e lì non si accetta', () => {
    expect(ingressoMessaggio({ canale: 'portal', allegatiProtetti: [file] }, false)).toMatchObject({ protetto: true, testo: '', allegatiProtetti: [file] });
    expect(ingressoMessaggio({ canale: 'portal', testo: '' }, false)).toEqual({ errore: 'Canale e testo sono obbligatori.' });
    expect(ingressoMessaggio({ canale: 'email', allegatiProtetti: [file] }, false)).toEqual({ errore: 'Canale e testo sono obbligatori.' });
    expect(ingressoMessaggio({ canale: 'email', testo: 'x', allegatiProtetti: [file] }, false)).toEqual({ errore: expect.stringContaining('solo nel canale del portale') });
    expect(ingressoMessaggio({ testo: 'x' }, false)).toEqual({ errore: 'Canale e testo sono obbligatori.' });
  });

  it('fuori dal canale protetto il contenuto resta com’è, con l’elenco degli allegati dichiarati', async () => {
    const ingresso = ingressoMessaggio({ canale: 'email', testo: 'in chiaro' }, false);
    if ('errore' in ingresso) throw new Error(ingresso.errore);
    expect(await contenutoMessaggio(STUDIO, 'p-1', ingresso, [{ nome: 'a.pdf', url: '/uploads/a.pdf' }], false)).toEqual({
      ok: true, testo: 'in chiaro', allegatiJson: JSON.stringify([{ nome: 'a.pdf', url: '/uploads/a.pdf' }]), conAllegati: true,
    });
    expect(archivio.size).toBe(0);
  });

  it('nel canale protetto cifra, ignora gli allegati dichiarati dal cliente e trasforma un rifiuto in risposta', async () => {
    const ingresso = ingressoMessaggio({ testo: 'riservato', allegatiProtetti: [file] }, true);
    if ('errore' in ingresso) throw new Error(ingresso.errore);
    const scritto = await contenutoMessaggio(STUDIO, 'p-1', ingresso, [{ nome: 'esca.pdf', url: 'https://altrove.example/esca.pdf' }], true);
    if (!scritto.ok) throw new Error(scritto.errore);
    expect(scritto.testo).not.toContain('riservato');
    const letto = messaggioLeggibile(riga(scritto));
    expect(letto.testo).toBe('riservato');
    expect(JSON.stringify(letto.allegatiJson)).not.toContain('esca.pdf');

    process.env.CANALE_PROTETTO_CHIAVE = 'corta';
    expect(await contenutoMessaggio(STUDIO, 'p-1', ingresso, null, true)).toMatchObject({ ok: false, stato: 503, errore: expect.not.stringContaining('CANALE_PROTETTO_CHIAVE') });
  });
});
