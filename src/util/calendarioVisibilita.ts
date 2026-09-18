/**
 * Chi vede quale categoria di evento nel calendario.
 *
 * Perché è un file a parte, e perché è puro. Il calendario è la superficie più delicata
 * dell'applicazione perché **aggrega sorgenti di sensibilità diversa nella stessa griglia**: un
 * rinnovo KYC riguarda l'antiriciclaggio di un cliente, una rata porta un importo, una milestone
 * porta il nome di un progetto e di un cliente, un promemoria personale non riguarda nessun altro.
 * Metterli nella stessa risposta senza filtrare significa che chi vede il calendario vede tutto.
 *
 * La regola che tiene insieme il tutto è una sola: **un evento eredita la visibilità della sua
 * sorgente.** Non esiste un permesso «calendario» — non c'è una chiave `calendar` nella matrice
 * permessi, e non va aggiunta: esiste il permesso sull'oggetto da cui l'evento deriva. Chi non può
 * leggere lo scadenzario non vede le scadenze delle rate, non perché il calendario lo decide, ma
 * perché non può leggere la rata.
 *
 * Questo file risponde a **una** domanda: dato un ruolo e una categoria, questa categoria è
 * visibile? Non risponde a «quali righe»: quello è un secondo filtro, e per `promemoria`,
 * `microvoce` e `progetto` dipende da chi possiede la riga o da `accesso_risorsa`. Tenerli separati
 * è ciò che rende la matrice dei venticinque casi una cosa che si può scrivere in un file di test
 * invece di una cosa che si scopre sbagliata in produzione.
 *
 * Puro significa: nessun `import` di Prisma, nessuna query. La sola dipendenza esterna è il tipo
 * `Ruolo`, che è un tipo — non un database.
 */
import type { Ruolo } from './authorization.js';

/**
 * Le categorie che il calendario può restituire.
 *
 * Non è la stessa lista dell'enum `CategoriaEvento` del database, e la differenza è voluta:
 * `progetto` è una categoria di **presentazione**. La scadenza di un progetto si legge da
 * `Progetto.dataScadenza` a ogni richiesta, non è una riga di `evento_calendario`, ma ha comunque
 * bisogno di un nome con cui essere chiesta da `?categorie=`. Che il database abbia lo stesso
 * valore nell'enum è una coincidenza utile — serve per le righe **generate**, quando la fase C
 * comincerà a scriverne — non un vincolo di questo modulo.
 */
export const CATEGORIE_EVENTO = [
  'promemoria',
  'microvoce',
  'kyc',
  'fattura',
  'contratto',
  'progetto',
] as const;

export type CategoriaEventoCalendario = (typeof CATEGORIE_EVENTO)[number];

export function categoriaValida(valore: unknown): valore is CategoriaEventoCalendario {
  return typeof valore === 'string' && (CATEGORIE_EVENTO as readonly string[]).includes(valore);
}

/**
 * I ruoli interni allo studio.
 *
 * `collaboratore_esterno` **non** è interno, ed è la distinzione che regge metà di questa matrice:
 * un consulente che collabora su una pratica non è un membro dello studio, e le scadenze
 * antiriciclaggio dei clienti, gli importi delle rate e i contratti di consulenza non sono dati di
 * lavoro per lui — sono dati riservati dello studio.
 *
 * `cliente` non è interno a maggior ragione. Ma va detto che per il ruolo `cliente` questa funzione
 * non viene quasi mai chiamata: `server.ts:478-486` nega al JWT cliente ogni rotta fuori da
 * `ROTTE_CLIENTE_CONSENTITE`, e `/calendario/*` non c'è. Il portale del cliente avrà un **proprio**
 * feed, con dentro solo gli appuntamenti che lo riguardano — mai il rinnovo KYC (è una valutazione
 * interna sul rischio del cliente), mai un importo, mai il nome di un altro cliente.
 */
export const RUOLI_INTERNI: readonly Ruolo[] = [
  'super_admin',
  'advisor',
  'collaboratore_interno',
];

export function eRuoloInterno(ruolo: Ruolo): boolean {
  return RUOLI_INTERNI.includes(ruolo);
}

/**
 * I ruoli che vedono **tutti** i progetti dello studio, anche quelli su cui non hanno una riga in
 * `accesso_risorsa`.
 *
 * `collaboratore_interno` non è in questo elenco, e la scelta è deliberata: essere dipendenti dello
 * studio non significa essere sul team di quella pratica. Un collaboratore interno vede i progetti
 * a cui è assegnato, come chiunque altro — e li vede perché qualcuno glieli ha assegnati, che è
 * un'informazione, non un'assenza di informazione.
 */
const RUOLI_SU_TUTTI_I_PROGETTI: readonly Ruolo[] = ['super_admin', 'advisor'];

export function vedeTuttiIProgetti(ruolo: Ruolo): boolean {
  return RUOLI_SU_TUTTI_I_PROGETTI.includes(ruolo);
}

