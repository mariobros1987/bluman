/**
 * §1ter.5 (B1) — la testata del calendario: che mese è, e i comandi.
 *
 * L'intestazione **deriva dal periodo**, e il periodo è stato. Prima qui c'era la stringa
 * `Agosto 2026` scritta nel JSX, e sotto una griglia di trentuno caselle costruita a parte: due
 * cose che dicevano la stessa bugia senza saperlo.
 *
 * Il pulsante «Oggi» c'è perché senza di esso, dopo qualche mese di navigazione, non c'è modo di
 * tornare al mese corrente se non ricaricando la pagina — e la griglia aperta su marzo 2027 con
 * «oggi» evidenziato su nessuna casella è una schermata che non dice dove sei.
 */
import type { CSSProperties } from 'react';
import { mesePrecedente, meseSuccessivo, etichettaMese } from '../../utils/calendarioDate';
import { triggerCronScadenzeApi } from '../../api/client';

export interface Periodo {
  anno: number;
  mese: number;
}

interface Props {
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  vista: 'mese' | 'lista';
  setVista: (v: 'mese' | 'lista') => void;
  /** Falso quando il mese guardato non è quello di oggi: serve a non evidenziare niente a vuoto. */
  nelMeseCorrente: boolean;
  onOggi: () => void;
  onRicarica: () => Promise<void>;
  onNuovo: () => void;
}

const BOTTONE_PICCOLO: CSSProperties = {
  background: 'var(--card2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  width: 30,
  height: 30,
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
};

export function Testata({ periodo, setPeriodo, vista, setVista, nelMeseCorrente, onOggi, onRicarica, onNuovo }: Props) {
  const cambiaMese = (n: number) => {
    setPeriodo(n > 0 ? meseSuccessivo(periodo.anno, periodo.mese) : mesePrecedente(periodo.anno, periodo.mese));
  };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>📅 Calendario Condiviso &amp; Scadenzario Studio</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
          {etichettaMese(periodo.anno, periodo.mese)} — scadenze derivate da rate, rinnovi KYC, fini di
          progetto e contratti, più i promemoria scritti a mano
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* Navigazione del mese: è B1, e senza di essa il calendario è una fotografia. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 3 }}>
          <button type="button" onClick={() => cambiaMese(-1)} style={BOTTONE_PICCOLO} title="Mese precedente">‹</button>
          <button
            type="button"
            onClick={onOggi}
            style={{
              ...BOTTONE_PICCOLO,
              width: 'auto',
              padding: '0 10px',
              fontSize: 11,
              // Disabilitato quando ci sei già: un pulsante che non sposta niente è un pulsante
              // che si preme due volte pensando che non abbia funzionato.
              opacity: nelMeseCorrente ? 0.5 : 1,
              cursor: nelMeseCorrente ? 'default' : 'pointer',
            }}
            disabled={nelMeseCorrente}
            title={nelMeseCorrente ? 'Stai già guardando il mese corrente' : 'Torna al mese corrente'}
          >
            Oggi
          </button>
          <button type="button" onClick={() => cambiaMese(1)} style={BOTTONE_PICCOLO} title="Mese successivo">›</button>
        </div>

        <div style={{ background: 'var(--card2)', padding: 3, borderRadius: 10, display: 'flex', gap: 2, border: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={() => setVista('mese')}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: vista === 'mese' ? 'var(--indigo)' : 'transparent',
              color: vista === 'mese' ? '#fff' : 'var(--muted)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            📅 Vista Mese
          </button>
          <button
            type="button"
            onClick={() => setVista('lista')}
            style={{
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: vista === 'lista' ? 'var(--indigo)' : 'transparent',
              color: vista === 'lista' ? '#fff' : 'var(--muted)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            📋 Scadenzario Lista
          </button>
        </div>

        <button
          type="button"
          onClick={async () => {
            // §3.3 — `triggerCronScadenzeApi` lancia davvero: il successo si annuncia solo con il
            // report restituito dal server, mai con un messaggio inventato.
            try {
              const res = await triggerCronScadenzeApi();
              alert(res?.message || '✓ Scansione cron completata con successo!');
              await onRicarica();
            } catch (err: any) {
              alert(`⚠️ Scansione cron NON eseguita: ${err?.message || 'errore di rete'}. Le notifiche di scadenza NON sono state inviate.`);
            }
          }}
          style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca', padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
        >
          ⏰ Esegui Cron Notifiche
        </button>

        <button
          type="button"
          onClick={onNuovo}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
        >
          + Nuovo Evento Studio
        </button>
      </div>
    </div>
  );
}
