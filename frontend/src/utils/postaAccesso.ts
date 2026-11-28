import { getUserPermission, type PermissionLevel } from './rbac';

/** L'utente che ha fatto l'accesso, letto da `bluman_user` come fa il resto dell'app. */
function utenteCorrente(): { ruolo?: string } | null {
  const grezzo = typeof window !== 'undefined' ? localStorage.getItem('bluman_user') : null;
  if (!grezzo) return null;
  try {
    return JSON.parse(grezzo);
  } catch {
    return null;
  }
}

/**
 * Cosa può fare chi guarda con la posta dei clienti: `read` consulta, `write` smista e archivia.
 * Serve a non mostrare pulsanti che l'API rifiuterebbe: il controllo che conta è sul server.
 */
export function permessoPosta(): PermissionLevel {
  return getUserPermission(utenteCorrente(), 'posta');
}

/** Caselle e inoltri li configura solo chi risponde dello studio, come sul server (`soloResponsabili`). */
export function puoConfigurarePosta(): boolean {
  const ruolo = utenteCorrente()?.ruolo;
  return ruolo === 'advisor' || ruolo === 'super_admin';
}
