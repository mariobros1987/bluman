// ❓ Aiuto — la pagina.
//
// Quello che si presidia qui non è l'impaginazione (che è CSS e non si prova) ma **cosa la pagina
// dice nei tre casi che si assomigliano e non sono la stessa cosa**:
//
// - il manuale non si è potuto leggere → «non disponibile in questa installazione», **non** un
//   indice vuoto, che direbbe «non c'è aiuto»;
// - una scheda non si può aprire → la parola del server (403 «riservata», 404 «non trovata»);
// - la ricerca non trova niente → lo dice con la parola cercata, invece di mostrare l'elenco
//   intero come se il filtro non fosse stato applicato.
//
// Il resto è navigazione: l'indice apre, la voce attiva si riconosce, il lucchetto c'è dove serve.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AiutoPage } from './AiutoPage';
import { fetchIndiceManualeApi, fetchSchedaManualeApi } from '../api/client';

vi.mock('../api/client', () => ({
  fetchIndiceManualeApi: vi.fn(),
  fetchSchedaManualeApi: vi.fn(),
}));

const mockIndice = fetchIndiceManualeApi as ReturnType<typeof vi.fn>;
const mockScheda = fetchSchedaManualeApi as ReturnType<typeof vi.fn>;

const SCHEDE = [
  { slug: '01-progetti-motore-stato', numero: '01', titolo: '01 · Progetti & Motore di Stato', riservata: false, testo: 'Un progetto è una pratica per un cliente.\nLo stato sale per azione esplicita.' },
  { slug: '05-fatture-sdi', numero: '05', titolo: '05 · Fatture / Note di Credito & SDI', riservata: false, testo: 'Il registro Fatture/NC emette fatture.\nL\'XML si compone solo con l\'anagrafica completa.' },
  { slug: '19-infra-deploy', numero: '19', titolo: '19 · Infrastruttura & Deploy', riservata: true, testo: 'Il VPS e il backup notturno.' },
];

const INDICE_LETTO = { letto: true, schede: SCHEDE };

