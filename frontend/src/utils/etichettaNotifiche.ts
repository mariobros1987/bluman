// La pillola in alto a destra: quante notifiche non lette ci sono, e quante di queste sono ritardi.
// Prima diceva «N ritardi» contando TUTTE le non lette: tre «progetto avviato» erano «3 ritardi».
export function etichettaNotificheNonLette(nonLette: number, ritardi: number): string {
  const base = `🔔 ${nonLette} ${nonLette === 1 ? 'notifica' : 'notifiche'} da leggere`;
  if (ritardi <= 0) return base;
  return `${base} · ⚠ ${ritardi} ${ritardi === 1 ? 'ritardo' : 'ritardi'}`;
}
