// Modulo estratto da ClientPortal.tsx (split meccanico, zero cambi di comportamento):
// Banner anteprima studio (§2.10) — avviso che i dati mostrati sono quelli del
// cliente scelto e selettore per cambiare cliente in anteprima.

export interface PortalStudioPreviewBannerProps {
  clientName: string;
  clientObj: any;
  elencoClienti: any[];
  handleSelectPreviewClient: (clienteId: string) => void;
}

export function PortalStudioPreviewBanner({
  clientName,
  clientObj,
  elencoClienti,
  handleSelectPreviewClient,
}: PortalStudioPreviewBannerProps) {
  return (
    <div style={{ margin: '0 0 12px', background: '#2a1f0d', border: '1px solid #b45309', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ color: '#fcd34d', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        👁 ANTEPRIMA STUDIO — Stai visualizzando il portale di <strong>{clientName}</strong>. Nessuna modifica è reale.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#fcd34d', fontSize: 11 }}>Cliente:</span>
        <select
          value={clientObj?.id || ''}
          onChange={(e) => handleSelectPreviewClient(e.target.value)}
          style={{ background: '#1c1608', color: '#fde68a', border: '1px solid #b45309', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          {elencoClienti.map((c: any) => (
            <option key={c.id} value={c.id} style={{ background: '#1c1608', color: '#fde68a' }}>{c.nome}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
