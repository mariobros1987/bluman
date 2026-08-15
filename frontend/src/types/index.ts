// BluMan — Shared TypeScript types

export type StatoProgetto = 'pre_project' | 'in_progress' | 'completed' | 'archived';
export type StatoModulo   = 'pending' | 'attesa_dipendenza' | 'in_progress' | 'delayed' | 'blocked' | 'done';
export type StatoMicrovoce = 'pending' | 'attesa_dipendenza' | 'active' | 'delayed' | 'blocked' | 'done';
export type TipoCliente   = 'individual' | 'company';
export type CategoriaModulo = 'Analisi' | 'Societario' | 'Trust' | 'Banking' | 'Fiscale' | 'Legale' | 'IP' | 'Compliance';

export interface Cliente {
  id: string;
  nome: string;
  tipo: TipoCliente;
  email?: string;
  partitaIva?: string;
  codiceFiscale?: string;
}

export interface TeamMember {
  id: number;
  n: string;
  r: string;
  i: string;
  c: string;
}

export interface MicroVoce {
  n: string;
  hE: number; // ore estimate
  hA: number; // ore actual
  s: StatoMicrovoce;
  as: number; // assignee id
  d: number;  // documents count
  vn?: string; // nota ritardo
  proc?: Passaggio[];
}

export interface Passaggio {
  id: string;
  title: string;
  type: 'doc' | 'form' | 'info' | 'check';
  who: 'operatore' | 'cliente';
  stato: 'pending' | 'done';
  desc?: string;
  file?: string | null;
  fileSize?: number;
  fields?: string[];
  documentoAllegatoUrl?: string;
  formMasterId?: string;
  linkIstruzioni?: string;
}

export interface ModuloProgetto {
  id: number;
  n: string;
  cat: CategoriaModulo;
  st: StatoModulo;
  pct: number;
  h: number;
  a: number;
  p: number;
  team: number[];
  delay: boolean;
  dn?: string;
  waitDep?: boolean;
  wdn?: string;
  v: MicroVoce[];
}

export interface FatturaRiga {
  tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
  mid?: number;
  pct?: number;
  importo: number;
  desc: string;
  stato: 'bozza' | 'emessa' | 'incassata';
}

export interface Progetto {
  id: number;
  n: string;
  cl: string;
  ct: TipoCliente;
  st: StatoProgetto;
  pct: number;
  start: string;
  due: string;
  val: number;
  delay: boolean;
  fisc: string;
  fatture: FatturaRiga[];
  mods: ModuloProgetto[];
}

export interface Articolo {
  id: string;
  n: string;
  cat: CategoriaModulo;
  h: number;
  p: number;
  ver: number;
}

export interface RigaDistinta {
  art: string;
  qty?: number;
  oO?: number;
  oP?: number;
}

export interface Giurisdizione {
  id: string;
  nome: string;
  codice: string;
  tipo: 'ue' | 'extra_ue' | 'stato_usa' | 'altro';
  note?: string;
}

export interface ModuloTemplate {
  id: string;
  n: string;
  cat: CategoriaModulo;
  ver: number;
  deps: string[];
  pkg?: number;
  giurisdizioneId?: string | null;
  giurisdizione?: Giurisdizione | null;
  righe: RigaDistinta[];
}
