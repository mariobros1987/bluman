/**
 * §1ter.5 (B4) — il calendario parla con le rotte, e non con `localStorage`.
 *
 * Prima di questo file la pagina del calendario e il modale di pianificazione del fascicolo
 * scrivevano in **due archivi locali diversi**, e con due chiavi che non si incontravano mai:
 * `bluman_custom_calendar_events` (senza suffisso di studio, quindi condivisa fra tutti gli
 * studi dello stesso browser) e `bluman_calendar_events` (col suffisso). Il risultato è quello
 * che si vedeva: un'attività pianificata dal fascicolo non compariva nel calendario, un evento
 * scritto nel calendario non esisteva per nessun altro operatore, e una spunta messa il lunedì
 * era tornata su il martedì — perché non era mai stata scritta da nessuna parte.
 *
 * Le funzioni qui sotto sono l'unico punto in cui il frontend tocca `/calendario`. Il tipo
 * `EventoCalendario` rispecchia `EventoVista` di `src/services/calendarioEventi.ts`: se i due
 * divergono, il compilatore non se ne accorge — sono due progetti TypeScript separati — quindi
 * la versione buona è quella del server, e qui si copia.
 */
import { API_BASE, apiFetch, getAuthHeaders, leggiErroreApi } from './http';

/** Le sei categorie. `progetto` è la sesta, aggiunta da §1ter.3 (A6). */
export type CategoriaCalendario =
  | 'microvoce'
  | 'kyc'
  | 'fattura'
  | 'contratto'
  | 'promemoria'
  | 'progetto';

/**
 * Lo stato di un evento: due vocabolari in un campo solo, e la distinzione conta.
 *
 * `da_fare`, `fatto`, `annullato` sono lo stato **scritto** di una riga di tabella, e si cambia
 * con `PATCH /:id/stato`. `scaduta` e `fatta` sono lo stato **calcolato** di una scadenza
 * derivata, che nessuno ha scritto: non si cambia da qui, si cambia nella sua sorgente. La
 * pagina usa questa distinzione per decidere se la spunta è cliccabile — e `generato` per
 * dirlo a chi legge, invece di lasciare il pulsante lì a non fare niente.
 */
export type StatoCalendario = 'da_fare' | 'fatto' | 'annullato' | 'scaduta' | 'fatta';

export interface EventoCalendario {
  /** Prefissato per le derivate (`fattura:<uuid>`), uuid nudo per le righe di tabella. */
  id: string;
  titolo: string;
  dataInizio: string;
  dataFine: string;
  categoria: CategoriaCalendario;
  stato: StatoCalendario;
  priorita: 'alta' | 'media' | 'normale';
  note: string | null;
  luogoUrl: string | null;
  /** Vero per le scadenze dedotte da rate, KYC, progetti e contratti: non si modificano qui. */
  generato: boolean;
  assegnatoAId: string | null;
  assegnatoANome: string | null;
  progettoId: string | null;
  clienteId: string | null;
  clienteNome: string | null;
  /** Solo per le rate: l'importo grezzo in centesimi, da formattare qui. */
  importoCentesimi: number | null;
  /** L'uuid della riga sorgente di una derivata: serve ad aprire la pratica da cui viene. */
  origineId: string | null;
}

/**
 * Quello che il server restituisce leggendo la griglia.
 *
 * `categorie` non è un dettaglio di comodo: sono le categorie che **questo** utente può
 * chiedere, calcolate dal server incrociando ruolo e matrice permessi. È da lì che i filtri si
 * costruiscono — elencare le sei categorie e lasciarne selezionare cinque che tornano sempre
 * vuote è una promessa non mantenuta, e chi la incontra la legge come «non c'è niente in
 * calendario», non come «non ti è consentito».
 */
export interface GrigliaCalendario {
  eventi: EventoCalendario[];
  categorie: CategoriaCalendario[];
}

/** I parametri della lettura. `da` e `a` sono giorni civili `AAAA-MM-GG`. */
export interface ChiediGriglia {
  da: string;
  a: string;
  categorie?: CategoriaCalendario[];
  /** Solo i compiti assegnati a chi chiede. Il server accetta la sola stringa `me`. */
  soloAssegnatiAMe?: boolean;
  /** Restringe a un progetto: è lo scadenzario dentro il fascicolo. */
  progettoId?: string;
}

