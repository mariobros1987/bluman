/**
 * Chi vede cosa nel calendario: la tabella di §1ter.3, scritta come asserzioni.
 *
 * Il piano chiedeva «venticinque asserzioni, cinque ruoli per cinque categorie». Le categorie sono
 * diventate sei — la fine di un progetto si è aggiunta perché era una delle due cose che l'utente
 * aveva chiesto di aggregare e il piano non le aveva dato una categoria — quindi sono **trenta**.
 * Il numero conta meno della proprietà che le asserzioni presidiano: che l'insieme dei visibili sia
 * **esattamente** quello scritto, non almeno quello. Un test che asserisse solo i casi positivi
 * passerebbe anche se `puoVedereCategoria` rispondesse sempre `true`, che è il guasto da temere.
 *
 * La matrice sta qui una volta sola, e i test la percorrono. Scriverla come venticinque `it`
 * separati avrebbe prodotto venticinque posti in cui correggere una cella invece di uno.
 *
 * Le asserzioni sono sui **ruoli**, non sulle righe: il secondo cancello — di chi è il promemoria,
 * su quale progetto si ha accesso — non è una proprietà del ruolo e non si può provare qui. Quelle
 * stanno in `src/calendario.test.ts`, dove c'è un finto database su cui far passare le righe.
 */
import { describe, expect, it } from 'vitest';
import { RUOLI, type Ruolo } from './authorization.js';
import {
  CATEGORIE_EVENTO,
  accessiCopronoMicrovoce,
  accessiCopronoProgetto,
  categoriePerRuolo,
  categoriaValida,
  eRuoloInterno,
  NESSUN_ACCESSO,
  puoVedereCategoria,
  vedeTuttiIProgetti,
  type CategoriaEventoCalendario,
} from './calendarioVisibilita.js';

/**
 * La specifica, cella per cella.
 *
 * `true` significa «il ruolo può vedere questa categoria **se** possiede la riga», e per
 * `promemoria`, `microvoce` e `progetto` il «se» è la parte che conta: `true` qui non vuol dire che
 * le veda tutte, vuol dire che il ruolo non è il motivo per cui non le vede.
 */
const MATRICE: Record<Ruolo, Record<CategoriaEventoCalendario, boolean>> = {
  super_admin: {
    promemoria: true, microvoce: true, kyc: true, fattura: true, contratto: true, progetto: true,
  },
  advisor: {
    promemoria: true, microvoce: true, kyc: true, fattura: true, contratto: true, progetto: true,
  },
  collaboratore_interno: {
    promemoria: true, microvoce: true, kyc: true, fattura: true, contratto: true, progetto: true,
  },
  // Il ruolo su cui verte metà di questa matrice. Vede i **propri** promemoria e le pratiche su cui
  // è assegnato — quelle sì, e non perché è un dipendente: perché qualcuno gliele ha assegnate.
  // Non vede il rischio antiriciclaggio dei clienti, non vede gli importi delle rate, non vede i
  // contratti. Sono dati dello studio, e lui nello studio non è.
  collaboratore_esterno: {
    promemoria: true, microvoce: true, kyc: false, fattura: false, contratto: false, progetto: true,
  },
  // Nessuna, mai. Non è una riga di questa matrice che lo tiene fuori: `ROTTE_CLIENTE_CONSENTITE`
  // gli nega `/calendario/*` prima che questa funzione venga chiamata. La riga di zeri è la seconda
  // rete, e serve a che l'ordine dei due controlli non diventi un requisito nascosto: se un domani
  // qualcuno aggiungesse la rotta all'elenco delle consentite, il calendario sarebbe ancora vuoto
  // invece che pieno di dati di tutti.
  cliente: {
    promemoria: false, microvoce: false, kyc: false, fattura: false, contratto: false, progetto: false,
  },
};

describe('la matrice ruolo × categoria', () => {
  for (const ruolo of RUOLI) {
    for (const categoria of CATEGORIE_EVENTO) {
      const atteso = MATRICE[ruolo][categoria];
      it(`${ruolo} ${atteso ? 'vede' : 'non vede'} ${categoria}`, () => {
        expect(puoVedereCategoria(ruolo, categoria)).toBe(atteso);
      });
    }
  }

  it('sono trenta combinazioni, e la matrice le copre tutte', () => {
    const celle = RUOLI.flatMap((r) => CATEGORIE_EVENTO.map((c) => MATRICE[r][c]));
    expect(RUOLI).toHaveLength(5);
    expect(CATEGORIE_EVENTO).toHaveLength(6);
    expect(celle).toHaveLength(RUOLI.length * CATEGORIE_EVENTO.length);
    expect(celle).toHaveLength(30);
  });

  it('il cliente non vede niente, per nessuna categoria', () => {
    const visibili = CATEGORIE_EVENTO.filter((c) => puoVedereCategoria('cliente', c));
    expect(visibili).toEqual([]);
    expect(categoriePerRuolo('cliente')).toEqual([]);
  });
});

