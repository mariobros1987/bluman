// §7 — qui il campo «Codice Destinatario Default» mostrava una costante scritta nel sorgente,
// `SUBM70N`: il codice SDI di un'azienda che non è questa, presentato come la configurazione dello
// studio in un campo read-only. Il codice di un cliente sta nella scheda del cliente; quello dello
// studio, se esiste, sta nella sua anagrafica. Se non c'è, il campo resta vuoto e lo dice.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TabSdi } from './TabSdi';
import { getTenantStorageKey, BLUECODE_TENANT_ID } from '../../utils/tenant';

describe('TabSdi — nessun codice destinatario inventato', () => {
  beforeEach(() => localStorage.clear());

  it('senza anagrafica dello studio il campo è vuoto e spiega perché', () => {
    render(<TabSdi />);

    expect(screen.queryByDisplayValue('SUBM70N')).toBeNull();
    expect(screen.getByText(/Vuoto: lo studio non ha un codice destinatario predefinito/)).toBeTruthy();
  });

  it('con l\'anagrafica dello studio mostra il codice vero, dichiarando da dove viene', () => {
    localStorage.setItem(
      getTenantStorageKey('bluman_tenant_info', BLUECODE_TENANT_ID),
      JSON.stringify({ codiceSdi: 'ABCDEFG' }),
    );

    render(<TabSdi />);

    expect(screen.getByDisplayValue('ABCDEFG')).toBeTruthy();
    expect(screen.getByText(/Letto dall'anagrafica dello studio/)).toBeTruthy();
  });
});
