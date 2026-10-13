// Test della guida ai dati obbligatori dello studio (§7). Il modale è di sola lettura: qui si
// presidia che dica la verità nei tre stati possibili — campi mancanti, anagrafica completa,
// lettura non riuscita — perché sono tre cose diverse e mostrarle uguali è l'errore che questa
// guida esiste per evitare.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnagraficaStudioModal } from './AnagraficaStudioModal';
import { ConfirmProvider } from './ui/ConfirmProvider';
import type { CampoAnagrafica } from '../api/client';

const PIVA: CampoAnagrafica = {
  chiave: 'piva',
  etichetta: 'Partita IVA / VAT Number',
  dove: 'l’«IdCodice» dell’identificativo fiscale del cedente nell’XML SDI',
  senza: 'l’app scriveva «00000000000»',
};

const IBAN: CampoAnagrafica = {
  chiave: 'iban',
  etichetta: 'IBAN per Accredito Fatture',
  dove: 'le coordinate di pagamento stampate in fattura',
  senza: 'la fattura usciva senza coordinate su cui pagare',
};

function renderModale(stato: any, props: Partial<{ onClose: () => void; onCompila: () => void; mostraCompila: boolean }> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onCompila = props.onCompila ?? vi.fn();
  render(
    <ConfirmProvider>
      <AnagraficaStudioModal
        stato={stato}
        onClose={onClose}
        onCompila={onCompila}
        mostraCompila={props.mostraCompila}
      />
    </ConfirmProvider>,
  );
  return { onClose, onCompila };
}

describe('AnagraficaStudioModal — cosa dice nei tre stati', () => {
  it('elenca i campi mancanti con il perché e cosa l’app scriveva al loro posto', () => {
    renderModale({ letto: true, completa: false, mancanti: [PIVA, IBAN] });

    expect(screen.getByText('Partita IVA / VAT Number')).toBeInTheDocument();
    expect(screen.getByText('IBAN per Accredito Fatture')).toBeInTheDocument();
    // Il «dove finisce» e il «cosa scriveva prima» sono la ragione per cui la guida serve:
    // un elenco di caselle senza motivo non spiega perché compilarle.
    expect(screen.getByText(/IdCodice/)).toBeInTheDocument();
    expect(screen.getByText(/00000000000/)).toBeInTheDocument();
    // Il patto è dichiarato: senza quei dati l'app rifiuta, non inventa.
    expect(screen.getByText(/rifiuta di comporre/i)).toBeInTheDocument();
  });

  it('con l’anagrafica completa non elenca niente e non promette lavori da fare', () => {
    renderModale({ letto: true, completa: true, mancanti: [] });

    expect(screen.getByText(/anagrafica dello studio è completa/i)).toBeInTheDocument();
    expect(screen.queryByText('Partita IVA / VAT Number')).toBeNull();
    expect(screen.queryByRole('button', { name: /Compila in Impostazioni/i })).toBeNull();
  });

  it('quando la lettura non è riuscita non dice né «manca» né «c’è»', () => {
    // `letto: false` è «non ho potuto guardare»: mostrare la lista dei mancanti qui vorrebbe
    // dire affermare qualcosa che non si sa.
    renderModale({ letto: false, completa: false, mancanti: [] });

    expect(screen.getByText(/Non ho potuto leggere l’anagrafica|Non ho potuto leggere l'anagrafica/i)).toBeInTheDocument();
    expect(screen.queryByText(/rifiuta di comporre/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Compila in Impostazioni/i })).toBeNull();
  });

  it('«Più tardi» chiude, e «Compila in Impostazioni» porta dove i campi si scrivono', () => {
    const { onClose, onCompila } = renderModale({ letto: true, completa: false, mancanti: [PIVA] });

    fireEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCompila).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Compila in Impostazioni' }));
    expect(onCompila).toHaveBeenCalledTimes(1);
  });

  it('aperta dalle Impostazioni non offre un pulsante che riporta dove si è già', () => {
    const { onCompila } = renderModale({ letto: true, completa: false, mancanti: [PIVA] }, { mostraCompila: false });

    expect(screen.queryByRole('button', { name: /Compila in Impostazioni/i })).toBeNull();
    // La lista dei mancanti resta visibile: è il contenuto, non la destinazione.
    expect(screen.getByText('Partita IVA / VAT Number')).toBeInTheDocument();
    expect(onCompila).not.toHaveBeenCalled();
  });
});