export async function fetchEventiCalendario(chiedi: ChiediGriglia): Promise<GrigliaCalendario> {
  const q = new URLSearchParams({ da: chiedi.da, a: chiedi.a });
  if (chiedi.categorie && chiedi.categorie.length > 0) q.set('categorie', chiedi.categorie.join(','));
  if (chiedi.soloAssegnatiAMe) q.set('assegnatiA', 'me');
  if (chiedi.progettoId) q.set('progettoId', chiedi.progettoId);

  const res = await apiFetch(`${API_BASE}/calendario/eventi?${q.toString()}`, {
    headers: intestazioni(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Lettura del calendario non riuscita'));
  const corpo = await res.json();
  return {
    eventi: Array.isArray(corpo?.eventi) ? corpo.eventi : [],
    categorie: Array.isArray(corpo?.categorie) ? corpo.categorie : [],
  };
}

/** Quello che serve per scrivere un promemoria o una scadenza contrattuale a mano. */
interface EventoScrittoAMano {
  titolo: string;
  dataInizio: string;
  dataFine?: string;
  priorita?: 'alta' | 'media' | 'normale';
  note?: string | null;
  luogoUrl?: string | null;
  clienteId?: string | null;
  progettoId?: string | null;
  /** Chi deve **fare** il compito. Distinto da chi scrive la riga. */
  assegnatoAId?: string | null;
}

/**
 * Un evento nuovo, nelle due forme che la rotta accetta.
 *
 * È un'unione e non un'interfaccia con `microvoceProgettoId?: string | null`, perché la rotta
 * rifiuta con 400 una `microvoce` senza il suo compito: se il tipo lo rendesse facoltativo, il
 * compilatore lascerebbe scrivere la chiamata che il server boccia, e la scoperta arriverebbe
 * dall'utente invece che da `tsc`. La regola sta in un posto solo — `src/routes/calendario.ts` —
 * e questo tipo la ripete perché il browser possa applicarla **prima** della richiesta.
 *
 * Le categorie derivate (`kyc`, `fattura`, `progetto`) non compaiono qui di proposito: le calcola
 * il server dalle loro sorgenti, e scriverne una a mano creerebbe una seconda verità sullo stesso
 * fatto.
 */
export type NuovoEvento =
  | (EventoScrittoAMano & { categoria: 'promemoria' | 'contratto' })
  | (EventoScrittoAMano & {
      categoria: 'microvoce';
      /** Obbligatorio: è il filo che tiene l'evento agganciato al fascicolo. */
      microvoceProgettoId: string;
    });


/**
 * Crea un evento.
 *
 * Restituisce l'id della riga scritta, non un booleano: chi chiama deve poterla ritrovare dopo
 * il ricaricamento, e un «ok» che non dice quale riga è stata creata lascerebbe
 * l'interfaccia a indovinare — cioè a mostrare l'evento che si aspetta di aver creato.
 */
export async function creaEventoCalendario(evento: NuovoEvento): Promise<string> {
  const res = await apiFetch(`${API_BASE}/calendario/eventi`, {
    method: 'POST',
    headers: intestazioni(),
    body: JSON.stringify(evento),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Creazione dell\'evento non riuscita'));
  const corpo = await res.json();
  const id = corpo?.id;
  if (typeof id !== 'string' || id === '') {
    throw new Error('Il server ha accettato l\'evento senza restituirne l\'identificativo.');
  }
  return id;
}

/**
 * Cambia lo stato di un evento scritto a mano: è la spunta della lista.
 *
 * Il vocabolario è quello del server (`da_fare`/`fatto`/`annullato`) e **non** quello che la
 * pagina usava prima (`pending`/`done`). La differenza non era cosmetica: la spunta cambiava lo
 * stato solo dentro il `useState`, e il primo ricaricamento la riportava indietro.
 * Restituisce lo stato che il server dichiara di aver scritto, che è l'unico dei due che
 * sopravvive a un ricaricamento.
 */
export async function aggiornaStatoEvento(id: string, stato: 'da_fare' | 'fatto' | 'annullato'): Promise<StatoCalendario> {
  const res = await apiFetch(`${API_BASE}/calendario/eventi/${encodeURIComponent(id)}/stato`, {
    method: 'PATCH',
    headers: intestazioni(),
    body: JSON.stringify({ stato }),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Cambio di stato non riuscito'));
  const corpo = await res.json();
  return (corpo?.stato as StatoCalendario) ?? stato;
}

/** Cancella un evento scritto a mano. Una scadenza derivata non si cancella: vedi la rotta. */
export async function eliminaEventoCalendario(id: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/calendario/eventi/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: intestazioni(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Cancellazione non riuscita'));
}

/**
 * §1ter.6 (C5) — un compito assegnato: una micro-voce che ho addosso.
 *
 * `scadenza` è `null` quando il compito non è stato ancora pianificato: la data non sta
 * nella micro-voce, sta nell'evento di calendario che qualcuno ha scritto per lui. Un
 * compito senza data compare ugualmente nella lista, perché «da fare» è un fatto a
 * prescindere da quando.
 */
export interface CompitoAssegnato {
  id: string;
  nome: string;
  stato: string;
  orePreventivate: number;
  oreConsuntivate: number;
  oreResidue: number;
  progettoId: string;
  progettoNome: string;
  moduloProgettoId: string;
  moduloNome: string;
  clienteId: string;
  clienteNome: string;
  /** `YYYY-MM-DD` o `null` se nessuno ha pianificato una data per questo compito. */
  scadenza: string | null;
  eventoId: string | null;
}

/**
 * I compiti assegnati all'utente corrente, dal più urgente.
 *
 * Non accetta un id: è sempre e solo il token che decide di chi sono i compiti,
 * come tutte le rotte di `/calendario`. Un collaboratore non può chiedere i compiti
 * di un altro; un advisor vede solo i propri.
 */
export async function fetchCompitiAssegnati(): Promise<CompitoAssegnato[]> {
  const res = await apiFetch(`${API_BASE}/calendario/compiti`, {
    headers: intestazioni(),
  });
  if (!res.ok) throw new Error(await leggiErroreApi(res, 'Lettura dei compiti non riuscita'));
  const corpo = await res.json();
  return Array.isArray(corpo?.compiti) ? corpo.compiti : [];
}

/**
 * Le intestazioni della richiesta.
 *
 * `apiFetch` non le aggiunge da solo — non è un interceptor — e ogni funzione di questo file le
 * prende da `getAuthHeaders`, che è l'unico posto in cui si sa quale token vale: nel portale è
 * `bluman_portal_token`, nell'area operatore `bluman_jwt_token`. Leggerle qui a mano
 * significherebbe scrivere due volte la stessa regola e sbagliarla in una delle due.
 */
function intestazioni(): Record<string, string> {
  return getAuthHeaders();
}
