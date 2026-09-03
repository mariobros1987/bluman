// Implementazione finta (in-memory) delle porte di istanziazione (§15.3) ed esecuzione
// (§17), per i test — e per il quick start senza database (src/adapters/inMemoryApp.ts).
//
// Simula un comportamento transazionale VERO per l'istanziazione: le scritture fatte
// dentro `eseguiInTransazione` vanno in uno staging separato dal DB "committato"; solo
// se `fn` completa senza lanciare eccezioni lo staging viene fuso nel DB — altrimenti
// viene scartato. Le operazioni di esecuzione (§17) sono invece scritture dirette,
// singole, senza bisogno dello stesso meccanismo (non sono multi-entità come §15.3).

import type {
  IstanziazioneTransazione,
  IstanziazionePort,
  ModuloTemplateConDistinta,
  NuovoModuloProgettoInput,
  NuovaMicrovoceProgettoInput,
  NuovoPassaggioProgettoInput,
  StatoMicrovoceIniziale,
  EsecuzionePort,
  MicrovoceRecord,
  ModuloRecord,
  ModuloConDipendenzeRuntime,
  PassaggioRecord,
} from './istanziazionePort.js';
import type { StatoMicrovoce, StatoModulo } from '../domain/types.js';

let contatoreId = 0;
function nuovoId(prefix: string): string {
  contatoreId += 1;
  return `${prefix}_${contatoreId}`;
}

interface ModuloStored extends NuovoModuloProgettoInput {
  id: string;
  stato: StatoModulo;
}

interface MicrovoceStored {
  id: string;
  moduloProgettoId: string;
  articoloId: string;
  articoloVersione: number;
  rigaDistintaId: string;
  nome: string;
  ordine: number;
  orePreventivate: number;
  oreConsuntivate: number;
  stato: StatoMicrovoce;
  causaNota: string | null;
  segnaleRischio: boolean;
  oreExtra: number;
}

interface PassaggioStored extends NuovoPassaggioProgettoInput {
  id: string;
  stato: string; // pending|done
}

interface DbState {
  progettiStato: Map<string, string>;
  preventiviStato: Map<string, string>;
  moduliProgetto: Map<string, ModuloStored>;
  microvociProgetto: Map<string, MicrovoceStored>;
  passaggiProgetto: Map<string, PassaggioStored>;
  dipendenze: Array<{ moduloProgettoId: string; dipendeDaModuloProgettoId: string }>;
}

function dbVuoto(): DbState {
  return {
    progettiStato: new Map(),
    preventiviStato: new Map(),
    moduliProgetto: new Map(),
    microvociProgetto: new Map(),
    passaggiProgetto: new Map(),
    dipendenze: [],
  };
}

function clonaDb(db: DbState): DbState {
  return {
    progettiStato: new Map(db.progettiStato),
    preventiviStato: new Map(db.preventiviStato),
    moduliProgetto: new Map(db.moduliProgetto),
    microvociProgetto: new Map(db.microvociProgetto),
    passaggiProgetto: new Map(db.passaggiProgetto),
    dipendenze: [...db.dipendenze],
  };
}

export class FakeIstanziazionePort implements IstanziazionePort, EsecuzionePort {
  private db: DbState = dbVuoto();
  private templates = new Map<string, ModuloTemplateConDistinta>();

  /** Popola la libreria finta per i test — equivalente a seed di articolo/modulo_template/riga_distinta. */
  registraTemplate(template: ModuloTemplateConDistinta): void {
    this.templates.set(`${template.id}@${template.versione}`, template);
  }

  /** Stato di un preventivo committato (per le asserzioni dei test); null se mai toccato. */
  statoPreventivo(preventivoId: string): string | null {
    return this.db.preventiviStato.get(preventivoId) ?? null;
  }

  /** Permette a un test di forzare un errore a un certo punto, per verificare il rollback. */
  guastaAllaCreazioneMicrovoce: string | null = null; // nome articoloId su cui far fallire

  snapshot(): DbState {
    return clonaDb(this.db);
  }

  async eseguiInTransazione<T>(fn: (tx: IstanziazioneTransazione) => Promise<T>): Promise<T> {
    const staging = clonaDb(this.db);
    const tx = this.creaTransazione(staging);
    const risultato = await fn(tx); // se lancia, lo staging viene scartato: il DB reale non cambia
    this.db = staging; // commit
    return risultato;
  }

