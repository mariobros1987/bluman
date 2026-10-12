// Il fac-simile dell'anteprima fattura deve dichiararsi e non contenere identificativi
// scambiabili per veri. Prima c'erano un cliente inesistente («Holding Beta S.r.l.»), la sua
// P.IVA, un codice destinatario SDI e il numero «FT-2026-PREVIEW»; il modale ha un pulsante di
// stampa, quindi quei valori potevano uscire su un foglio con l'aria di un documento vero.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvoicePreviewModal } from './InvoicePreviewModal';

function mostra(mostraSdi = true) {
  return render(
    <InvoicePreviewModal
      coloreTemaFattura="#4338ca"
      logoUrl=""
      titoloIntestazione="Bluecode Advisory"
      ragioneSociale="Bluecode LTD"
      sedeLegale="Notabile Residence, Mdina Road, Attard ATD9036, Malta"
      sedeOperativa="Notabile Residence, Mdina Road, Attard ATD9036, Malta"
      pIva="MT28491039"
      iban="MT00X0000000000000000000000"
      mostraSdi={mostraSdi}
      notePieDiPagina="Pagamento a 30 gg"
      setPreviewOpen={vi.fn()}
    />,
  );
}

describe('InvoicePreviewModal — il fac-simile è dichiarato e senza identificativi inventati', () => {
  it('dichiara in cima che i dati sono di esempio', () => {
    mostra();
    expect(screen.getByText(/FAC-SIMILE/)).toBeTruthy();
    expect(screen.getByText(/non appartengono a nessun cliente/i)).toBeTruthy();
  });

  it('non mostra il cliente inventato né i suoi identificativi', () => {
    mostra();
    expect(screen.queryByText(/Holding Beta/)).toBeNull();
    expect(screen.queryByText(/IT09876543210/)).toBeNull();
    expect(screen.queryByText(/SUBM70N/)).toBeNull();
    expect(screen.queryByText(/FT-2026-PREVIEW/)).toBeNull();
    expect(screen.getByText('Cliente di esempio')).toBeTruthy();
  });

  it('i dati veri dello studio restano quelli che arrivano dalle props', () => {
    mostra();
    expect(screen.getByText('Bluecode Advisory')).toBeTruthy();
    expect(screen.getByText(/MT28491039/)).toBeTruthy();
  });

  it('col canale SDI spento la riga del codice destinatario non compare', () => {
    mostra(false);
    expect(screen.queryByText(/Codice destinatario/)).toBeNull();
  });
});
