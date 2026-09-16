// App in-memory — quick start senza database: usa la stessa logica di dominio già
// testata (istanziaProgetto, stateEngine), con persistenza solo in RAM. Si azzera ad ogni
// riavvio del processo: serve per provare il flusso end-to-end, NON per un uso reale.
// Per la persistenza vera vedi src/adapters/prisma/ (richiede Postgres + `prisma generate`).

import { randomUUID } from 'node:crypto';
import { FakeIstanziazionePort, FakeNotificationPort } from '../services/fakeIstanziazionePort.js';
import { istanziaProgetto, calcolaPrezzoModulo } from '../services/istanziaProgetto.js';
import {
  registraConsuntivazione,
  marcaRitardo,
  risolviRitardo,
  completaMicrovoce as completaMicrovoceService,
  completaPassaggioDocumento as completaPassaggioDocumentoService,
  completaPassaggioForm as completaPassaggioFormService,
  marcaPassaggioCompletato as marcaPassaggioCompletatoService,
} from '../services/esecuzione.js';
import type { ModuloTemplateConDistinta } from '../services/istanziazionePort.js';
import type { AppPort, ModuloElencoItem } from '../services/appPort.js';
import {
  ClienteNonTrovatoError,
  ProgettoNonTrovatoError,
  PreventivoNonTrovatoError,
  ModuloNonTrovatoError,
  TransizioneNonValidaError,
} from './appErrors.js';

export { ClienteNonTrovatoError, ProgettoNonTrovatoError, PreventivoNonTrovatoError, ModuloNonTrovatoError, TransizioneNonValidaError };

export interface Cliente {
  id: string;
  nome: string;
  tipo: 'individual' | 'company';
}

export interface Progetto {
  id: string;
  clienteId: string;
  nome: string;
}

export interface RigaPreventivoInput {
  moduloTemplateId: string;
  moduloTemplateVersione: number;
}

export type StatoPreventivo = 'bozza' | 'inviato' | 'accettato' | 'rifiutato';

export interface Preventivo {
  id: string;
  clienteId: string;
  progettoId: string;
  righe: RigaPreventivoInput[];
  valoreTotale: number;
  stato: StatoPreventivo;
}

export class InMemoryApp implements AppPort {
  private readonly port = new FakeIstanziazionePort();
  private readonly notifiche = new FakeNotificationPort();
  private readonly clienti = new Map<string, Cliente>();
  private readonly progetti = new Map<string, Progetto & { stato: string }>();
  private readonly preventivi = new Map<string, Preventivo>();
  private readonly templates = new Map<string, ModuloTemplateConDistinta>();
  private readonly fatture = new Map<string, any>();

  /** Popola la libreria — equivalente allo script di seed (§27) in questa versione in-memory. */
  registraModuloTemplate(template: ModuloTemplateConDistinta): void {
    this.templates.set(`${template.id}@${template.versione}`, template);
    this.port.registraTemplate(template);
  }

  listaModuli(): ModuloElencoItem[] {
    return [...this.templates.values()].map((m) => ({
      id: m.id,
      versione: m.versione,
      nome: m.nome,
      categoria: m.categoria,
      nArticoli: m.righe.length,
    }));
  }

  creaCliente(input: { nome: string; tipo: 'individual' | 'company' }): Cliente {
    const cliente: Cliente = { id: randomUUID(), nome: input.nome, tipo: input.tipo };
    this.clienti.set(cliente.id, cliente);
    return cliente;
  }

  getCliente(id: string): Cliente {
    const c = this.clienti.get(id);
    if (!c) throw new ClienteNonTrovatoError(`Cliente non trovato: ${id}`);
    return c;
  }

  listaClienti(): Cliente[] {
    return [...this.clienti.values()];
  }

  creaProgetto(input: { clienteId: string; nome: string }): Progetto & { stato: string } {
    this.getCliente(input.clienteId); // lancia se non esiste
    const progetto = { id: randomUUID(), clienteId: input.clienteId, nome: input.nome, stato: 'pre_project' };
    this.progetti.set(progetto.id, progetto);
    return progetto;
  }