  private creaTransazione(staging: DbState): IstanziazioneTransazione {
    return {
      getModuloTemplateConDistinta: async (id, versione) => {
        const t = this.templates.get(`${id}@${versione}`);
        if (!t) throw new Error(`Template non trovato: ${id}@${versione}`);
        return t;
      },
      aggiornaStatoProgetto: async (progettoId, stato) => {
        staging.progettiStato.set(progettoId, stato);
      },
      marcaAccettatoPreventivo: async (preventivoId) => {
        staging.preventiviStato.set(preventivoId, 'accettato');
      },
      creaModuloProgetto: async (input) => {
        const id = nuovoId('modprog');
        staging.moduliProgetto.set(id, { ...input, id, stato: 'pending' });
        return id;
      },
      creaMicrovoceProgetto: async (input: NuovaMicrovoceProgettoInput) => {
        if (this.guastaAllaCreazioneMicrovoce && input.articoloId === this.guastaAllaCreazioneMicrovoce) {
          throw new Error(`Guasto simulato alla creazione della micro-voce per articolo ${input.articoloId}`);
        }
        const id = nuovoId('microvoce');
        staging.microvociProgetto.set(id, {
          ...input,
          id,
          oreConsuntivate: 0,
          causaNota: null,
          segnaleRischio: false,
          oreExtra: 0,
        });
        return id;
      },
      impostaStatoMicrovoceIniziale: async (microvoceProgettoId, stato: StatoMicrovoceIniziale) => {
        const mv = staging.microvociProgetto.get(microvoceProgettoId);
        if (!mv) throw new Error(`Micro-voce non trovata: ${microvoceProgettoId}`);
        staging.microvociProgetto.set(microvoceProgettoId, { ...mv, stato });
      },
      creaPassaggioProgetto: async (input) => {
        const id = nuovoId('passaggio');
        staging.passaggiProgetto.set(id, { ...input, id, stato: 'pending' });
      },
      creaModuloProgettoDipendenza: async (moduloProgettoId, dipendeDaModuloProgettoId) => {
        staging.dipendenze.push({ moduloProgettoId, dipendeDaModuloProgettoId });
      },
    };
  }

  // ── EsecuzionePort — §17: scritture dirette, non transazionali (operazioni su singola riga) ──

  async getMicrovoce(id: string): Promise<MicrovoceRecord> {
    const mv = this.db.microvociProgetto.get(id);
    if (!mv) throw new Error(`Micro-voce non trovata: ${id}`);
    return mv;
  }

  async aggiornaMicrovoce(id: string, updates: Partial<Omit<MicrovoceRecord, 'id' | 'moduloProgettoId'>>): Promise<void> {
    const mv = this.db.microvociProgetto.get(id);
    if (!mv) throw new Error(`Micro-voce non trovata: ${id}`);
    this.db.microvociProgetto.set(id, { ...mv, ...updates });
  }

  async getMicrovociDelModulo(moduloProgettoId: string): Promise<MicrovoceRecord[]> {
    return [...this.db.microvociProgetto.values()].filter((m) => m.moduloProgettoId === moduloProgettoId);
  }

  async getModulo(id: string): Promise<ModuloRecord> {
    const m = this.db.moduliProgetto.get(id);
    if (!m) throw new Error(`Modulo non trovato: ${id}`);
    return { id: m.id, progettoId: m.progettoId, stato: m.stato };
  }

  async aggiornaModulo(id: string, updates: Partial<Pick<ModuloRecord, 'stato'>>): Promise<void> {
    const m = this.db.moduliProgetto.get(id);
    if (!m) throw new Error(`Modulo non trovato: ${id}`);
    this.db.moduliProgetto.set(id, { ...m, ...updates });
  }

  async getModuliDelProgettoConDipendenze(progettoId: string): Promise<ModuloConDipendenzeRuntime[]> {
    const moduli = [...this.db.moduliProgetto.values()].filter((m) => m.progettoId === progettoId);
    return moduli.map((m) => ({
      id: m.id,
      stato: m.stato,
      dipendeDa: this.db.dipendenze.filter((d) => d.moduloProgettoId === m.id).map((d) => d.dipendeDaModuloProgettoId),
    }));
  }

  async getPassaggio(id: string): Promise<PassaggioRecord> {
    const p = this.db.passaggiProgetto.get(id);
    if (!p) throw new Error(`Passaggio non trovato: ${id}`);
    return p;
  }

  async getPassaggiDellaMicrovoce(microvoceProgettoId: string): Promise<PassaggioRecord[]> {
    return [...this.db.passaggiProgetto.values()].filter((p) => p.microvoceProgettoId === microvoceProgettoId);
  }

  async aggiornaPassaggio(id: string, updates: Partial<Pick<PassaggioRecord, 'stato'>>): Promise<void> {
    const p = this.db.passaggiProgetto.get(id);
    if (!p) throw new Error(`Passaggio non trovato: ${id}`);
    this.db.passaggiProgetto.set(id, { ...p, ...updates });
  }

  async getProgetto(id: string): Promise<{ id: string; stato: string } | null> {
    const stato = this.db.progettiStato.get(id);
    if (!stato) return null;
    return { id, stato };
  }

  async aggiornaProgetto(id: string, updates: { stato: string }): Promise<void> {
    this.db.progettiStato.set(id, updates.stato);
  }
}

export class FakeNotificationPort {
  chiamate: Array<{ progettoId: string; clienteId: string; moduliProgettoIds: string[] }> = [];
  guasta = false;

  async notificaProgettoAvviato(input: { progettoId: string; clienteId: string; moduliProgettoIds: string[] }): Promise<void> {
    if (this.guasta) throw new Error('Guasto simulato nel servizio notifiche');
    this.chiamate.push(input);
  }
}