describe('il modulo scadenzario toglie le rate anche al ruolo che le vedrebbe', () => {
  it('un collaboratore interno con scadenzario negato non vede le fatture', () => {
    expect(puoVedereCategoria('collaboratore_interno', 'fattura')).toBe(true);
    expect(puoVedereCategoria('collaboratore_interno', 'fattura', { contabilitaNegata: true })).toBe(false);
  });

  it('toglie solo le fatture: il KYC resta, perché non viene dallo scadenzario', () => {
    const visibili = categoriePerRuolo('collaboratore_interno', { contabilitaNegata: true });
    expect(visibili).toContain('kyc');
    expect(visibili).toContain('contratto');
    expect(visibili).not.toContain('fattura');
    expect(visibili).toHaveLength(CATEGORIE_EVENTO.length - 1);
  });

  it('una riga «denied» esplicita toglie le fatture anche all\'advisor', () => {
    // `contabilitaNegata` non è «il ruolo è esterno»: è la riga di `permesso_modulo` **di chi
    // chiede**. Un advisor senza riga non è negato — il valore di partenza è `false`, e
    // l'assenza di una decisione non è una decisione — ma se la riga c'è ed è `denied`, quella
    // è una scelta scritta da qualcuno e vale anche per lui. La differenza fra i due casi è
    // tutta nel primo `expect`, ed è la ragione per cui questo test ne ha due.
    expect(puoVedereCategoria('advisor', 'fattura')).toBe(true);
    expect(puoVedereCategoria('advisor', 'fattura', { contabilitaNegata: true })).toBe(false);
  });
});

describe('interno ed esterno', () => {
  it('i tre ruoli dello studio sono interni, gli altri due no', () => {
    expect(eRuoloInterno('super_admin')).toBe(true);
    expect(eRuoloInterno('advisor')).toBe(true);
    expect(eRuoloInterno('collaboratore_interno')).toBe(true);
    expect(eRuoloInterno('collaboratore_esterno')).toBe(false);
    expect(eRuoloInterno('cliente')).toBe(false);
  });

  it('solo super_admin e advisor vedono tutti i progetti', () => {
    expect(vedeTuttiIProgetti('super_admin')).toBe(true);
    expect(vedeTuttiIProgetti('advisor')).toBe(true);
    // Il collaboratore interno no, ed è la scelta meno ovvia delle tre: essere dipendenti dello
    // studio non mette sul team di ogni pratica.
    expect(vedeTuttiIProgetti('collaboratore_interno')).toBe(false);
    expect(vedeTuttiIProgetti('collaboratore_esterno')).toBe(false);
  });
});

describe('l\'espansione degli accessi risale dal basso verso l\'alto', () => {
  const accessi = {
    progetti: new Set(['prg-1']),
    moduli: new Set(['mod-1']),
    microvoci: new Set(['mv-1']),
  };

  it('una micro-voce è coperta dall\'accesso alla micro-voce stessa', () => {
    expect(accessiCopronoMicrovoce(accessi, { microvoceProgettoId: 'mv-1' })).toBe(true);
  });

  it('una micro-voce è coperta dall\'accesso al suo modulo', () => {
    expect(accessiCopronoMicrovoce(accessi, { moduloProgettoId: 'mod-1' })).toBe(true);
  });

  it('una micro-voce è coperta dall\'accesso al suo progetto', () => {
    expect(accessiCopronoMicrovoce(accessi, { progettoId: 'prg-1' })).toBe(true);
  });

  it('il verso non si inverte: l\'accesso a una micro-voce non copre le sue sorelle', () => {
    // È il motivo per cui una riga di `accesso_risorsa` può esistere a livello di micro-voce: se
    // il diritto risalisse anche verso il basso, assegnare una micro-voce ne assegnerebbe l'intero
    // modulo, e non ci sarebbe modo di assegnarne una sola.
    expect(accessiCopronoMicrovoce(accessi, { microvoceProgettoId: 'mv-99' })).toBe(false);
    expect(accessiCopronoMicrovoce(accessi, { moduloProgettoId: 'mod-99' })).toBe(false);
    expect(accessiCopronoMicrovoce(accessi, { progettoId: 'prg-99' })).toBe(false);
  });

  it('un evento senza nessuna sorgente non è coperto da nessuno', () => {
    expect(accessiCopronoMicrovoce(accessi, {})).toBe(false);
    expect(accessiCopronoMicrovoce(accessi, { progettoId: null, moduloProgettoId: null, microvoceProgettoId: null })).toBe(false);
  });

  it('senza alcun accesso non si copre niente', () => {
    expect(accessiCopronoProgetto(NESSUN_ACCESSO, 'prg-1')).toBe(false);
    expect(accessiCopronoMicrovoce(NESSUN_ACCESSO, { progettoId: 'prg-1' })).toBe(false);
  });

  it('un progetto nullo non è mai coperto, nemmeno da un insieme che contiene la stringa vuota', () => {
    // `null` è un evento che non appartiene a un progetto. Trattarlo come «nessun vincolo» lo
    // mostrerebbe a tutti: è il caso in cui una difesa scritta male apre invece di chiudere.
    expect(accessiCopronoProgetto(accessi, null)).toBe(false);
  });
});

describe('categoriaValida', () => {
  it('riconosce le sei categorie', () => {
    for (const c of CATEGORIE_EVENTO) expect(categoriaValida(c)).toBe(true);
  });

  it('rifiuta il resto, comprese le stringhe che ci somigliano', () => {
    expect(categoriaValida('fatture')).toBe(false);
    expect(categoriaValida('FATTURA')).toBe(false);
    expect(categoriaValida('da_fare')).toBe(false);
    expect(categoriaValida('')).toBe(false);
    expect(categoriaValida(null)).toBe(false);
    expect(categoriaValida(undefined)).toBe(false);
    expect(categoriaValida(42)).toBe(false);
    expect(categoriaValida({ categoria: 'kyc' })).toBe(false);
  });
});
