// I recapiti e l'anagrafica dello studio nel portale, dal server (`GET /portal/contatti`).
//
// L'anagrafica è quella che la lettera d'incarico stampa come controparte. La lettera si compone
// nel browser con `getStudioInfoForTenant()`, che legge la copia locale dell'anagrafica: qui la si
// scrive con i dati del database, così la lettera dice lo stesso studio che il sigillo della firma
// registra. Finché non è arrivata (`caricamento`) o se non arriva (`errore`) la lettera non si
// mostra e non si firma (`AvvisoAnagraficaStudio`). La copia locale è solo una copia (regola 3).
import { useCallback, useRef, useState } from 'react';
import { contattiPortaleApi, type AnagraficaStudioPortale, type ContattiStudio } from '../../api/portale';
import { getCurrentTenantId, getTenantStorageKey, saveTenantInfoToStorage } from '../../utils/tenant';
import type { StatoAnagraficaStudio } from './AvvisoAnagraficaStudio';

/** Scrive l'anagrafica del server sopra la copia locale, senza togliere gli altri campi che ci sono. */
export function salvaAnagraficaStudioPortale(anagrafica: AnagraficaStudioPortale, tenantId = getCurrentTenantId()) {
  let attuale: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(getTenantStorageKey('bluman_tenant_info', tenantId));
    if (raw) attuale = JSON.parse(raw) ?? {};
  } catch {
    attuale = {};
  }
  saveTenantInfoToStorage(tenantId, { ...attuale, ...anagrafica });
}

export function useContattiStudioPortale() {
  const [contattiStudio, setContattiStudio] = useState<ContattiStudio | null>(null);
  const [anagraficaStudio, setAnagraficaStudio] = useState<StatoAnagraficaStudio>('caricamento');
  const ultimoCliente = useRef<string | undefined>(undefined);

  const caricaContattiStudio = useCallback(async (clienteIdSessione?: string | null) => {
    ultimoCliente.current = clienteIdSessione ?? undefined;
    setAnagraficaStudio('caricamento');
    try {
      const res = await contattiPortaleApi(clienteIdSessione ?? undefined);
      if (res.anagrafica) salvaAnagraficaStudioPortale(res.anagrafica);
      setContattiStudio(res);
      setAnagraficaStudio(res.anagrafica ? 'ok' : 'errore');
    } catch (err) {
      console.warn('Recapiti e anagrafica dello studio non letti:', err);
      setContattiStudio(null);
      setAnagraficaStudio('errore');
    }
  }, []);

  const riprovaAnagraficaStudio = useCallback(() => {
    void caricaContattiStudio(ultimoCliente.current);
  }, [caricaContattiStudio]);

  return { contattiStudio, anagraficaStudio, caricaContattiStudio, riprovaAnagraficaStudio };
}
