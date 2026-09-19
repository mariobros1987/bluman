interface InvoicePreviewModalProps {
  coloreTemaFattura: string;
  logoUrl: string;
  titoloIntestazione: string;
  ragioneSociale: string;
  sedeLegale: string;
  sedeOperativa: string;
  pIva: string;
  iban: string;
  mostraSdi: boolean;
  notePieDiPagina: string;
  setPreviewOpen: (v: boolean) => void;
}

// Modal Live Preview Fattura PDF (§Admin)
export function InvoicePreviewModal({
  coloreTemaFattura,
  logoUrl,
  titoloIntestazione,
  ragioneSociale,
  sedeLegale,
  sedeOperativa,
  pIva,
  iban,
  mostraSdi,
  notePieDiPagina,
  setPreviewOpen,
}: InvoicePreviewModalProps) {
  return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
          <div style={{ background: '#fff', color: 'var(--surface-2)', borderRadius: 16, padding: 32, width: '100%', maxWidth: 660, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            {/* Header Documento con Colore Personalizzato */}
            <div style={{ borderBottom: `3px solid ${coloreTemaFattura}`, paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                {logoUrl && (
                  <img src={logoUrl} alt="Logo Studio" style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain', marginBottom: 8, display: 'block' }} />
                )}
                <div style={{ fontSize: 20, fontWeight: 800, color: coloreTemaFattura }}>{titoloIntestazione || ragioneSociale}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  <strong>Sede Legale:</strong> {sedeLegale}<br />
                  <strong>Sede Operativa:</strong> {sedeOperativa}<br />
                  P.IVA/VAT: {pIva} · IBAN: {iban}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: coloreTemaFattura }}>FATTURA DI VENDITA</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>FT-2026-PREVIEW</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Data: {new Date().toLocaleDateString('it-IT')}</div>
              </div>
            </div>

            {/* Dati Cliente */}
            <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Cliente Destinatario:</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>Holding Beta S.r.l.</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>P.IVA: IT09876543210</div>
              </div>
              {mostraSdi && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Canale SDI (invio manuale):</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pill-green-fg)', marginTop: 2 }}>Codice destinatario SUBM70N</div>
                </div>
              )}
            </div>

            {/* Tabella Voci */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--pill-slate-fg)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Descrizione Incarico</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Imponibile</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Totale €</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>
                    <strong>Consulenza Structuring Holding & Protezione Patrimoniale</strong>
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>€ 5.000,00</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>€ 5.000,00</td>
                </tr>
              </tbody>
            </table>

            {/* Note Piè di Pagina */}
            <div style={{ borderTop: `2px solid ${coloreTemaFattura}`, paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 360 }}>
                {notePieDiPagina}<br />
                <strong>IBAN Bonifico:</strong> {iban}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Totale Documento:</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: coloreTemaFattura }}>€ 5.000,00</div>
              </div>
            </div>

            {/* Footer Modal */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <button onClick={() => setPreviewOpen(false)} style={{ background: 'var(--surface-1)', border: '1px solid var(--pill-slate-fg)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Chiudi Anteprima
              </button>
              <button onClick={() => window.print()} style={{ background: coloreTemaFattura, color: 'var(--on-accent)', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                🖨 Prova Stampa PDF
              </button>
            </div>
          </div>
        </div>
  );
}
