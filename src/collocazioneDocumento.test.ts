/**
 * §40 — presidio della collocazione di un documento nell'archivio.
 *
 * Il rischio che questo file presidia è quello che ha reso necessario §40: un documento agganciato
 * alla micro-voce di un ALTRO progetto. Nasceva senza malizia — una tendina rimasta sul progetto
 * precedente — e il risultato era un atto che compariva nel fascicolo di una pratica e nella
 * lavorazione di un'altra. Nessuno dei due elenchi sbagliava: sbagliava la riga.
 *
 * Presidia anche la regola che tiene in piedi l'archivio: un documento non si stacca da tutto. La
 * cartella «non collocati» esiste perché un progetto eliminato azzera le FK (`onDelete: SetNull`),
 * non perché ci si possa mettere un documento a mano.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soloCodice } from './util/soloCodice.js';
import { decidiCollocazione, descriviSpostamento } from './services/collocazioneDocumento.js';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROGETTO = 'prg-1';
const ALTRO_PROGETTO = 'prg-2';
const MICROVOCE = 'mv-1';

describe('§40 — la micro-voce deve appartenere al progetto', () => {
  it('rifiuta la micro-voce di un altro progetto, e lo dice', () => {
    const esito = decidiCollocazione(
      { progettoId: PROGETTO, microvoceProgettoId: MICROVOCE },
      { progettoEsiste: true, progettoDellaMicrovoce: ALTRO_PROGETTO },
    );
    expect(esito.ok).toBe(false);
    expect(esito.codice).toBe(400);
    expect(esito.errore).toContain('un altro progetto');
    // La verifica che conta: niente da scrivere. Un esito rifiutato non deve portare valori.
    expect(esito.microvoceProgettoId).toBeUndefined();
  });

  it('accetta la micro-voce del progetto indicato', () => {
    const esito = decidiCollocazione(
      { progettoId: PROGETTO, microvoceProgettoId: MICROVOCE },
      { progettoEsiste: true, progettoDellaMicrovoce: PROGETTO },
    );
    expect(esito).toMatchObject({ ok: true, progettoId: PROGETTO, microvoceProgettoId: MICROVOCE });
  });

  it('con la sola micro-voce ricava il progetto invece di lasciarlo vuoto', () => {
    // §2.9 permetteva di valorizzare solo `microvoceProgettoId`: quel documento non compariva
    // nella cartella del progetto finché l'archivio non risaliva il modulo. Ora il progetto si
    // scrive sulla riga, e la cartella lo trova senza risalire niente.
    const esito = decidiCollocazione(
      { microvoceProgettoId: MICROVOCE },
      { progettoEsiste: false, progettoDellaMicrovoce: PROGETTO },
    );
    expect(esito).toMatchObject({ ok: true, progettoId: PROGETTO, microvoceProgettoId: MICROVOCE });
  });

  it('la micro-voce inesistente è 404, non un collegamento silenziosamente scartato', () => {
    const esito = decidiCollocazione(
      { progettoId: PROGETTO, microvoceProgettoId: 'mv-che-non-esiste' },
      { progettoEsiste: true, progettoDellaMicrovoce: undefined },
    );
    expect(esito.ok).toBe(false);
    expect(esito.codice).toBe(404);
  });

  it('il progetto inesistente è 404', () => {
    const esito = decidiCollocazione({ progettoId: 'prg-fantasma' }, { progettoEsiste: false });
    expect(esito.ok).toBe(false);
    expect(esito.codice).toBe(404);
  });
});

describe('§40 — un documento non si stacca da tutto', () => {
  it('senza progetto e senza micro-voce è un rifiuto', () => {
    const esito = decidiCollocazione({}, { progettoEsiste: false });
    expect(esito.ok).toBe(false);
    expect(esito.codice).toBe(400);
    expect(esito.errore).toContain('nessuna cartella');
  });

  it('le stringhe vuote e i soli spazi valgono come assenza, non come id', () => {
    // Arrivano dalle tendine dell'interfaccia: `value=""` è «non scelto». Trattarla come id
    // farebbe cercare a database un progetto chiamato stringa vuota, e il 404 direbbe la cosa
    // sbagliata all'operatore.
    expect(decidiCollocazione({ progettoId: '  ', microvoceProgettoId: '' }, { progettoEsiste: true }).ok).toBe(false);
  });

  it('il solo progetto stacca la micro-voce, e lo scrive', () => {
    // `null` è una scrittura: senza di essa «togli la micro-voce» sarebbe indistinguibile da
    // «lascia com'era», e un documento non si potrebbe mai riportare al solo fascicolo.
    const esito = decidiCollocazione({ progettoId: PROGETTO }, { progettoEsiste: true });
    expect(esito).toMatchObject({ ok: true, progettoId: PROGETTO, microvoceProgettoId: null });
  });
});

describe('§40 — la traccia dice da dove a dove', () => {
  it('nomina la partenza e l\'arrivo', () => {
    const frase = descriviSpostamento(
      { progetto: 'Holding Malta', microvoce: null },
      { progetto: 'Holding Malta', microvoce: 'Deposito bilancio' },
    );
    expect(frase).toContain('«Holding Malta»');
    expect(frase).toContain('«Deposito bilancio»');
    expect(frase).toContain('nessuna micro-voce');
  });

  it('dice «nessuna cartella» per il documento che non ne aveva una', () => {
    const frase = descriviSpostamento({}, { progetto: 'Trust Jersey' });
    expect(frase).toContain('nessuna cartella');
    expect(frase).toContain('«Trust Jersey»');
  });
});

describe('§40 — le rotte che scrivono il collegamento usano la decisione presidiata', () => {
  const ROTTA = 'src/routes/collegamentoDocumenti.ts';
  const DOCUMENTI = 'src/routes/documenti.ts';
  const codiceRotta = soloCodice(readFileSync(join(RADICE, ROTTA), 'utf8'));
  const codiceDocumenti = soloCodice(readFileSync(join(RADICE, DOCUMENTI), 'utf8'));

  it('l\'upload e la generazione non scrivono più il valore ricevuto senza verificarlo', () => {
    // Il difetto era letterale: la proprietà abbreviata `microvoceProgettoId,` dentro il `data`
    // della create, cioè il valore che passa dritto dal body alla riga. Si cerca per riga e non
    // con un'espressione sul testo intero, perché `microvoceProgettoId: collocazione.microvoceProgettoId,`
    // finisce con le stesse lettere ed è invece esattamente la forma giusta.
    const abbreviate = codiceDocumenti
      .split('\n')
      .filter((riga) => riga.trim() === 'microvoceProgettoId,');
    expect(abbreviate).toEqual([]);
    // Due create che possono ricevere una micro-voce (upload e generazione): entrambe devono
    // passare dalla decisione presidiata.
    expect(codiceDocumenti.match(/decidiCollocazione\(/g) ?? []).toHaveLength(2);
  });

  it('la rotta di collegamento non si fida della richiesta per il tenant', () => {
    // Ogni riga citata dal body si rilegge con `tenantId` nel where: RLS isola il tenant, ma
    // un id di un'altra pratica dello STESSO studio passerebbe RLS senza problemi.
    expect(codiceRotta).toContain('decidiCollocazione(');
    expect(codiceRotta).toMatch(/microvoceProgetto\.findFirst\(\{\s*\n?\s*where:\s*\{\s*id:\s*microvoceChiesta,\s*tenantId/);
    expect(codiceRotta).toMatch(/progetto\.findFirst\(\{\s*where:\s*\{\s*id:\s*progettoChiesto,\s*tenantId/);
  });

  it('lo spostamento resta scritto nel registro, con chi lo ha fatto', () => {
    // «lasciando traccia ovunque»: senza questi campi `recordAudit` attribuisce l'operazione a
    // «Sistema / Operatore», e un registro che non sa chi ha spostato una carta non è una traccia.
    expect(codiceRotta).toContain("azione: 'DOCUMENTO_RICOLLEGATO'");
    expect(codiceRotta).toContain('descriviSpostamento(');
    expect(codiceRotta).toMatch(/userId:\s*\(req as any\)\.userId/);
    expect(codiceRotta).toMatch(/ruolo:\s*\(req as any\)\.ruolo/);
  });

  it('l\'archivio dello studio non si apre al token di un cliente', () => {
    // Stesso presidio di `/documenti/archivio`: RLS isola il tenant, non i clienti fra loro.
    expect(codiceRotta.match(/ruolo === 'cliente'/g) ?? []).toHaveLength(2);
  });
});

describe('§40 — l\'interfaccia dell\'archivio non finge di aver scritto', () => {
  // `vitest.config.ts` esclude `frontend/**` dai test: questi file non si possono eseguire qui,
  // ma si possono leggere. Gli asserti sono pochi e mirati ai tre modi in cui questa schermata
  // potrebbe mentire — che sono gli stessi tre che le regole 3 e 7 vietano.
  const leggi = (percorso: string) => soloCodice(readFileSync(join(RADICE, percorso), 'utf8'));
  const modaleCollega = leggi('frontend/src/components/documenti/ModaleCollegaDocumento.tsx');
  const nonCollocati = leggi('frontend/src/components/documenti/ElencoNonCollocati.tsx');
  const pagina = leggi('frontend/src/pages/ArchivioDocumentiPage.tsx');

  it('«nessuna micro-voce» viaggia come null, non come campo omesso', () => {
    // Omettere il campo lascerebbe il documento agganciato com'era: il pulsante direbbe di aver
    // staccato la micro-voce senza staccarla.
    expect(modaleCollega).toMatch(/microvoceProgettoId:\s*microvoceId\s*\|\|\s*null/);
  });

  it('l\'elenco compare solo dopo la risposta del server', () => {
    // `onCollegato`/`onCaricato` sono chiamati dopo l'`await`: nessuna riga che appare prima che
    // il server l'abbia scritta (regola 3).
    expect(modaleCollega).toMatch(/await collegaDocumentoApi\([\s\S]{0,400}?onCollegato\(\)/);
  });

  it('un errore di lettura non diventa «nessun documento sospeso»', () => {
    expect(nonCollocati).toContain('Impossibile leggere i documenti non collocati.');
    expect(nonCollocati).toContain('Ogni documento sta in una cartella');
  });

  it('i conteggi delle cartelle si rileggono dal server dopo uno spostamento', () => {
    // Aggiustarli a mano nello stato locale è il modo in cui si inventano i numeri: dopo la
    // scrittura si richiama `GET /documenti/archivio`.
    expect(pagina).toContain('onArchivioCambiato');
    expect(pagina).toMatch(/useEffect\([\s\S]*?archivioDocumentiApi\(\)[\s\S]*?\}, \[ricaricaArchivio\]\)/);
  });
});
