// Piano firma §3.3 — il livello legale che l'atto in composizione esige. Nasce da quello del
// modello, che è anche il minimo (titolare, 28/11/2026): i livelli più bassi sono spenti e la
// riga sotto dice perché. Lo stesso limite lo applica il server al salvataggio.
import { sottoIlMinimo, spiegaMinimoFirma, type LivelloFirma } from '../../utils/livelloFirmaMinimo';

const LIVELLI: Array<{ id: LivelloFirma; icon: string; titolo: string; desc: string }> = [
  {
    id: 'ses',
    icon: '📱',
    titolo: 'SES — Semplice',
    desc: 'Firma elettronica semplice (art. 20 CAD / eIDAS art. 3 n. 10). Il flusso OTP attuale.',
  },
  {
    id: 'fea',
    icon: '🧠',
    titolo: 'FEA — Avanzata',
    desc: 'Firma elettronica avanzata (eIDAS art. 26): il cliente firma dal Portale con flusso certificato — OTP verificato, firma grafica obbligatoria e firmatario verificato in anagrafica.',
  },
  {
    id: 'feq',
    icon: '🔐',
    titolo: 'FEQ — Qualificata',
    desc: 'Firma elettronica qualificata (eIDAS art. 25): solo tramite provider esterno del cliente (file .p7m).',
  },
];

export function LivelloFirmaAtto({ titoloDocumento, livello, minimo, onScegli }: {
  titoloDocumento: string;
  livello: LivelloFirma;
  /** Il livello del modello da cui l'atto nasce: sotto questo non si scende. */
  minimo: LivelloFirma;
  onScegli: (livello: LivelloFirma) => void;
}) {
  const spiegazione = spiegaMinimoFirma(minimo);
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px' }}>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 8 }}>
        ⚖️ Livello Legale Richiesto all'Atto — "{titoloDocumento}"
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {LIVELLI.map((l) => {
          const spento = sottoIlMinimo(l.id, minimo);
          const scelto = livello === l.id;
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={scelto}
              disabled={spento}
              title={spento ? spiegazione ?? undefined : undefined}
              onClick={() => onScegli(l.id)}
              style={{
                background: scelto ? 'var(--pill-indigo-bg)' : 'var(--card)',
                border: `1.5px solid ${scelto ? 'var(--indigo)' : 'var(--border)'}`,
                borderRadius: 10, padding: '9px 10px', textAlign: 'left',
                cursor: spento ? 'not-allowed' : 'pointer', opacity: spento ? 0.5 : 1,
                display: 'flex', flexDirection: 'column', gap: 3,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: scelto ? 'var(--pill-indigo-fg)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>{l.icon}</span> {l.titolo}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', lineHeight: 1.3 }}>{l.desc}</div>
            </button>
          );
        })}
      </div>
      {spiegazione && (
        <div role="note" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.4 }}>
          🔒 {spiegazione}
        </div>
      )}
      {livello === 'fea' && (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#6366f118', border: '1px solid #6366f150', fontSize: 10, color: 'var(--text)', lineHeight: 1.4 }}>
          ℹ️ Con livello <strong>FEA (Avanzata)</strong> il cliente firmerà dal Portale con il flusso certificato completo: verifica OTP, firma grafica obbligatoria, firmatario verificato in anagrafica e documento d'identità (eIDAS art. 26 · art. 25 CAD).
        </div>
      )}
      {livello === 'feq' && (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#f59e0b18', border: '1px solid #f59e0b50', fontSize: 10, color: 'var(--muted)', lineHeight: 1.4 }}>
          ⚠️ Con livello <strong>FEQ (Qualificata)</strong> il server blocca il flusso OTP: il cliente dovrà firmare con il proprio provider di firma digitale qualificata (es. Aruba, InfoCert, Namirial, SPID/CIE) e caricare il file firmato.
        </div>
      )}
    </div>
  );
}
