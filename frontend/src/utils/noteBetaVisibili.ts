// Chi vede il pulsante 📝 delle note della beta: chi lavora nello studio, finché lo studio non lo spegne dalle
// Impostazioni (chiave «notebeta» fra i moduli in standby). Il cliente del portale non lo vede.
import { getModuliDisattivati } from './tenant';

export const CHIAVE_MODULO_NOTE_BETA = 'notebeta';

export function noteBetaVisibili(user: { ruolo?: string | null } | null | undefined): boolean {
  if (!user || !user.ruolo || user.ruolo === 'cliente') return false;
  return !getModuliDisattivati().includes(CHIAVE_MODULO_NOTE_BETA);
}

/** La raccolta di tutte le note è di chi risponde dello studio (stessa regola del server). */
export function raccoltaNoteBetaVisibile(user: { ruolo?: string | null } | null | undefined): boolean {
  return noteBetaVisibili(user) && (user?.ruolo === 'advisor' || user?.ruolo === 'super_admin');
}