  getProgetto(id: string) {
    const p = this.progetti.get(id);
    if (!p) throw new ProgettoNonTrovatoError(`Progetto non trovato: ${id}`);
    const db = this.port.snapshot();
    const moduli = [...db.moduliProgetto.values()].filter((m) => m.progettoId === id);
    const microvoci = [...db.microvociProgetto.values()];
    return {
      ...p,
      moduli: moduli.map((m) => ({
        ...m,
        microvoci: microvoci.filter((v) => v.moduloProgettoId === m.id),
      })),
    };
  }

  listaProgetti() {
    return [...this.progetti.values()].map((p) => ({ id: p.id, clienteId: p.clienteId, nome: p.nome, stato: p.stato }));
  }

  async archiviaProgetto(id: string, archiviato: boolean, _tenantId?: string): Promise<void> {
    const p = this.progetti.get(id);
    if (!p) throw new ProgettoNonTrovatoError();
    p.stato = archiviato ? 'archived' : 'in_progress';
  }

  async eliminaProgetto(id: string, _tenantId?: string): Promise<void> {
    if (!this.progetti.has(id)) throw new ProgettoNonTrovatoError(`Progetto ${id} non trovato in questo studio.`);
    const fattureCount = Array.from(this.fatture.values()).filter(f => (f as any).progettoId === id).length;
    if (fattureCount > 0) {
      throw new TransizioneNonValidaError(`Impossibile eliminare il progetto perché contiene ${fattureCount} Fatture / Note di Credito. È necessario archiviarlo.`);
    }
    this.progetti.delete(id);
  }

  async listaFattureTutte(): Promise<any[]> {
    return Array.from(this.fatture.values());
  }

  /** §15.2 — crea un preventivo, calcolando valore_totale dai moduli selezionati. */
  creaPreventivo(input: { clienteId: string; progettoId: string; righe: RigaPreventivoInput[] }): Preventivo {
    this.getCliente(input.clienteId);
    this.getProgetto(input.progettoId);
    if (input.righe.length === 0) throw new Error('Un preventivo deve avere almeno una riga');

    let valoreTotale = 0;
    for (const riga of input.righe) {
      const t = this.templates.get(`${riga.moduloTemplateId}@${riga.moduloTemplateVersione}`);
      if (!t) throw new ModuloNonTrovatoError(`Modulo non trovato in libreria: ${riga.moduloTemplateId}@${riga.moduloTemplateVersione}`);
      valoreTotale += calcolaPrezzoModulo(t);
    }

    const preventivo: Preventivo = {
      id: randomUUID(),
      clienteId: input.clienteId,
      progettoId: input.progettoId,
      righe: input.righe,
      valoreTotale,
      stato: 'bozza',
    };
    this.preventivi.set(preventivo.id, preventivo);
    return preventivo;
  }

  getPreventivo(id: string): Preventivo {
    const p = this.preventivi.get(id);
    if (!p) throw new PreventivoNonTrovatoError(`Preventivo non trovato: ${id}`);
    return p;
  }

  inviaPreventivo(id: string): Preventivo {
    const p = this.getPreventivo(id);
    if (p.stato !== 'bozza') throw new TransizioneNonValidaError(`Solo un preventivo in bozza può essere inviato (stato attuale: ${p.stato})`);
    const aggiornato = { ...p, stato: 'inviato' as const };
    this.preventivi.set(id, aggiornato);
    return aggiornato;
  }

