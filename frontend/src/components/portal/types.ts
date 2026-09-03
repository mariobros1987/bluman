import type { AmbitoFirma, DocumentoPortale } from '../../api/client';
import type { CategoriaModulo } from '../../types';

/** Notifica destinata al cliente, come la mostra la campanella del portale. */
export interface NotificaPortale {
  id: string;
  oggetto: string;
  corpo: string;
  link: string | null;
  tipoEvento: string | null;
  createdAt: string;
  letto: boolean;
}

export interface ModuloPassaggio {
  id: string;
  titolo: string;
  completato: boolean;
  operatore?: string;
  data?: string;
  note?: string;
  documenti?: DocumentoPortale[];
}

export interface ModuloDeliverable {
  id?: string;
  titolo: string;
  nomeFile: string;
  data: string;
  fileUrl?: string | null;
  firmato?: boolean;
  richiedeFirma?: boolean;
  docCompleto?: DocumentoPortale;
}

export interface ModuloProposta {
  id: string;
  nome: string;
  cat: CategoriaModulo;
  prezzo: number;
  ore: number;
  righeCount: number;
  descrizione?: string;
  stato?: 'completato' | 'in_corso' | 'da_firmare' | 'pending';
  operatore?: string;
  percentuale?: number;
  passaggi?: ModuloPassaggio[];
  deliverables?: ModuloDeliverable[];
  richiedeFirmaFinale?: boolean;
}

export type PortalTab = 'proposta' | 'avanzamento' | 'form' | 'documenti' | 'fatture' | 'contatti' | 'profilo';

/**
 * L'atto che il codice OTP sta autorizzando: la lettera d'incarico o un documento del fascicolo.
 * `riferimentoId` è l'id del documento, e finisce nel sigillo a database — senza, una firma non si
 * potrebbe più ricollegare all'atto firmato.
 */
export interface BersaglioFirma {
  ambito: AmbitoFirma;
  titolo: string;
  riferimentoId?: string;
}
