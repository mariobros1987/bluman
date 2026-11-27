// Il modulo Compliance/KYC è acceso per questo studio? Lo dice il server (`/tenant/moduli`):
// «acceso» vuol dire concesso dalla piattaforma e non messo in standby dallo studio.
//
// Tre risposte, non due: `true`, `false`, oppure `null` quando non si sa (prima lettura in corso
// o lettura fallita). Chi usa il gancio decide cosa fare del «non si sa»: il menu, per esempio,
// lascia la voce — un errore di lettura non è un modulo spento.
import { useEffect, useState } from 'react';
import { fetchModuliTenant } from '../api/kyc';
import { getTenantStorageKey } from '../utils/tenant';

const CHIAVE = 'bluman_modulo_kyc_attivo';
/** Lanciato da chi cambia i moduli dello studio, perché il menu si aggiorni senza ricaricare. */
export const EVENTO_MODULI_CAMBIATI = 'bluman:moduli-cambiati';

/** Ultima risposta del server vista in questa scheda: evita che la voce compaia e sparisca a ogni apertura. */
function copiaLocale(): boolean | null {
  try {
    const v = sessionStorage.getItem(getTenantStorageKey(CHIAVE));
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function useModuloKycAttivo(abilitato = true): boolean | null {
  const [attivo, setAttivo] = useState<boolean | null>(() => (abilitato ? copiaLocale() : null));

  useEffect(() => {
    if (!abilitato) return;
    let annullato = false;
    const leggi = () => {
      fetchModuliTenant()
        .then((m) => {
          if (annullato) return;
          const acceso = (m.attivi || []).includes('kyc');
          setAttivo(acceso);
          try { sessionStorage.setItem(getTenantStorageKey(CHIAVE), acceso ? '1' : '0'); } catch { /* solo una copia */ }
        })
        .catch(() => {
          // Lettura fallita: non si sa. Resta l'ultima risposta buona, se c'era; la pagina della
          // coda, se aperta, dichiara l'errore per conto suo.
        });
    };
    leggi();
    window.addEventListener(EVENTO_MODULI_CAMBIATI, leggi);
    return () => {
      annullato = true;
      window.removeEventListener(EVENTO_MODULI_CAMBIATI, leggi);
    };
  }, [abilitato]);

  return attivo;
}