  /**
   * §15.2/§15.3 — accetta il preventivo e avvia l'istanziazione del progetto.
   * Semplificazione dichiarata per questa versione quick-start: l'engagement letter e la
   * firma digitale (§15.2, §22) sono qui uno stub che "firma" immediatamente, invece del
   * flusso reale a due passaggi (invia-per-firma → webhook-firma). Il motivo è che non
   * esiste ancora un provider di firma reale collegato (decisione ancora aperta, §22) —
   * ma la parte che conta davvero, l'istanziazione (§15.3), è quella vera e già testata.
   */
  async accettaPreventivoEIstanzia(id: string) {
    const p = this.getPreventivo(id);
    if (p.stato !== 'bozza' && p.stato !== 'inviato') {
      throw new TransizioneNonValidaError(`Preventivo in stato ${p.stato} non può essere accettato`);
    }

    // Prima l'istanziazione, poi il passaggio di stato: se l'istanziazione lancia, il
    // preventivo non risulta mai «accettato» senza moduli (stessa proprietà della porta
    // Prisma, che fa le due cose in un'unica transazione).
    const risultato = await istanziaProgetto(
      { progettoId: p.progettoId, clienteId: p.clienteId, righe: p.righe },
      this.port,
      this.notifiche,
    );

    this.preventivi.set(id, { ...p, stato: 'accettato' });
    const progetto = this.progetti.get(p.progettoId)!;
    this.progetti.set(p.progettoId, { ...progetto, stato: 'in_progress' });

    return { preventivo: this.preventivi.get(id)!, ...risultato };
  }

  notificheInviate() {
    return this.notifiche.chiamate;
  }

  // ── §17 — Esecuzione: deleghe dirette al motore già testato in esecuzione.ts ──────────

  async consuntivaMicrovoce(input: { microvoceId: string; oreAggiunte: number; completa?: boolean }): Promise<void> {
    await registraConsuntivazione(input.microvoceId, input.oreAggiunte, this.port);
    if (input.completa) {
      await completaMicrovoceService(input.microvoceId, this.port);
    }
  }

  async marcaRitardoMicrovoce(microvoceId: string, stato: 'delayed' | 'blocked', causaNota: string): Promise<void> {
    await marcaRitardo(microvoceId, stato, causaNota, this.port);
  }

  async risolviRitardoMicrovoce(microvoceId: string): Promise<void> {
    await risolviRitardo(microvoceId, this.port);
  }

  async completaMicrovoce(microvoceId: string): Promise<void> {
    await completaMicrovoceService(microvoceId, this.port);
  }

  async getMicrovoce(microvoceId: string) {
    return this.port.getMicrovoce(microvoceId);
  }

  async getPassaggiDellaMicrovoce(microvoceId: string) {
    return this.port.getPassaggiDellaMicrovoce(microvoceId);
  }

  async completaPassaggioDocumento(passaggioId: string): Promise<void> {
    await completaPassaggioDocumentoService(passaggioId, this.port);
  }

  async completaPassaggioForm(passaggioId: string): Promise<void> {
    await completaPassaggioFormService(passaggioId, this.port);
  }

  async marcaPassaggioCompletato(passaggioId: string): Promise<void> {
    await marcaPassaggioCompletatoService(passaggioId, this.port);
  }

  listaArticoli(): unknown[] {
    return [];
  }

  creaArticolo(input: any): unknown {
    return { id: randomUUID(), ...input };
  }

  creaModuloTemplate(input: any): unknown {
    return { id: randomUUID(), ...input };
  }

  aggiornaModuloTemplate(id: string, input: any): unknown {
    return { id, ...input };
  }

  disattivaModuloTemplate(id: string): unknown {
    return { ok: true, id, isAttivo: false };
  }

  disattivaArticolo(id: string): unknown {
    return { ok: true, id, isAttivo: false };
  }

  async listaAccessiProgetto(_progettoId: string): Promise<unknown[]> {
    return [];
  }

  async assegnaAccessoProgetto(progettoId: string, userId: string, livello: string = 'scrittura'): Promise<unknown> {
    return { id: randomUUID(), progettoId, userId, livello };
  }

  emettiFattura(input: any): unknown {
    return { id: randomUUID(), ...input, stato: 'emessa' };
  }
}
