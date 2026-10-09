// Test del presidio client-side che nasconde il fascicolo comunicazioni a chi la matrice lo nega.
//
// Perché esiste: dal 09/10/2026 la matrice governa anche la LETTURA della casella, non solo
// l'invio (voce 4). Il presidio server è quello che conta — `haAccessoComunicazioni` non protegge
// niente, evita solo di mostrare schede e linguette che risponderebbero 403. Il test fissa che
// legga la stessa fonte di `getUserPermission` (`bluman_user` + matrice) e che il verso del
// default sia quello del ruolo, non «aperto».
import { describe, it, expect, beforeEach } from 'vitest';
import { haAccessoComunicazioni } from './comunicazioniAccesso';
import { getTenantStorageKey } from './tenant';

const ADVISOR = { id: 'usr-1', email: 'advisor@studio.it', ruolo: 'advisor' };
const COLLABORATORE = { id: 'usr-2', email: 'collab@studio.it', ruolo: 'collaboratore_interno' };
const ESTERNO = { id: 'usr-3', email: 'esterno@studio.it', ruolo: 'collaboratore_esterno' };

function accediCome(utente: unknown) {
  localStorage.setItem('bluman_user', JSON.stringify(utente));
}

describe('haAccessoComunicazioni — presidio della scheda Comunicazioni', () => {
  beforeEach(() => localStorage.clear());

  it('senza utente in localStorage l\'accesso è negato', () => {
    // Non è un caso teorico: è lo stato di un caricamento a metà o di uno storage svuotato.
    // Il verso giusto è «niente scheda» — lato server la richiesta sarebbe 401 comunque.
    expect(haAccessoComunicazioni()).toBe(false);
  });

  it('un bluman_user illeggibile non apre la scheda invece di far esplodere la pagina', () => {
    localStorage.setItem('bluman_user', '{questo non è json');
    expect(haAccessoComunicazioni()).toBe(false);
  });

  it('i ruoli operativi hanno il fascicolo: communications è nel loro default', () => {
    accediCome(ADVISOR);
    expect(haAccessoComunicazioni()).toBe(true);
    accediCome(COLLABORATORE);
    expect(haAccessoComunicazioni()).toBe(true);
    accediCome(ESTERNO);
    expect(haAccessoComunicazioni()).toBe(true);
  });

  it('la matrice dello studio vince sul default: «denied» toglie la scheda a chi l\'avrebbe', () => {
    accediCome(COLLABORATORE);
    // È il caso vero della voce 4: l'admin ha negato `communications` a un collaboratore che per
    // ruolo l'avrebbe. Prima del 09/10/2026 la scheda gli restava, e la lettura passava dal server.
    localStorage.setItem(
      getTenantStorageKey(`bluman_rbac_permissions_${COLLABORATORE.email}`),
      JSON.stringify([{ moduloChiave: 'communications', livello: 'denied' }]),
    );
    expect(haAccessoComunicazioni()).toBe(false);
  });

  it('«read» lascia la scheda: si consulta la conversazione', () => {
    accediCome(COLLABORATORE);
    localStorage.setItem(
      getTenantStorageKey(`bluman_rbac_permissions_${COLLABORATORE.email}`),
      JSON.stringify([{ moduloChiave: 'communications', livello: 'read' }]),
    );
    expect(haAccessoComunicazioni()).toBe(true);
  });
});