function renderPagina(percorso = '/aiuto') {
  return render(
    <MemoryRouter initialEntries={[percorso]}>
      <Routes>
        <Route path="/aiuto" element={<AiutoPage />} />
        <Route path="/aiuto/:slug" element={<AiutoPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockIndice.mockReset();
  mockScheda.mockReset();
  mockIndice.mockResolvedValue(INDICE_LETTO);
  mockScheda.mockResolvedValue({
    letto: true, slug: '05-fatture-sdi', numero: '05',
    titolo: '05 · Fatture / Note di Credito & SDI', riservata: false,
    html: '<h1>05 · Fatture / Note di Credito & SDI</h1><h2>👤 Cosa fa e come si usa</h2><p>Il registro emette fatture.</p>',
  });
});

/**
 * L'indice, una volta caricato.
 *
 * Le query vanno ristrette qui dentro perché il titolo di una scheda compare **due volte** nella
 * pagina: nella voce dell'indice e nell'`<h1>` dell'articolo. Cercarlo a schermo intero è ambiguo,
 * e l'ambiguità è del test, non della pagina.
 */
async function attendiIndice() {
  return within(await screen.findByRole('navigation', { name: 'Schede del manuale' }));
}

describe('AiutoPage — quando il manuale non si è potuto leggere', () => {
  it('lo dice, invece di mostrare un indice vuoto', async () => {
    mockIndice.mockResolvedValue({ letto: false, schede: [] });
    renderPagina();

    expect(await screen.findByText(/non è disponibile in questa installazione/i)).toBeInTheDocument();
    // La distinzione è il punto: «non ce ne sono» e «non ho potuto guardare» sarebbero la stessa
    // schermata con due significati opposti.
    expect(screen.queryByText(/Nessuna scheda/i)).toBeNull();
    expect(mockScheda).not.toHaveBeenCalled();
  });
});

describe('AiutoPage — l’indice', () => {
  it('elenca le schede con numero e titolo', async () => {
    renderPagina('/aiuto/05-fatture-sdi');

    const indice = await attendiIndice();
    expect(indice.getByText('05 · Fatture / Note di Credito & SDI')).toBeInTheDocument();
    expect(indice.getByText('01 · Progetti & Motore di Stato')).toBeInTheDocument();
  });

  it('la scheda riservata porta il lucchetto', async () => {
    renderPagina('/aiuto/05-fatture-sdi');
    const indice = await attendiIndice();
    expect(indice.getByTitle(/Riservata all'amministratore della piattaforma/i)).toBeInTheDocument();
  });

  it('scegliere una voce apre la sua scheda', async () => {
    renderPagina('/aiuto/05-fatture-sdi');
    const indice = await attendiIndice();

    mockScheda.mockResolvedValue({
      letto: true, slug: '01-progetti-motore-stato', numero: '01',
      titolo: '01 · Progetti & Motore di Stato', riservata: false,
      html: '<h1>01 · Progetti & Motore di Stato</h1><p>Un progetto è una pratica.</p>',
    });

    await userEvent.click(indice.getByText('01 · Progetti & Motore di Stato'));

    await waitFor(() => expect(mockScheda).toHaveBeenCalledWith('01-progetti-motore-stato'));
    expect(await screen.findByText('Un progetto è una pratica.')).toBeInTheDocument();
  });

  it('`/aiuto` senza scheda apre la prima e mette lo slug nell’URL', async () => {
    // Senza, la colonna di destra sarebbe vuota: chi entra in «Aiuto» vuole leggere, e la prima
    // scheda è da dove si comincia.
    renderPagina('/aiuto');
    await waitFor(() => expect(mockScheda).toHaveBeenCalledWith('01-progetti-motore-stato'));
  });
});

describe('AiutoPage — la ricerca', () => {
  it('trova una parola e mostra il rigo che la contiene', async () => {
    renderPagina('/aiuto/05-fatture-sdi');
    await attendiIndice();

    await userEvent.type(screen.getByLabelText(/Cerca nel manuale/i), 'anagrafica');

    expect(await screen.findByText(/1 scheda per «anagrafica»/i)).toBeInTheDocument();
    // Il rigo trovato è il motivo per cui i risultati non sono solo titoli: senza, per sapere se
    // una scheda è quella giusta bisognerebbe aprirla.
    expect(screen.getByText(/L'XML si compone solo con l'anagrafica completa/i)).toBeInTheDocument();
  });

  it('cerca anche senza accenti: «attivita» trova «attività»', async () => {
    // In italiano non è un lusso: chi scrive di fretta non mette l'accento, e un motore che
    // risponde «nessun risultato» a una parola che c'è si fa considerare rotto.
    mockIndice.mockResolvedValue({
      letto: true,
      schede: [{ slug: '01-progetti-motore-stato', numero: '01', titolo: '01 · Progetti', riservata: false, testo: 'Le attività della micro-voce.' }],
    });
    renderPagina('/aiuto/01-progetti-motore-stato');
    await screen.findByText('01 · Progetti');

    await userEvent.type(screen.getByLabelText(/Cerca nel manuale/i), 'attivita');
    expect(await screen.findByText(/1 scheda per «attivita»/i)).toBeInTheDocument();
  });

  it('senza risultati lo dice, invece di mostrare l’elenco intero', async () => {
    renderPagina('/aiuto/05-fatture-sdi');
    const indice = await attendiIndice();

    await userEvent.type(screen.getByLabelText(/Cerca nel manuale/i), 'qwertyuiop');

    expect(await screen.findByText(/Nessuna scheda contiene «qwertyuiop»/i)).toBeInTheDocument();
    // Le voci spariscono: mostrarle tutte come se il filtro non fosse stato applicato farebbe
    // credere che la ricerca abbia trovato qualcosa.
    expect(indice.queryByRole('button')).toBeNull();
  });
});

describe('AiutoPage — quando la scheda non si apre', () => {
  it('mostra la parola del server, non un messaggio generico', async () => {
    // Il 403 e il 404 sono due cose diverse e il server le sa distinguere: qui si presidia che
    // quella distinzione arrivi fino allo schermo invece di essere appiattita in pagina.
    mockScheda.mockResolvedValue({
      letto: false, slug: '19-infra-deploy', numero: '', titolo: '', riservata: false, html: '',
      errore: 'La scheda «19-infra-deploy» è riservata all\'amministratore della piattaforma.',
    });
    renderPagina('/aiuto/19-infra-deploy');

    expect(await screen.findByText(/riservata all'amministratore della piattaforma/i)).toBeInTheDocument();
    expect(screen.getByText(/non si può leggere/i)).toBeInTheDocument();
  });

  it('una scheda illeggibile non lascia un articolo vuoto a schermo', async () => {
    mockScheda.mockResolvedValue({ letto: false, slug: 'x', numero: '', titolo: '', riservata: false, html: '', errore: 'Non trovata.' });
    const { container } = renderPagina('/aiuto/99-inventata');

    await screen.findByText(/Non trovata/);
    expect(container.querySelector('article')).toBeNull();
  });
});

describe('AiutoPage — la scheda riservata, quando la si può leggere', () => {
  it('lo dichiara sopra il testo', async () => {
    mockScheda.mockResolvedValue({
      letto: true, slug: '19-infra-deploy', numero: '19', titolo: '19 · Infrastruttura & Deploy',
      riservata: true, html: '<h1>19 · Infrastruttura &amp; Deploy</h1><p>Il VPS.</p>',
    });
    renderPagina('/aiuto/19-infra-deploy');

    expect(await screen.findByText(/riservata all’amministratore della piattaforma/i)).toBeInTheDocument();
  });
});
