/**
 * §1ter.5 (B1-B4) — i filtri per categoria, costruiti da ciò che il server consente.
 *
 * Prima erano sei pulsanti scritti a mano — e quei sei erano già una bugia: le categorie sono sei
 * ma comprendevano `microvoce` senza che niente potesse produrne una, e non comprendevano
 * `progetto`, che il server genera. Chi sceglieva «⚡ Microvoci Progetto» otteneva le tappe
 * inventate dalla pagina; chi cercava la fine di un progetto non aveva un filtro per trovarla.
 *
 * Sopra a tutto questo, la matrice dei permessi può togliere a un utente categorie che il suo
 * ruolo vedrebbe — uno studio che ha tolto lo scadenzario a un collaboratore non deve ritrovare le
 * rate nel calendario. Il server le calcola e le restituisce in `categorie`; qui si mostrano
 * quelle, e nient'altro. Un filtro che si può selezionare e torna sempre vuoto si legge come «non
 * c'è niente in calendario», non come «non ti è consentito»: è una differenza che si paga.
 */
import type { CategoriaCalendario } from '../../api/calendario';
import { CATEGORIE, ORDINE_CATEGORIE, coloreCategoria } from './comune';

interface Props {
  filtro: 'tutti' | CategoriaCalendario;
  setFiltro: (f: 'tutti' | CategoriaCalendario) => void;
  categoriePermesse: CategoriaCalendario[];
  totale: number;
}

export function BarraFiltri({ filtro, setFiltro, categoriePermesse, totale }: Props) {
  // Le permesse, nell'ordine canonico: il server le manda nell'ordine che vuole, e un elenco che
  // cambia ordine a ogni ricaricamento è un elenco in cui si sbaglia pulsante.
  const mostrate = ORDINE_CATEGORIE.filter((c) => categoriePermesse.includes(c));

  const stile = (attivo: boolean, colore?: { bg: string; border: string; text: string }) => ({
    padding: '6px 14px',
    borderRadius: 20,
    border: attivo ? `1px solid ${colore?.border ?? 'var(--indigo)'}` : '1px solid var(--border)',
    background: attivo ? (colore?.bg ?? 'var(--card2)') : 'var(--card)',
    color: attivo ? (colore?.text ?? 'var(--indigo-l)') : 'var(--muted)',
    fontSize: 11,
    fontWeight: 600 as const,
    cursor: 'pointer' as const,
    whiteSpace: 'nowrap' as const,
  });

  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
      <button type="button" onClick={() => setFiltro('tutti')} style={stile(filtro === 'tutti')}>
        📌 Tutti gli Eventi
      </button>

      {mostrate.map((cat) => (
        <button key={cat} type="button" onClick={() => setFiltro(cat)} style={stile(filtro === cat, coloreCategoria(cat))}>
          {CATEGORIE[cat].icona} {CATEGORIE[cat].nome}
        </button>
      ))}

      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
        {totale} {totale === 1 ? 'scadenza' : 'scadenze'}
      </span>
    </div>
  );
}
