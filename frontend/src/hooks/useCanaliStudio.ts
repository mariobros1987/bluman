import { useEffect, useMemo, useState } from 'react';
import { fetchTenantInfoApi } from '../api/client';
import { BLUECODE_TENANT_ID, getCurrentTenantId, getStudioInfoForTenant, getTenantStorageKey } from '../utils/tenant';

/**
 * Le linee dello studio, quelle che l'operatore vede accanto a ogni canale.
 *
 * Estratto perché ora i compositori sono due — la chat del fascicolo e la micro-voce — e le
 * impostazioni dello studio si leggono allo stesso modo in entrambi: dal server, con il ripiego su
 * ciò che è già in locale. Due copie di questa lettura darebbero due etichette diverse per lo stesso
 * numero, ed è la classe di guasto che questa estrazione toglie di mezzo.
 *
 * Nota su Telegram: qui **non** c'è nessun ripiego scritto in duro. C'era `'@BluManStudioBot'`, e
 * quel nome su Telegram non esiste (verificato: `t.me/BluManStudioBot` non risolve): l'etichetta lo
 * mostrava come se fosse il bot dello studio, e un operatore che lo legge può dettarlo a un cliente.
 * Se lo studio non ha lo username salvato, la riga resta vuota — che è la verità.
 */
export interface CanaliStudio {
  whatsapp: string;
  email: string;
  telegram: string;
  signal: string;
  portal: string;
}

export function useCanaliStudio(): CanaliStudio {
  const [impostazioni, setImpostazioni] = useState<any>(null);

  useEffect(() => {
    const carica = async () => {
      const dalServer = await fetchTenantInfoApi();
      if (dalServer) {
        setImpostazioni(dalServer);
        return;
      }
      const locale = localStorage.getItem(getTenantStorageKey('bluman_tenant_info'));
      if (locale) {
        try { setImpostazioni(JSON.parse(locale)); } catch {}
      }
    };
    carica();
  }, []);

  return useMemo(() => {
    const tenantId = getCurrentTenantId();
    const isBluecode = tenantId === BLUECODE_TENANT_ID;
    const studio = getStudioInfoForTenant(tenantId);
    return {
      whatsapp: impostazioni?.telefono || studio.telefono || (isBluecode ? '+39 378 092 6461' : ''),
      email: impostazioni?.smtpFromEmail || impostazioni?.email || studio.email || (isBluecode ? 'comunicazioni@bluecode.advisory' : ''),
      telegram: impostazioni?.tgBotUsername || '',
      signal: impostazioni?.telefono || studio.telefono || (isBluecode ? '+39 378 092 6461' : ''),
      portal: 'portal',
    };
  }, [impostazioni]);
}
