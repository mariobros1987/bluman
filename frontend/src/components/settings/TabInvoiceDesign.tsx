import React from 'react';
import { getFormattedLogoUrl } from '../../utils';
import { getBrandLogoFallback } from '../../utils/tenant';
import styles from '../../pages/Settings.module.css';

interface TabInvoiceDesignProps {
  setPreviewOpen: (v: boolean) => void;
  handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadingLogo: boolean;
  logoUrl: string;
  setColoreTemaFattura: (v: string) => void;
  coloreTemaFattura: string;
  titoloIntestazione: string;
  setTitoloIntestazione: (v: string) => void;
  notePieDiPagina: string;
  setNotePieDiPagina: (v: string) => void;
  mostraSdi: boolean;
  setMostraSdi: (v: boolean) => void;
  mostraIva: boolean;
  setMostraIva: (v: boolean) => void;
  handleSaveCompany: (e?: React.FormEvent) => void;
}

// TAB 2: Personalizzazione Layout Fattura PDF (§Admin)
export function TabInvoiceDesign({
  setPreviewOpen,
  handleLogoUpload,
  uploadingLogo,
  logoUrl,
  setColoreTemaFattura,
  coloreTemaFattura,
  titoloIntestazione,
  setTitoloIntestazione,
  notePieDiPagina,
  setNotePieDiPagina,
  mostraSdi,
  setMostraSdi,
  mostraIva,
  setMostraIva,
  handleSaveCompany,
}: TabInvoiceDesignProps) {
  return (
        <div className={styles.sectionBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>🎨 Configuratore Layout Fattura PDF & Stampa (Admin)</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Personalizza il logo dello studio, le note legali ed i colori per i PDF emessi ai clienti</div>
            </div>
            <button
              onClick={() => setPreviewOpen(true)}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              👁 Anteprima Live PDF Fattura
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 14 }}>
            {/* Logo Upload */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>🖼 Logo Ufficiale Studio (PDF & Stampa)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                style={{ background: 'var(--card)', padding: 8, borderRadius: 8, fontSize: 11, border: '1px solid var(--border)' }}
              />
              {uploadingLogo && <div style={{ fontSize: 10, color: 'var(--muted)' }}>Upload logo in corso...</div>}
              <div style={{ marginTop: 6, background: 'var(--surface-2)', padding: 12, borderRadius: 8, textAlign: 'center', border: '1px solid var(--pill-slate-bg)' }}>
                {getFormattedLogoUrl(logoUrl) || getBrandLogoFallback() ? (
                  <img
                    src={getFormattedLogoUrl(logoUrl) || getBrandLogoFallback()}
                    alt="Logo Studio"
                    style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain' }}
                    onError={(e) => {
                      const fb = getBrandLogoFallback();
                      const img = e.target as HTMLImageElement;
                      if (fb && img.src.indexOf(fb) === -1) img.src = fb;
                      else img.style.display = 'none';
                    }}
                  />
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nessun logo caricato</div>
                )}
              </div>
            </div>

            {/* Colore Tema */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>🎨 Colore Primario Layout Stampa</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { name: 'Indigo', hex: 'var(--indigo-d)' },
                  { name: 'Emerald', hex: 'var(--green)' },
                  { name: 'Navy', hex: 'var(--surface-2)' },
                  { name: 'Purple', hex: 'var(--purple)' },
                ].map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColoreTemaFattura(c.hex)}
                    style={{
                      flex: 1, padding: '8px', borderRadius: 8, border: `2px solid ${coloreTemaFattura === c.hex ? '#fff' : 'transparent'}`,
                      background: c.hex, color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolo / Intestazione Documento *</label>
              <input value={titoloIntestazione} onChange={e => setTitoloIntestazione(e.target.value)} required />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note di Piè di Pagina & Condizioni di Pagamento *</label>
              <textarea
                value={notePieDiPagina}
                onChange={e => setNotePieDiPagina(e.target.value)}
                rows={3}
                required
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: 10, fontSize: 12 }}
              />
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={mostraSdi} onChange={e => setMostraSdi(e.target.checked)} />
                <span>Mostra Dati Trasmissione SDI & Codice Destinatario</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={mostraIva} onChange={e => setMostraIva(e.target.checked)} />
                <span>Mostra Dettaglio Aliquote IVA e Ritenuta</span>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              onClick={() => handleSaveCompany()}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              ✓ Salva Personalizzazione Fattura PDF
            </button>
          </div>
        </div>
  );
}
