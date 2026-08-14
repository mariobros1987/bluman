// Interfacce (porte) per la transazione di istanziazione — §15.3 — e per le operazioni
// di esecuzione del progetto — §17 (consuntivazione, ritardo, procedura guidata).
//
// Perché un'interfaccia e non chiamate dirette a Prisma: in questo ambiente `prisma generate`
// non può scaricare gli engine binari (stesso blocco di rete di `prisma validate`, vedi README),
// quindi qualunque codice scritto contro `PrismaClient` non sarebbe type-checkabile né testabile
// qui. Separando l'orchestrazione dietro una porta, la logica — che è la parte delicata, non il
// driver DB — si scrive, si tipizza e si testa per davvero fin da subito. L'adapter Prisma reale
// (che implementa questa stessa interfaccia) è un lavoro meccanico da collegare quando c'è rete.

import type { StatoMicrovoce, StatoModulo } from '../domain/types.js';

export type StatoMicrovoceIniziale = 'pending' | 'attesa_dipendenza';

export interface PassaggioTemplateInput {
  titolo: string;
  tipo: 'info' | 'documento' | 'form' | 'verifica';
  chi: 'operatore' | 'cliente';
  ordine: number;
  descrizione: string | null;
  campiFormJson: unknown | null;
}

export interface RigaDistintaConArticolo {
  id: string; // riga_distinta.id
  articoloId: string;
  articoloVersione: number;
  articoloNome: string;
  quantita: number;
  ordine: number;
  oreEffettive: number; // override_ore ?? articolo.ore_default
  prezzoEffettivo: number; // override_prezzo ?? articolo.prezzo_default
  passaggi: PassaggioTemplateInput[];
}

export interface ModuloTemplateConDistinta {
  id: string;
  versione: number;
  nome: string;
  categoria: string;
  prezzoPacchetto: number | null;
  righe: RigaDistintaConArticolo[];
  dipendenzeDa: string[]; // id di altri modulo_template da cui dipende, §7ter
}

export interface NuovoModuloProgettoInput {
  progettoId: string;
  moduloTemplateId: string;
  moduloTemplateVersione: number;
  nome: string;
  categoria: string;
  prezzo: number;
  orePreventivate: number;
}

export interface NuovaMicrovoceProgettoInput {
  moduloProgettoId: string;
  articoloId: string;
  articoloVersione: number;
  rigaDistintaId: string;
  nome: string;
  orePreventivate: number;
  stato: StatoMicrovoceIniziale;
  ordine: number;
}

export interface NuovoPassaggioProgettoInput extends PassaggioTemplateInput {
  microvoceProgettoId: string;
}

/**
 * Operazioni disponibili DENTRO la transazione di istanziazione.
 * Tutte le scritture avvengono attraverso questa interfaccia: se una fallisce,
 * `eseguiInTransazione` deve garantire che nessuna delle precedenti resti applicata.
 */
export interface IstanziazioneTransazione {
  getModuloTemplateConDistinta(moduloTemplateId: string, versione: number): Promise<ModuloTemplateConDistinta>;
  aggiornaStatoProgetto(progettoId: string, stato: 'in_progress'): Promise<void>;
  creaModuloProgetto(input: NuovoModuloProgettoInput): Promise<string>; // ritorna l'id creato
  creaMicrovoceProgetto(input: NuovaMicrovoceProgettoInput): Promise<string>;
  /** Corregge lo stato iniziale di una micro-voce appena creata (pending → attesa_dipendenza), passo 5 del §15.3. */
  impostaStatoMicrovoceIniziale(microvoceProgettoId: string, stato: StatoMicrovoceIniziale): Promise<void>;
  creaPassaggioProgetto(input: NuovoPassaggioProgettoInput): Promise<void>;
  creaModuloProgettoDipendenza(moduloProgettoId: string, dipendeDaModuloProgettoId: string): Promise<void>;
}

export interface IstanziazionePort {
  /** Atomicità (§15.3): se `fn` lancia un'eccezione, nessuna scrittura fatta al suo interno deve restare applicata. */
  eseguiInTransazione<T>(fn: (tx: IstanziazioneTransazione) => Promise<T>): Promise<T>;
}

export interface NotificationPort {
  notificaProgettoAvviato(input: { progettoId: string; clienteId: string; moduliProgettoIds: string[] }): Promise<void>;
}

// ── §17 — Operazioni di esecuzione (consuntivazione, ritardo, procedura guidata) ──────────
// A differenza di IstanziazionePort, queste sono operazioni su singole righe, non una
// transazione multi-entità: nessun bisogno di un `eseguiInTransazione` dedicato qui.

export interface MicrovoceRecord {
  id: string;
  moduloProgettoId: string;
  stato: StatoMicrovoce;
  orePreventivate: number;
  oreConsuntivate: number;
  causaNota: string | null;
  segnaleRischio: boolean;
  oreExtra: number;
}

export interface ModuloRecord {
  id: string;
  progettoId: string;
  stato: StatoModulo;
}

export interface ModuloConDipendenzeRuntime {
  id: string;
  stato: StatoModulo;
  dipendeDa: string[]; // id di altri ModuloRecord dello stesso progetto
}

export interface PassaggioRecord {
  id: string;
  microvoceProgettoId: string;
  tipo: 'info' | 'documento' | 'form' | 'verifica';
  chi: 'operatore' | 'cliente';
  stato: string; // pending|done
}

export interface EsecuzionePort {
  getMicrovoce(id: string): Promise<MicrovoceRecord>;
  aggiornaMicrovoce(id: string, updates: Partial<Omit<MicrovoceRecord, 'id' | 'moduloProgettoId'>>): Promise<void>;
  getMicrovociDelModulo(moduloProgettoId: string): Promise<MicrovoceRecord[]>;

  getModulo(id: string): Promise<ModuloRecord>;
  aggiornaModulo(id: string, updates: Partial<Pick<ModuloRecord, 'stato'>>): Promise<void>;
  getModuliDelProgettoConDipendenze(progettoId: string): Promise<ModuloConDipendenzeRuntime[]>;

  getPassaggio(id: string): Promise<PassaggioRecord>;
  getPassaggiDellaMicrovoce(microvoceProgettoId: string): Promise<PassaggioRecord[]>;
  aggiornaPassaggio(id: string, updates: Partial<Pick<PassaggioRecord, 'stato'>>): Promise<void>;
}

