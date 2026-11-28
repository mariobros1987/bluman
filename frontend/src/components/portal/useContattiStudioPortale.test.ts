// La copia locale dell'anagrafica dello studio, scritta con i dati del server: è quella che la
// lettera d'incarico legge. Prima nel portale restava l'anagrafica scritta nel frontend.
import { describe, it, expect, beforeEach } from 'vitest';
import { salvaAnagraficaStudioPortale } from './useContattiStudioPortale';
import { BLUECODE_TENANT_ID, getStudioInfoForTenant, getTenantStorageKey } from '../../utils/tenant';

const DAL_SERVER = {
  ragioneSociale: 'Bluecode Advisory Malta Ltd', piva: '', codiceFiscale: '', sedeLegale: 'Tower Road, Sliema',
  sedeOperativa: '', giurisdizione: 'Malta', iban: '', email: 'studio@example.com', telefono: '', leadAdvisor: '', logoUrl: '',
};

beforeEach(() => localStorage.clear());

describe('salvaAnagraficaStudioPortale', () => {
  it('la lettera legge lo studio del database, non quello scritto nel frontend', () => {
    salvaAnagraficaStudioPortale(DAL_SERVER, BLUECODE_TENANT_ID);
    const studio = getStudioInfoForTenant(BLUECODE_TENANT_ID);
    expect(studio.ragioneSociale).toBe('Bluecode Advisory Malta Ltd');
    expect(studio.sedeLegale).toBe('Tower Road, Sliema');
    // Un campo vuoto nel database resta vuoto: non torna il valore scritto nel frontend.
    expect(studio.codiceFiscale).toBe('');
  });

  it('non toglie gli altri campi della copia locale', () => {
    localStorage.setItem(getTenantStorageKey('bluman_tenant_info', BLUECODE_TENANT_ID), JSON.stringify({ codiceSdi: 'ABC1234' }));
    salvaAnagraficaStudioPortale(DAL_SERVER, BLUECODE_TENANT_ID);
    expect(getStudioInfoForTenant(BLUECODE_TENANT_ID).codiceSdi).toBe('ABC1234');
  });
});