/**
 * Se un ruolo può vedere una categoria, **indipendentemente da quali righe possiede**.
 *
 * Il secondo filtro — quali righe — sta altrove, e per tre categorie è quello che conta:
 * `promemoria` si restringe a `userId === io`, `microvoce` e `progetto` si restringono a
 * `accesso_risorsa`. Questa funzione dice solo se vale la pena guardare.
 *
 * `contabilitaNegata` è l'unico ingresso che non è un ruolo, ed è la parte che rende la regola
 * coerente con il resto dell'applicazione invece che con una tabella scritta a mano. Un evento
 * `fattura` deriva da una rata, cioè da `scadenza_incasso`, cioè dal modulo **scadenzario**: se
 * quello studio ha messo `scadenzario: denied` nella matrice permessi per quell'utente, il
 * calendario non può diventare la porta di servizio da cui quell'utente vede gli importi che gli
 * sono stati esplicitamente tolti. Senza questo ingresso la regola «un evento eredita la visibilità
 * della sua sorgente» sarebbe vera per il ruolo e falsa per la matrice.
 *
 * Il valore arriva da fuori — la rotta legge `PermessoModulo` — perché questo modulo è puro e una
 * query qui la renderebbe non verificabile con una tabella di casi.
 */
export function puoVedereCategoria(
  ruolo: Ruolo,
  categoria: CategoriaEventoCalendario,
  opzioni: { contabilitaNegata?: boolean } = {},
): boolean {
  if (ruolo === 'cliente') return false;

  switch (categoria) {
    // I propri promemoria: li ha scritti l'utente, e li vede solo lui. Vale anche per un
    // collaboratore esterno, che il proprio calendario ce l'ha.
    case 'promemoria':
      return true;

    // Qui il permesso di ruolo è solo il primo cancello; il secondo è `accesso_risorsa`, e sta
    // nella rotta.
    case 'microvoce':
    case 'progetto':
      return true;

    case 'kyc':
    case 'contratto':
      return eRuoloInterno(ruolo);

    case 'fattura':
      return eRuoloInterno(ruolo) && !opzioni.contabilitaNegata;
  }
}

/** Le categorie che un ruolo può vedere, nell'ordine dichiarato in `CATEGORIE_EVENTO`. */
export function categoriePerRuolo(
  ruolo: Ruolo,
  opzioni: { contabilitaNegata?: boolean } = {},
): CategoriaEventoCalendario[] {
  return CATEGORIE_EVENTO.filter((c) => puoVedereCategoria(ruolo, c, opzioni));
}

/**
 * Le risorse su cui un utente ha una riga in `accesso_risorsa`, già **espanse**.
 *
 * L'espansione è la parte che conta e che è facile sbagliare. Una riga di `accesso_risorsa` è su
 * **una** delle tre colonne — progetto, modulo o micro-voce — e il vincolo «esattamente una
 * valorizzata» è dichiarato nello schema. Ma il diritto che quella riga concede risale: chi è su
 * una micro-voce è anche su ciò che la contiene, e chi è su un modulo è anche sul progetto. Se
 * l'espansione non si fa a monte, un evento a livello di progetto risulterebbe invisibile a chi ha
 * accesso a un modulo di quel progetto, che è assurdo.
 *
 * Per questo i tre insiemi sono già appiattiti quando arrivano qui: `progetti` contiene anche i
 * progetti raggiunti attraverso un modulo o una micro-voce. Chi costruisce questo oggetto legge il
 * database; questo file no.
 */
export interface AccessiUtente {
  progetti: ReadonlySet<string>;
  moduli: ReadonlySet<string>;
  microvoci: ReadonlySet<string>;
}

export const NESSUN_ACCESSO: AccessiUtente = {
  progetti: new Set<string>(),
  moduli: new Set<string>(),
  microvoci: new Set<string>(),
};

/** Se l'utente è sul progetto. Gli insiemi sono già espansi: basta guardare `progetti`. */
export function accessiCopronoProgetto(accessi: AccessiUtente, progettoId: string | null): boolean {
  return progettoId !== null && accessi.progetti.has(progettoId);
}

/**
 * Se l'utente è sulla micro-voce, o su una delle due cose che la contengono.
 *
 * Il verso è: dal basso verso l'alto. Avere accesso al **progetto** dà accesso a tutte le sue
 * micro-voci, e avere accesso al **modulo** dà accesso alle micro-voci di quel modulo. Non vale il
 * contrario: avere accesso a una micro-voce non dà accesso alle sue sorelle, ed è il motivo per cui
 * una riga di `accesso_risorsa` può esistere a livello di micro-voce.
 */
export function accessiCopronoMicrovoce(
  accessi: AccessiUtente,
  microvoce: {
    progettoId?: string | null;
    moduloProgettoId?: string | null;
    microvoceProgettoId?: string | null;
  },
): boolean {
  const { progettoId, moduloProgettoId, microvoceProgettoId } = microvoce;
  if (microvoceProgettoId && accessi.microvoci.has(microvoceProgettoId)) return true;
  if (moduloProgettoId && accessi.moduli.has(moduloProgettoId)) return true;
  if (progettoId && accessi.progetti.has(progettoId)) return true;
  return false;
}
