// Tipi di dominio — Fase 5 del piano di sviluppo, §16 del documento.

export type StatoMicrovoce = 'pending' | 'attesa_dipendenza' | 'active' | 'delayed' | 'blocked' | 'done';
export type StatoModulo = 'pending' | 'attesa_dipendenza' | 'in_progress' | 'delayed' | 'blocked' | 'done';
export type StatoProgetto = 'pre_project' | 'in_progress' | 'completed';

export interface MicrovoceInput {
  id: string;
  stato: StatoMicrovoce;
  orePreventivate: number;
  oreConsuntivate: number;
}

export interface ModuloInput {
  id: string;
  orePreventivate: number; // somma delle ore preventivate delle sue micro-voci
  microvoci: MicrovoceInput[];
}

export interface ProgettoInput {
  moduli: Array<{ id: string; orePreventivate: number; stato: StatoModulo }>;
}
