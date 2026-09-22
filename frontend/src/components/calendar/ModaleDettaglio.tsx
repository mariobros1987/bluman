/**
 * §1ter.5 (B2, B4) — il dettaglio di una scadenza.
 *
 * Il modale mostra i campi che la riga ha, e **nient'altro**. Quello di prima completava le lacune:
 * un «Cliente Studio» quando il cliente non c'era, un «Lead Advisor» come operatore, le 12:00 come
 * ora di ogni scadenza, un importo di 3.500 € quando la fattura non ne portava uno. Sono tutti dati
 * plausibili, ed è questo che li rende peggio di un campo vuoto: nessuno va a controllare un numero
 * che sembra giusto.
 *
 * Due cose che il modale dice e che prima non poteva dire, perché non lo sapeva:
 *
 *  - **da dove viene** la scadenza, se è derivata. Un evento derivato non si modifica e non si
 *    cancella da qui — la rotta lo rifiuta con 409 — e il posto giusto per dirlo è il modale, non
 *    un errore dopo il clic.
 *  - **che è già stata evasa**, quando lo stato è `fatta`: una rata incassata resta nel calendario
 *    e non va nascosta, ma nemmeno fatta sembrare ancora dovuta.
 */
import type { ReactNode } from 'react';
import type { EventoCalendario } from '../../api/calendario';
import { etichettaGiorno, giornoDi, oraMostrata } from '../../utils/calendarioDate';
import { CATEGORIE, ETICHETTE_STATO, coloreCategoria, euroDaCentesimi, spuntabile } from './comune';
import { Modal } from '../ui/Modal';

interface Props {
  evento: EventoCalendario;
  onChiudi: () => void;
  onCambiaStato: (e: EventoCalendario) => void;
  onCancella: (e: EventoCalendario) => void;
}

/** Da dove viene una scadenza derivata. Il testo è lo stesso che dà la rotta, in breve. */
const SORGENTE: Record<string, string> = {
  kyc: 'la data KYC del cliente',
  fattura: 'la scadenza della rata',
  progetto: 'la data di scadenza del progetto',
  contratto: 'la prossima fatturazione del contratto',
};

export function ModaleDettaglio({ evento, onChiudi, onCambiaStato, onCancella }: Props) {
  const colore = coloreCategoria(evento.categoria);
  const ora = oraMostrata(evento);
  const spunta = spuntabile(evento);
  const fatto = evento.stato === 'fatto' || evento.stato === 'fatta';

  const riga = (etichetta: string, valore: ReactNode) => (
    <div><strong>{etichetta}</strong> {valore}</div>
  );

  return (
    <Modal onClose={onChiudi} labelledBy="titolo-dettaglio-evento" zIndex={100}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: colore.bg, color: colore.text }}>
              {CATEGORIE[evento.categoria].icona} {CATEGORIE[evento.categoria].nome.toUpperCase()}
            </span>
            <h3 id="titolo-dettaglio-evento" style={{ margin: '8px 0 0 0', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{evento.titolo}</h3>
          </div>
          <button type="button" onClick={onChiudi} aria-label="Chiudi" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
          {riga('📅', `${etichettaGiorno(giornoDi(evento.dataInizio))}${ora ? ` alle ${ora}` : ' — tutto il giorno'}`)}
          {evento.dataFine !== evento.dataInizio && riga('🏁', `fino al ${etichettaGiorno(giornoDi(evento.dataFine))}`)}
          {evento.clienteNome && riga('🏢 Cliente:', evento.clienteNome)}
          {evento.assegnatoANome && riga('👤 Assegnata a:', evento.assegnatoANome)}
          {evento.importoCentesimi !== null && riga('💶 Importo:', euroDaCentesimi(evento.importoCentesimi))}
          {riga('⚡ Stato:', ETICHETTE_STATO[evento.stato])}
          {riga('🔔 Priorità:', evento.priorita)}
          {evento.luogoUrl && riga('📍 Dove:', evento.luogoUrl)}
          {evento.note && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, color: 'var(--muted)', fontSize: 11 }}>
              <strong>📝 Note:</strong> {evento.note}
            </div>
          )}
        </div>

        {evento.generato && (
          <div style={{ background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', color: 'var(--pill-indigo-fg)', padding: '10px 14px', borderRadius: 10, fontSize: 11, lineHeight: 1.5 }}>
            ↻ Questa è una <strong>scadenza calcolata dal sistema</strong>, non un evento scritto a
            mano: non si modifica e non si cancella da qui. Si cambia {SORGENTE[evento.categoria] ?? 'la sua origine'},
            e il calendario la mostra aggiornata alla prossima lettura.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          {spunta ? (
            <button
              type="button"
              onClick={() => onCambiaStato(evento)}
              style={{
                background: fatto ? 'var(--card2)' : 'var(--green)',
                color: fatto ? 'var(--text)' : '#fff',
                border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {fatto ? '↩ Riapri' : '✓ Segna come fatta'}
            </button>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Nessuna spunta: la scadenza è calcolata.</span>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {/* La cancellazione si offre solo dove la rotta la accetta. Un pulsante che risponde
                409 è un pulsante che fa perdere tempo a chi lo preme. */}
            {spunta && (
              <button
                type="button"
                onClick={() => onCancella(evento)}
                style={{ background: 'transparent', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                🗑 Cancella
              </button>
            )}
            <button
              type="button"
              onClick={onChiudi}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
            >
              Chiudi
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
