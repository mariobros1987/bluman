/**
 * Accentratore delle mail — a quale cliente appartiene un messaggio raccolto.
 *
 * Funzione pura: nessuna lettura dal database, riceve già l'elenco dei clienti. Tre criteri, in
 * ordine, e il primo che riconosce **un solo** cliente decide:
 *
 * 1. `alias` — l'indirizzo di consegna porta il `+alias` che lo studio ha dato al cliente
 *    (`Cliente.aliasPosta`). È l'unico criterio certo: l'alias lo generiamo noi ed è nel percorso
 *    di inoltro, non in un testo scritto da terzi.
 * 2. `destinatario` — l'indirizzo del cliente è fra i destinatari. È la forma che ha un inoltro
 *    automatico quando il fornitore di posta non accetta il «+»: il messaggio conserva il
 *    destinatario originale.
 * 3. `mittente` — scrive il cliente, dal suo indirizzo (o inoltra a mano).
 *
 * Se un indirizzo è di due clienti il criterio non decide e si passa al successivo: attribuire a
 * caso mostrerebbe a un fascicolo la posta di un altro. Senza nessun riscontro il messaggio resta
 * `da_smistare` e lo attribuisce un operatore.
 */

export interface IntestazioniConsegna {
  deliveredTo?: string | null;
  xForwardedTo?: string | null;
  xOriginalTo?: string | null;
  to?: string | null;
  cc?: string | null;
}

export interface ClientePerPosta {
  id: string;
  email?: string | null;
  aliasPosta?: string | null;
}

export type CriterioAttribuzione = 'alias' | 'destinatario' | 'mittente';

export interface EsitoAttribuzione {
  clienteId: string | null;
  attribuzione: 'automatica' | 'da_smistare';
  criterio: CriterioAttribuzione | null;
  /** L'intestazione che portava l'alias (`Delivered-To: …`), per capire un inoltro non riconosciuto. */
  consegnatoA: string | null;
}

/** Gli indirizzi contenuti in un'intestazione («Nome <a@b.it>, c@d.it»), minuscoli e senza doppioni. */
export function indirizziIn(valore: string | null | undefined): string[] {
  if (!valore) return [];
  const trovati = valore.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  return [...new Set(trovati)];
}

/** Gli alias (`+alias`) presenti negli indirizzi di un'intestazione. */
export function aliasIn(valore: string | null | undefined): string[] {
  const alias: string[] = [];
  for (const indirizzo of indirizziIn(valore)) {
    const locale = indirizzo.slice(0, indirizzo.indexOf('@'));
    const piu = locale.indexOf('+');
    if (piu >= 0 && piu < locale.length - 1) alias.push(locale.slice(piu + 1));
  }
  return alias;
}

// `Delivered-To` per primo: lo scrive il server che consegna, con l'indirizzo vero di arrivo.
// `To` per ultimo: è l'unico che decide chi scrive.
const ORDINE_ALIAS: ReadonlyArray<readonly [nome: string, leggi: (h: IntestazioniConsegna) => string | null | undefined]> = [
  ['Delivered-To', (h) => h.deliveredTo],
  ['X-Forwarded-To', (h) => h.xForwardedTo],
  ['X-Original-To', (h) => h.xOriginalTo],
  ['To', (h) => h.to],
  ['Cc', (h) => h.cc],
];

function unicoClienteCon(indirizzi: string[], perEmail: Map<string, Set<string>>): string | null {
  const trovati = new Set<string>();
  for (const indirizzo of indirizzi) {
    for (const id of perEmail.get(indirizzo) ?? []) trovati.add(id);
  }
  return trovati.size === 1 ? [...trovati][0]! : null;
}

export function attribuisciMessaggio(input: {
  intestazioni: IntestazioniConsegna;
  mittenteEmail: string;
  clienti: ClientePerPosta[];
}): EsitoAttribuzione {
  const { intestazioni, clienti } = input;

  const perAlias = new Map<string, string>();
  const perEmail = new Map<string, Set<string>>();
  for (const c of clienti) {
    const alias = c.aliasPosta?.trim().toLowerCase();
    if (alias) perAlias.set(alias, c.id);
    const email = c.email?.trim().toLowerCase();
    if (email) {
      const gruppo = perEmail.get(email) ?? new Set<string>();
      gruppo.add(c.id);
      perEmail.set(email, gruppo);
    }
  }

  for (const [nome, leggi] of ORDINE_ALIAS) {
    const valore = leggi(intestazioni);
    for (const alias of aliasIn(valore)) {
      const clienteId = perAlias.get(alias);
      // Un `+qualcosa` che non è un nostro alias (lo mettono anche altri sistemi) non ferma la
      // ricerca: quello buono può stare nell'intestazione successiva.
      if (clienteId) {
        return { clienteId, attribuzione: 'automatica', criterio: 'alias', consegnatoA: `${nome}: ${(valore ?? '').trim()}`.slice(0, 500) };
      }
    }
  }

  const destinatari = [
    ...indirizziIn(intestazioni.to),
    ...indirizziIn(intestazioni.cc),
    ...indirizziIn(intestazioni.xOriginalTo),
  ];
  const perDestinatario = unicoClienteCon(destinatari, perEmail);
  if (perDestinatario) return { clienteId: perDestinatario, attribuzione: 'automatica', criterio: 'destinatario', consegnatoA: null };

  const perMittente = unicoClienteCon(indirizziIn(input.mittenteEmail), perEmail);
  if (perMittente) return { clienteId: perMittente, attribuzione: 'automatica', criterio: 'mittente', consegnatoA: null };

  return { clienteId: null, attribuzione: 'da_smistare', criterio: null, consegnatoA: null };
}

const ALFABETO_ALIAS = 'abcdefghijkmnpqrstuvwxyz23456789'; // senza 0/o e 1/l: un alias si detta anche al telefono

/** Un alias nuovo di 8 caratteri. `casuale` è `crypto.randomInt`: un alias indovinabile farebbe arrivare posta sotto un altro cliente. */
export function nuovoAliasPosta(casuale: (max: number) => number): string {
  let alias = '';
  for (let i = 0; i < 8; i++) alias += ALFABETO_ALIAS[casuale(ALFABETO_ALIAS.length)];
  return alias;
}

/** `raccolta@studio.it` + `k7m2p9xq` → `raccolta+k7m2p9xq@studio.it`. Null se manca un pezzo: mai un indirizzo monco. */
export function indirizzoDiInoltro(indirizzoCasella: string | null | undefined, alias: string | null | undefined): string | null {
  const casella = indirizzoCasella?.trim().toLowerCase();
  if (!casella || !alias) return null;
  const chiocciola = casella.lastIndexOf('@');
  if (chiocciola <= 0 || chiocciola === casella.length - 1) return null;
  return `${casella.slice(0, chiocciola)}+${alias}@${casella.slice(chiocciola + 1)}`;
}
