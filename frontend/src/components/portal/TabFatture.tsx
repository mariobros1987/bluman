import { fmt } from '../../utils';
import type { FatturaPortale } from '../../api/client';
import { docBoxStyle } from './styles';

export interface TabFattureProps {
  fatturePortale: FatturaPortale[];
  fattureErrore: string | null;
  fattureCaricamento: boolean;
  caricaFatturePortale: (clienteIdSessione?: string | null) => Promise<void>;
  clientObj: any;
}

export function TabFatture({
  fatturePortale,
  fattureErrore,
  fattureCaricamento,
  caricaFatturePortale,
  clientObj,
}: TabFattureProps) {
  return (
    <div style={docBoxStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>💳 Fatture & Stato dei Pagamenti</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Le fatture emesse sui tuoi incarichi, con l'importo, lo stato di incasso e la prossima scadenza. Le bozze non ancora emesse restano allo studio.
          </div>
        </div>
        <button
          type="button"
          onClick={() => caricaFatturePortale(clientObj?.id)}
          disabled={fattureCaricamento}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: fattureCaricamento ? 'default' : 'pointer' }}
        >
          {fattureCaricamento ? 'Aggiorno…' : '↻ Aggiorna'}
        </button>
      </div>

      {fattureErrore && (
        <div style={{ background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bd)', color: 'var(--pill-red-fg)', borderRadius: 12, padding: 14, fontSize: 12, marginBottom: 14 }}>
          <strong>Non riesco a leggere le fatture.</strong> {fattureErrore}
        </div>
      )}

      {!fattureErrore && fatturePortale.length === 0 && (
        <div style={{ background: 'var(--card2)', border: '1px dashed var(--border)', borderRadius: 12, padding: 22, textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>🧾</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            {fattureCaricamento ? 'Sto leggendo le fatture…' : 'Nessuna fattura emessa'}
          </div>
          {!fattureCaricamento && (
            <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              Lo studio non ha ancora emesso fatture sui tuoi incarichi. Quando lo farà le troverai qui, con lo stato di pagamento.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fatturePortale.map((f) => (
          <div
            key={f.id}
            style={{
              background: f.pagata ? 'var(--pill-green-bg)' : 'var(--card2)',
              border: `1px solid ${f.pagata ? 'var(--pill-green-bd)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '14px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 22 }}>{f.tipoDocumento === 'nota_credito' ? '↩️' : '🧾'}</div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {f.tipoDocumento === 'nota_credito' ? 'Nota di Credito' : 'Fattura'} {f.numero}
                  </span>
                  {f.progetto && (
                    <span style={{ fontSize: 10, background: 'var(--card)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>{f.progetto}</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: f.pagata ? 'var(--pill-green-fg)' : 'var(--muted)', marginTop: 3 }}>
                  {f.data ? `Emessa il ${new Date(f.data).toLocaleDateString('it-IT')}` : 'Data non indicata'}
                  {f.pagata
                    ? ' · ✓ Pagata'
                    : f.prossimaScadenza
                      ? ` · Scadenza ${new Date(f.prossimaScadenza.dataScadenza).toLocaleDateString('it-IT')} (${fmt(f.prossimaScadenza.importoCentesimi / 100)})`
                      : ' · In attesa di pagamento'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  background: f.pagata ? 'var(--green)' : 'var(--amber)',
                  color: '#000',
                  fontSize: 10.5,
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: 12,
                }}
              >
                {f.pagata ? '✓ INCASSATA' : '⏳ DA INCASSARE'}
              </span>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--indigo-l)' }}>{fmt(f.totaleCentesimi / 100)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
