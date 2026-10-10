// Voce 8-bis — le rotte della copia off-site del backup.
//
// Due chiamate distinte e non una, perché i due lettori sono diversi: il super admin vede e
// configura la credenziale (`/admin/backup`), il titolare dello studio vede solo la freschezza
// (`/tenant/backup`). Nessuna delle due restituisce **mai** il token: si legge solo se c'è stato
// salvato e quando, come per la password del responsabile (§23).
//
// Nessun ripiego silenzioso: se il server non risponde, lo si dice. Uno stato della copia
// inventato è peggio di uno stato mancante — è un «tutto a posto» che nessuno ha verificato.

import { API_BASE, apiFetch, erroreDellaRisposta, getAuthHeaders } from './http';
import type { EsitoBackupFile, EsitoVerificaFile, StatoCopia } from '../utils/backupStato';

export interface StatoBackupAdmin extends StatoCopia {
  /** I due percorsi: su un backend che non fa i backup non esistono, e vederli è il modo in cui
   *  ci si accorge di star configurando la macchina sbagliata. */
  cartellaConfigurazione: string;
  cartellaStato: string;
  configurazioneDisponibile: boolean;
  statoDisponibile: boolean;
  /** La destinazione rclone (`dropbox:bluman-backup`). Non è un segreto: sta nel `.env`. */
  destinazione: string | null;
  configurato: boolean;
  configuratoIl: string | null;
  backup: EsitoBackupFile;
  verifica: EsitoVerificaFile;
}

export async function fetchStatoBackupAdminApi(): Promise<StatoBackupAdmin> {
  const res = await apiFetch(`${API_BASE}/admin/backup`, { headers: getAuthHeaders() });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Stato del backup non disponibile');
  return await res.json();
}

export async function salvaTokenBackupApi(token: string): Promise<{ messaggio?: string; configuratoIl: string | null }> {
  const res = await apiFetch(`${API_BASE}/admin/backup/token`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Salvataggio della credenziale non riuscito');
  return await res.json();
}

export async function disattivaTokenBackupApi(): Promise<{ rimosso: boolean }> {
  const res = await apiFetch(`${API_BASE}/admin/backup/token`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw await erroreDellaRisposta(res, 'Rimozione della credenziale non riuscita');
  return await res.json();
}

export async function fetchStatoBackupTitolareApi(): Promise<StatoCopia> {
  const res = await apiFetch(`${API_BASE}/tenant/backup`, { headers: getAuthHeaders() });
  // L'errore conserva lo `status`: chi chiama deve poter distinguere un 403 (questo ruolo non
  // vede la freschezza, e va bene così) da un guasto vero, che invece va detto.
  if (!res.ok) throw await erroreDellaRisposta(res, 'Stato della copia di sicurezza non disponibile');
  return await res.json();
}

/** I byte in una forma leggibile: `1,2 GB`. Un dump può pesare molto e un numero nudo non dice
 *  niente a chi legge. */
export function formattaByte(byte: number | null): string | null {
  if (byte === null || !Number.isFinite(byte) || byte <= 0) return null;
  const unita = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valore = byte;
  let i = 0;
  while (valore >= 1024 && i < unita.length - 1) {
    valore /= 1024;
    i += 1;
  }
  return `${valore.toLocaleString('it-IT', { maximumFractionDigits: valore < 10 ? 1 : 0 })} ${unita[i]}`;
}
