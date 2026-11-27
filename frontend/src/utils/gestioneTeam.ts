// Chi può gestire chi nella Gestione Team: lo stesso confine che applica il server
// (`utenteGestibile` in `src/routes/tenant.ts`), riportato qui solo per non mostrare pulsanti
// che il server rifiuterebbe sempre. La decisione resta del server.
export function personaGestibileDa(
  ruoloCorrente: string | undefined | null,
  persona: { ruolo?: string | null; tenantId?: string | null },
): boolean {
  if (ruoloCorrente === 'super_admin') return true;
  if (ruoloCorrente !== 'advisor') return false;
  // Il responsabile dello studio non tocca i super admin della piattaforma, né chi non è di uno studio.
  return persona.ruolo !== 'super_admin' && persona.tenantId != null;
}
