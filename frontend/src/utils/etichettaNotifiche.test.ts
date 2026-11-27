// Analisi del 26/11 — «⚠ 1 ritardo» compariva su un progetto appena creato: la pillola contava le
// notifiche non lette e le chiamava tutte ritardi.
import { describe, it, expect } from 'vitest';
import { etichettaNotificheNonLette } from './etichettaNotifiche';

describe('etichettaNotificheNonLette', () => {
  it('notifiche che non sono ritardi non vengono chiamate ritardi', () => {
    expect(etichettaNotificheNonLette(3, 0)).toBe('🔔 3 notifiche da leggere');
    expect(etichettaNotificheNonLette(1, 0)).toBe('🔔 1 notifica da leggere');
  });

  it('i ritardi veri si contano a parte', () => {
    expect(etichettaNotificheNonLette(3, 1)).toBe('🔔 3 notifiche da leggere · ⚠ 1 ritardo');
    expect(etichettaNotificheNonLette(4, 2)).toBe('🔔 4 notifiche da leggere · ⚠ 2 ritardi');
  });
});
