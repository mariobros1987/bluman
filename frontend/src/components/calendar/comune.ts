/**
 * §1ter.5 (B1-B4) — quello che le viste del calendario hanno in comune.
 *
 * Le etichette delle categorie, i colori, e le due funzioni che le viste usano per decidere che
 * cosa mostrare. Sta fuori dalla pagina perché la griglia, l'elenco e i due modali devono
 * raccontare la stessa cosa con le stesse parole: se il nome di una categoria fosse scritto in
 * due posti, il giorno in cui cambia ne cambierebbe uno solo.
 */
import type { CategoriaCalendario, EventoCalendario, StatoCalendario } from '../../api/calendario';
import { giornoDi } from '../../utils/calendarioDate';

/**
 * Le sei categorie, con il nome che si legge.
 *
 * `fattura` si chiama «Scadenze Fatture» e non «Emissione Fatture»: ciò che il calendario mostra
 * per quella categoria sono le **rate in attesa**, cioè denaro da incassare a una certa data, non
 * il giorno in cui qualcuno emette un documento. Il nome di prima descriveva l'altra cosa.
 *
 * `progetto` è la sesta, aggiunta in §1ter.3 (A6): la fine di un progetto, che è una scadenza che
 * riguarda tutti quelli che ci lavorano e non solo chi l'ha scritta.
 */
export const CATEGORIE: Record<CategoriaCalendario, { nome: string; icona: string }> = {
  microvoce: { nome: 'Microvoci Progetto', icona: '⚡' },
  kyc: { nome: 'Compliance KYC/AML', icona: '🔍' },
  fattura: { nome: 'Scadenze Fatture', icona: '💶' },
  contratto: { nome: 'Firma Contratti', icona: '📜' },
  promemoria: { nome: 'Promemoria Team', icona: '🔔' },
  progetto: { nome: 'Fini Progetto', icona: '🏁' },
};

/** L'ordine in cui le categorie si mostrano nei filtri, quando ci sono tutte. */
export const ORDINE_CATEGORIE: CategoriaCalendario[] = [
  'microvoce', 'kyc', 'fattura', 'contratto', 'promemoria', 'progetto',
];

/**
 * I due vocabolari di `stato`, tradotti.
 *
 * Sono due e si vede: `fatto` e `fatta` differiscono di una lettera e non sono la stessa cosa.
 * `fatto` è una riga che qualcuno ha scritto e spuntato; `fatta` è una scadenza derivata che il
 * server calcola come evasa — una rata incassata. Mostrarli con la stessa parola farebbe credere
 * che si possa spuntare anche la seconda, che è la cosa che non si può fare.
 */
export const ETICHETTE_STATO: Record<StatoCalendario, string> = {
  da_fare: '⏳ Da fare',
  fatto: '✓ Fatto',
  annullato: '✕ Annullato',
  scaduta: '⚠ Scaduta',
  fatta: '✓ Fatta',
};

export function coloreCategoria(cat: CategoriaCalendario) {
  switch (cat) {
    case 'microvoce': return { bg: '#312e81', border: '#4338ca', text: '#a5b4fc' };
    case 'kyc': return { bg: '#701a75', border: '#86198f', text: '#f5d0fe' };
    case 'fattura': return { bg: '#064e3b', border: '#047857', text: '#a7f3d0' };
    case 'contratto': return { bg: '#78350f', border: '#b45309', text: '#fde68a' };
    case 'progetto': return { bg: '#134e4a', border: '#0f766e', text: '#99f6e4' };
    default: return { bg: '#1e293b', border: '#334155', text: '#cbd5e1' };
  }
}

/** L'euro da centesimi, che è come il database conserva gli importi. */
export function euroDaCentesimi(centesimi: number): string {
  return (centesimi / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

/** Se la spunta si può cliccare. Una scadenza derivata non si spunta: si cambia nella sorgente. */
export function spuntabile(evento: EventoCalendario): boolean {
  return !evento.generato;
}

/**
 * Gli eventi che toccano un mese, per la vista a elenco.
 *
 * La griglia chiede al server l'intervallo delle **sue** caselle, che sborda nei mesi vicini per
 * completare le settimane. L'elenco invece è «le scadenze di settembre», quindi va ristretto: uno
 * stesso `eventi` alimenta le due viste, e usarlo intero mostrerebbe in elenco anche i primi
 * giorni di ottobre.
 */
export function eventiNelMese(eventi: EventoCalendario[], anno: number, mese: number): EventoCalendario[] {
  const m = String(mese + 1).padStart(2, '0');
  const primo = `${anno}-${m}-01`;
  const ultimo = `${anno}-${m}-${String(new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate()).padStart(2, '0')}`;
  return eventi
    .filter((e) => giornoDi(e.dataInizio) <= ultimo && giornoDi(e.dataFine) >= primo)
    .sort((x, y) => x.dataInizio.localeCompare(y.dataInizio));
}
