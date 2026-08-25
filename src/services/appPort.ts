// Interfaccia comune che il server HTTP usa — non sa (né deve sapere) se sotto c'è
// InMemoryApp (quick start) o PrismaApp (Postgres/Supabase reale, src/adapters/prisma/).
// Stesso principio già applicato a IstanziazionePort: separare l'orchestrazione dal driver.

import type { ModuloTemplateConDistinta } from './istanziazionePort.js';

export interface Cliente {
  id: string;
  nome: string;
  tipo: 'individual' | 'company';
}

export interface ProgettoBase {
  id: string;
  clienteId: string;
  nome: string;
  stato: string;
}

export interface RigaPreventivoInput {
  moduloTemplateId: string;
  moduloTemplateVersione: number;
}

export interface Preventivo {
  id: string;
  clienteId: string;
  progettoId: string;
  righe: RigaPreventivoInput[];
  valoreTotale: number;
  stato: string;
}

export interface ModuloElencoItem {
  id: string;
  versione: number;
  nome: string;
  categoria: string;
  nArticoli: number;
}

export interface ArticoloInput {
  nome: string;
  categoria: string;
  oreDefault: number;
  prezzoDefault: number; // in centesimi
  passaggi?: Array<{ titolo: string; tipo: 'info' | 'documento' | 'form' | 'verifica'; chi: 'operatore' | 'cliente'; descrizione?: string }>;
}

export interface ModuloTemplateInput {
  nome: string;
  categoria: string;
  giurisdizioneId?: string | null; // null = modulo generico, visibile per ogni giurisdizione
  prezzoPacchetto?: number | null; // centesimi
  righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
  dipendenzeDaIds?: string[];
}

export interface EmettiFatturaInput {
  progettoId: string;
  tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
  partitaIva?: string;
  codiceFiscale?: string;
  canale: 'sdi' | 'standard';
  righe: Array<{
    tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
    moduloProgettoId?: string;
    percentuale?: number;
    importo: number; // centesimi
    descrizione: string;
  }>;
}

export interface AppPort {
  listaModuli(): ModuloElencoItem[] | Promise<ModuloElencoItem[]>;
  listaArticoli(): unknown[] | Promise<unknown[]>;
  creaArticolo(input: ArticoloInput): unknown | Promise<unknown>;
  creaModuloTemplate(input: ModuloTemplateInput): unknown | Promise<unknown>;
  aggiornaModuloTemplate(id: string, input: Partial<ModuloTemplateInput>): unknown | Promise<unknown>;
  // §30 — disattivazione, non cancellazione: i progetti e i preventivi già creati
  // continuano a referenziare il template/Articolo, che però sparisce dalla libreria.
  disattivaModuloTemplate(id: string): unknown | Promise<unknown>;
  disattivaArticolo(id: string): unknown | Promise<unknown>;
  creaCliente(input: { nome: string; tipo: 'individual' | 'company' }): Cliente | Promise<Cliente>;
  getCliente(id: string): Cliente | Promise<Cliente>;
  listaClienti(): Cliente[] | Promise<Cliente[]>;
  creaProgetto(input: { clienteId: string; nome: string }): ProgettoBase | Promise<ProgettoBase>;
  getProgetto(id: string): unknown | Promise<unknown>; // forma esatta (con moduli/microvoci) definita dall'implementazione
  listaProgetti(): unknown[] | Promise<unknown[]>;
  archiviaProgetto(id: string, archiviato: boolean): Promise<void>;
  eliminaProgetto(id: string): Promise<void>;
  listaFattureTutte(): Promise<unknown[]>;
  creaPreventivo(input: { clienteId: string; progettoId: string; righe: RigaPreventivoInput[] }): Preventivo | Promise<Preventivo>;
  getPreventivo(id: string): Preventivo | Promise<Preventivo>;
  inviaPreventivo(id: string): Preventivo | Promise<Preventivo>;
  accettaPreventivoEIstanzia(id: string): unknown | Promise<unknown>;
  emettiFattura(input: EmettiFatturaInput): unknown | Promise<unknown>;

  // §17 — esecuzione
  consuntivaMicrovoce(input: { microvoceId: string; oreAggiunte: number; completa?: boolean }): unknown | Promise<unknown>;
  marcaRitardoMicrovoce(microvoceId: string, stato: 'delayed' | 'blocked', causaNota: string): Promise<void>;
  risolviRitardoMicrovoce(microvoceId: string): Promise<void>;
  completaMicrovoce(microvoceId: string): Promise<void>;
  getMicrovoce(microvoceId: string): Promise<unknown>;
  getPassaggiDellaMicrovoce(microvoceId: string): Promise<unknown[]>;
  completaPassaggioDocumento(passaggioId: string): Promise<void>;
  completaPassaggioForm(passaggioId: string): Promise<void>;
  marcaPassaggioCompletato(passaggioId: string): Promise<void>;
}

export {
  ClienteNonTrovatoError,
  ProgettoNonTrovatoError,
  PreventivoNonTrovatoError,
  ModuloNonTrovatoError,
  TransizioneNonValidaError,
} from '../adapters/appErrors.js';

export type { ModuloTemplateConDistinta };
