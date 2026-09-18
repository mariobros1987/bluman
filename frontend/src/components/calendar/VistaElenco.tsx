/**
 * §1ter.5 (B2-B4) — l'elenco delle scadenze del mese.
 *
 * È la vista in cui la spunta si può mettere, e la differenza con prima è che ora **si scrive**.
 * `handleToggleComplete` cambiava lo stato dentro il `useState` e basta: la spunta restava finché
 * non si ricaricava la pagina, e al primo ricaricamento tornava com'era. Il vocabolario era anche
 * un altro — `pending`/`done` in locale, `da_fare`/`fatto`/`annullato` a database — quindi non
 * sarebbe mai potuta arrivare in fondo nemmeno volendo.
 *
 * Le righe derivate non hanno la spunta, e non è una dimenticanza: una rata non si «fa», si paga;
 * un rinnovo KYC non si spunta, si rinnova. Il pulsante c'è ma è spento e dice perché, invece di
 * esserci e non fare niente — che è il modo in cui un'interfaccia insegna a non fidarsi dei propri
 * pulsanti.
 */
import type { EventoCalendario } from '../../api/calendario';
import { etichettaGiorno, giornoDi, oraMostrata } from '../../utils/calendarioDate';
import { CATEGORIE, ETICHETTE_STATO, coloreCategoria, euroDaCentesimi, spuntabile } from './comune';

interface Props {
  eventi: EventoCalendario[];
  onApri: (e: EventoCalendario) => void;
  onCambiaStato: (e: EventoCalendario) => void;
}

export function VistaElenco({ eventi, onApri, onCambiaStato }: Props) {
  if (eventi.length === 0) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
        Nessuna scadenza in questo mese con i filtri scelti.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {eventi.map((ev) => {
        const colore = coloreCategoria(ev.categoria);
        const fatto = ev.stato === 'fatto' || ev.stato === 'fatta';
        const annullato = ev.stato === 'annullato';
        const ora = oraMostrata(ev);
        const spunta = spuntabile(ev);

        return (
          <div
            key={ev.id}
            style={{
              background: 'var(--card)',
              border: `1px solid ${fatto ? '#059669' : annullato ? 'var(--muted)' : 'var(--border)'}`,
              borderRadius: 14,
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              boxShadow: '0 4px 14px rgba(0,0,0,.2)',
              opacity: fatto || annullato ? 0.7 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
              <button
                type="button"
                onClick={() => spunta && onCambiaStato(ev)}
                disabled={!spunta}
                title={
                  spunta
                    ? fatto ? 'Riapri la scadenza' : 'Segna come fatta'
                    : 'Scadenza calcolata dal sistema: si cambia nella sua origine, non da qui'
                }
                style={{
                  width: 24,
                  height: 24,
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: `2px solid ${fatto ? '#34d399' : 'var(--muted)'}`,
                  background: fatto ? '#34d399' : 'transparent',
                  color: '#fff',
                  fontSize: 12,
                  cursor: spunta ? 'pointer' : 'not-allowed',
                  opacity: spunta ? 1 : 0.35,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {fatto ? '✓' : ''}
              </button>

              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: fatto || annullato ? 'line-through' : 'none' }}>
                  {ev.generato ? '↻ ' : ''}{ev.titolo}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* La data si scrive per esteso e non `2026-09-15`: il formato del database non
                      è un formato che si legge. */}
                  <span>📅 {etichettaGiorno(giornoDi(ev.dataInizio))}{ora ? ` alle ${ora}` : ''}</span>
                  {ev.clienteNome && <span>🏢 {ev.clienteNome}</span>}
                  {ev.assegnatoANome && <span>👤 {ev.assegnatoANome}</span>}
                  {ev.importoCentesimi !== null && <span>💶 {euroDaCentesimi(ev.importoCentesimi)}</span>}
                  <span>{ETICHETTE_STATO[ev.stato]}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: colore.bg, border: `1px solid ${colore.border}`, color: colore.text, whiteSpace: 'nowrap' }}>
                {CATEGORIE[ev.categoria].icona} {ev.categoria.toUpperCase()}
              </span>

              <button
                type="button"
                onClick={() => onApri(ev)}
                style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                👁 Dettagli
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
