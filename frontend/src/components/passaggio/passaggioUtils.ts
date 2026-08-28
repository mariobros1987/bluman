import type { Passaggio } from '../../types';

/**
 * §WF-DOC / regola 7 — traduce il `tipoFirma` del sigillo server in etichetta leggibile.
 * Se il server non manda il tipo si restituisce stringa vuota: meglio dire solo
 * "FIRMATO" che affermare una modalità di firma che non risulta agli atti.
 */
export function etichettaTipoFirma(tipoFirma?: string | null): string {
  switch (tipoFirma) {
    case 'fea_otp': return 'firma elettronica semplice con OTP verificata';
    case 'manuale_scansionata': return 'firma autografa scansionata';
    case 'qualificata_esterna': return 'firma digitale qualificata';
    default: return '';
  }
}

// Usa solo lo stato della voce: il numero documenti (`d`) era richiesto nella firma
// ma mai letto, e MicroVoce ora lo dichiara opzionale.
export function getDefaultPassaggi(v: { s: string }): Passaggio[] {
  return [
    { id: 's1', title: 'Informazioni preliminari & Briefing', type: 'info', who: 'operatore', stato: v.s !== 'pending' ? 'done' : 'pending', desc: 'Briefing interno del team prima di avviare l\'attività.' },
    { id: 's2', title: 'Verifica & Documentazione Incarico', type: 'doc', who: 'cliente', stato: 'pending', desc: 'Collega o carica un documento solo se richiesto dall\'attività.', file: undefined },
    { id: 's3', title: 'Dati aggiuntivi dal cliente', type: 'form', who: 'cliente', stato: 'pending', desc: 'Il cliente compila il form con i dati societari.', fields: ['Nome completo', 'Recapito preferito'] },
    { id: 's4', title: 'Conferma e validazione finale', type: 'check', who: 'operatore', stato: v.s === 'done' ? 'done' : 'pending', desc: 'Verifica finale del team prima di chiudere la voce.' },
  ];
}

export const TYPE_LABEL: Record<string, string> = { doc: 'Documento', form: 'Form', info: 'Info', check: 'Verifica' };
export const TYPE_COLOR: Record<string, { bg: string; color: string }> = {
  doc:   { bg: '#1a1f3d', color: '#818cf8' },
  form:  { bg: '#200f40', color: '#a78bfa' },
  info:  { bg: '#1e2030', color: '#94a3b8' },
  check: { bg: '#0d2d22', color: '#34d399' },
};
