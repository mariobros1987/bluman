import type { DocumentTemplate } from '../../utils/documentTemplates';
import type { RichiestaModificaDoc } from '../../api/client';

export interface NoteEntry {
  id: string;
  autore: string;
  data: string;
  testo: string;
}

export interface DocumentoEntry {
  id: string;
  nome: string;
  dimensione: string;
  richiedeFirma: boolean;
  /** Piano firma §3 — livello (ses|fea|feq) che il documento esige; default 'ses'. */
  livelloFirmaRichiesto?: 'ses' | 'fea' | 'feq';
  firmato: boolean;
  dataCaricamento: string;
  templateId?: string;
  statoDoc?: 'bozza' | 'pubblicato' | 'in_revisione' | 'firmato';
  versione?: number;
  pubblicatoAt?: string | null;
  fileUrl?: string;
  /** §Punto-1 — URL del PDF master generato dal motore server-side. */
  filePdfUrl?: string | null;
  /** §Punto-1 — URL del Word (.docx) generato dal motore server-side; null se assente. */
  fileDocxUrl?: string | null;
  richiesteModifica?: RichiestaModificaDoc[];
  /**
   * §WF-DOC — sigillo di firma restituito dal server (data, id firma, tipo).
   * Serve per mostrare all'operatore *quando* e *come* il cliente ha firmato:
   * prima l'app diceva solo "FIRMATO" e la data era leggibile solo nel portale.
   * Non viene mai ricostruito lato client: se il server non lo manda, non si mostra.
   */
  firma?: { riferimentoId: string | null; firmatoAt: string | null; signatureId: string | null; tipoFirma: string | null; valoreLegale?: string | null } | null;
}

export interface ConfigFirmaModalState {
    open: boolean;
    tmpl?: DocumentTemplate;
    file?: File;
    fileBase64?: string;
    stepId?: string;
    titolo: string;
    richiedeFirma: boolean;
    /**
     * Piano firma §3 — livello legale (ses|fea|feq) che questo documento esige dal cliente.
     * Sceglierlo è responsabilità dell'operatore; di default resta 'ses' (comportamento storico).
     * Il server lo copia sul documento e lo fa rispettare al momento della firma (409 onesto).
     */
    livelloFirmaRichiesto: 'ses' | 'fea' | 'feq';
    metodoFirma: 'fea_otp' | 'manuale_scansionata' | 'qualificata_esterna' | 'tutte';
    statoDoc: 'bozza' | 'pubblicato';
    dataScadenzaDoc: string;
}
