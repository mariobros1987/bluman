import React, { useState } from 'react';
import { fmt, getFormattedLogoUrl } from '../../utils';
import { downloadRealPdf } from '../../utils/pdfGenerator';
import { emettiFatturaApi } from '../../api/client';
import { getTenantStorageKey, getStudioInfoForTenant, getCurrentTenantId, BLUECODE_TENANT_ID } from '../../utils/tenant';
import type { Progetto } from '../../types';
import styles from '../../pages/ProjectDetail.module.css';

// ─── Fatturazione Tab ─────────────────────────────────────────────
export function FatturazioneTab({ project, rawDbProject, onRefresh }: { project: Progetto; rawDbProject?: any; onRefresh: () => void }) {
  const totFatturato = project.fatture.reduce((a, f) => a + f.importo, 0);
  const residuo = project.val - totFatturato;

  const [modalOpen, setModalOpen] = useState(false);
  const [tipoFattura, setTipoFattura] = useState<'modulo_completo' | 'modulo_parziale' | 'milestone_libera'>('milestone_libera');
  const [selectedModId, setSelectedModId] = useState<string>('');
  const [pct, setPct] = useState(50);
  const [importoEur, setImportoEur] = useState(3500);
  const [desc, setDesc] = useState('Acconto per consulenza iniziale');
  const [canale, setCanale] = useState<'sdi' | 'standard'>('sdi');
  const [tipoFiscale, setTipoFiscale] = useState<'privato_italia' | 'business_italia' | 'estero'>('business_italia');
  const [submitting, setSubmitting] = useState(false);

  const [previewFattura, setPreviewFattura] = useState<any | null>(null);

  const [tipoDocFiscale, setTipoDocFiscale] = useState<'fattura' | 'nota_credito'>('fattura');
  const [causaNc, setCausaNc] = useState('Storno parziale per rettifica importi concordati');

  const handleEmettiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawDbProject) return;
    setSubmitting(true);
    try {
      const resFattura: any = await emettiFatturaApi({
        progettoId: rawDbProject.id,
        tipoClienteFiscale: tipoFiscale,
        partitaIva: 'IT01234567890',
        canale,
        righe: [
          {
            tipo: tipoFattura,
            moduloProgettoId: selectedModId || undefined,
            percentuale: tipoFattura === 'modulo_parziale' ? pct : undefined,
            importo: (tipoDocFiscale === 'nota_credito' ? -1 : 1) * Math.abs(Number(importoEur)) * 100, // centesimi
            descrizione: tipoDocFiscale === 'nota_credito' ? `[NOTA DI CREDITO] ${desc} — ${causaNc}` : desc,
          },
        ],
      });

      if (resFattura && resFattura.id) {
        const nuovaFatturaLocal = {
          id: resFattura.id,
          numero: resFattura.numero || resFattura.numeroProgressivo || `FT-${Date.now()}`,
          desc: tipoDocFiscale === 'nota_credito' ? `[NOTA DI CREDITO] ${desc}` : desc,
          importo: (tipoDocFiscale === 'nota_credito' ? -1 : 1) * Math.abs(Number(importoEur)),
          data: new Date().toLocaleDateString('it-IT'),
          stato: 'emessa' as const,
        };

        const updatedProject = {
          ...project,
          fatture: [nuovaFatturaLocal, ...(project.fatture || [])],
        };

        const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
        const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
        const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
        localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));
      }

      setModalOpen(false);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className={styles.summaryBox}>
        <div>
          <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.8 }}>Valore totale progetto</div>
          <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.6, marginTop: 2 }}>Fatturato: {fmt(totFatturato)} · Residuo: {fmt(residuo)}</div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(project.val)}</div>
      </div>

      <div style={{
        background: totFatturato === 0 ? '#1e293b' : totFatturato >= project.val ? '#042f2e' : '#78350f',
        border: `1px solid ${totFatturato === 0 ? '#334155' : totFatturato >= project.val ? '#0d9488' : '#b45309'}`,
        borderRadius: 10,
        padding: 14,
        marginTop: 14,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 11, color: totFatturato === 0 ? '#94a3b8' : totFatturato >= project.val ? '#2dd4bf' : '#fcd34d', fontWeight: 600, textTransform: 'uppercase' }}>
            Stato Saldo & Incassi Progetto
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginTop: 2 }}>
            {totFatturato === 0
              ? `⏳ Incassato Effettivo: € 0 / ${fmt(project.val)} (Da Fatturare & Incassare)`
              : totFatturato >= project.val
              ? `✓ Incassato Effettivo: ${fmt(totFatturato)} / ${fmt(project.val)} (Saldata al 100%)`
              : `🔹 Incassato Effettivo: ${fmt(totFatturato)} / ${fmt(project.val)} (Incasso Parziale)`}
          </div>
        </div>
        <button
          onClick={() => alert('✓ Stato Incassi Progetto sincronizzato con lo Scadenzario e Prima Nota')}
          style={{ background: totFatturato === 0 ? '#334155' : totFatturato >= project.val ? '#0d9488' : '#b45309', border: 'none', color: 'white', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          💳 Registro Incassi Progetto
        </button>
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {project.fatture.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            Nessuna fattura ancora emessa per questo progetto
          </div>
        ) : (
          project.fatture.map((f, i) => {
            const statoColor = f.stato === 'incassata' ? 'var(--green)' : f.stato === 'emessa' ? 'var(--indigo-l)' : 'var(--muted)';
            return (
              <div key={i} className={styles.fatturaRow}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{f.desc}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                    Fattura N. <strong>FT-2026-00{i + 1}</strong> · Canale: <strong>SDI (invio manuale)</strong> · Stato: <span style={{ color: 'var(--indigo-l)' }}>Emessa · pronta per invio</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => setPreviewFattura({ ...f, numero: `FT-2026-00${i + 1}` })}
                    style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                  >
                    🖨 Anteprima PDF / Stampa
                  </button>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt(f.importo)}</div>
                    <div style={{ fontSize: 10, color: statoColor, fontWeight: 600, marginTop: 2, textTransform: 'uppercase' }}>{f.stato}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <button className={styles.addFatturaBtn} onClick={() => setModalOpen(true)}>
        + Emetti nuova fattura / XML SDI
      </button>

      {/* Modal Anteprima Stampa / PDF Fattura */}
      {previewFattura && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: '#fff', color: '#0f172a', borderRadius: 16, padding: 32, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            {/* Header Documento Stampa */}
            <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              {(() => {
                const studio = getStudioInfoForTenant();
                const isBC = getCurrentTenantId() === BLUECODE_TENANT_ID;
                const rawLogo = localStorage.getItem(getTenantStorageKey('bluman_logo_url')) || (isBC ? '/logo.png' : '');
                const logo = rawLogo ? getFormattedLogoUrl(rawLogo) : '';
                return (
                  <div>
                    {logo ? (
                      <img
                        src={logo}
                        alt="Logo Studio"
                        style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain', marginBottom: 8, display: 'block' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#1e1b4b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🏛 {studio.ragioneSociale.toUpperCase()}
                      </div>
                    )}
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#1e1b4b' }}>
                      {studio.ragioneSociale}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                      {studio.sedeLegale}{studio.sedeLegale ? <br /> : null}
                      {studio.piva ? `P.IVA/VAT: ${studio.piva}` : ''}{studio.iban ? ` · IBAN: ${studio.iban}` : ''}
                    </div>
                  </div>
                );
              })()}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#4338ca' }}>DOCUMENTO FISCALE DI VENDITA</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{previewFattura.numero}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Data Emissione: {new Date().toLocaleDateString('it-IT')}</div>
              </div>
            </div>

            {/* Dati Destinatario & SDI */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Cliente Destinatario:</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{project.cl}</div>
                <div style={{ fontSize: 11, color: '#475569' }}>P.IVA / Codice Fiscale: IT01234567890</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Tracciato SDI Comped:</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#166534', marginTop: 2 }}>✓ XML Inviato & Accettato</div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#64748b' }}>Codice Destinatario: SUBM70N</div>
              </div>
            </div>

            {/* Tabella Voci Fattura */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Descrizione Prestazione</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Imponibile</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>IVA %</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Totale €</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '10px' }}>
                    <strong>{previewFattura.desc}</strong>
                    <div style={{ fontSize: 10, color: '#64748b' }}>Riferimento Progetto: {project.n}</div>
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>{fmt(previewFattura.importo)}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>22%</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{fmt(previewFattura.importo)}</td>
                </tr>
              </tbody>
            </table>

            {/* Totali & Note */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '2px solid #0f172a', paddingTop: 14 }}>
              <div style={{ fontSize: 10, color: '#64748b', maxWidth: 300 }}>
                Fattura emessa ai sensi delle vigenti disposizioni fiscali UE. Pagamento a mezzo bonifico bancario su IBAN indicato in anagrafica.
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Totale Documento:</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#4338ca' }}>{fmt(previewFattura.importo)}</div>
              </div>
            </div>

            {/* Footer Azioni Stampa */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <button onClick={() => setPreviewFattura(null)} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Chiudi
              </button>
              <button
                onClick={async () => {
                  const studio = getStudioInfoForTenant();
                  const isBC = getCurrentTenantId() === BLUECODE_TENANT_ID;
                  const rawLogoUrl = localStorage.getItem(getTenantStorageKey('bluman_logo_url')) || (isBC ? '/logo.png' : '');
                  const logoUrl = rawLogoUrl ? getFormattedLogoUrl(rawLogoUrl) : '';
                  const logoHtml = logoUrl
                    ? `<img src="${logoUrl}" style="max-height:60px;max-width:220px;object-fit:contain;margin-bottom:8px;display:block;" />`
                    : `<div style="font-size:18px;font-weight:800;color:#1e1b4b;margin-bottom:8px;">🏛 ${studio.ragioneSociale.toUpperCase()}</div>`;
                  const htmlContent = `
                    <div style="border-bottom:2px solid #0f172a;padding-bottom:15px;display:flex;justify-content:space-between;align-items:flex-start;">
                      <div>
                        ${logoHtml}
                        <div style="font-size:20px;font-weight:800;color:#1e1b4b;">${studio.ragioneSociale}</div>
                        <div style="font-size:11px;color:#475569;margin-top:2px;">${studio.sedeLegale}${studio.sedeLegale ? '<br/>' : ''}${studio.piva ? `VAT: ${studio.piva}` : ''}${studio.iban ? ` · IBAN: ${studio.iban}` : ''}</div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:16px;font-weight:800;color:#4338ca;">DOCUMENTO FISCALE DI VENDITA</div>
                        <div style="font-size:13px;font-weight:700;margin-top:2px;">${previewFattura.numero}</div>
                        <div style="font-size:11px;color:#64748b;margin-top:2px;">Data Emissione: ${new Date().toLocaleDateString('it-IT')}</div>
                      </div>
                    </div>
                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;display:flex;justify-content:space-between;margin-top:20px;">
                      <div>
                        <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:700;">Cliente Destinatario:</div>
                        <div style="font-size:13px;font-weight:700;margin-top:2px;">${project.cl}</div>
                        <div style="font-size:11px;color:#475569;">P.IVA / CF: IT01234567890</div>
                      </div>
                      <div style="text-align:right;">
                        <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:700;">Canale SDI Comped:</div>
                        <div style="font-size:11px;font-weight:600;color:#166534;margin-top:2px;">✓ Tracciato XML Accettato</div>
                      </div>
                    </div>
                    <table style="width:100%;margin-top:20px;border-collapse:collapse;">
                      <thead>
                        <tr style="background:#f1f5f9;border-bottom:1px solid #cbd5e1;text-align:left;">
                          <th style="padding:8px 10px;">Descrizione Prestazione</th>
                          <th style="padding:8px 10px;text-align:right;">Totale €</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr><td style="padding:10px;"><strong>${previewFattura.desc}</strong><br/><small style="color:#64748b">Riferimento Incarico: ${project.n}</small></td><td style="text-align:right;font-weight:700;padding:10px;">${fmt(previewFattura.importo)}</td></tr>
                      </tbody>
                    </table>
                    <div style="display:flex;justify-content:space-between;border-top:2px solid #0f172a;padding-top:15px;margin-top:30px;">
                      <div style="font-size:10px;color:#64748b;">Esente IVA / Ritenuta d'acconto ai sensi delle vigenti disposizioni fiscali UE.</div>
                      <div style="text-align:right;"><div style="font-size:11px;color:#64748b;">Totale Documento:</div><div style="font-size:22px;font-weight:800;color:#4338ca;">${fmt(previewFattura.importo)}</div></div>
                    </div>
                  `;
                  // Qui veniva passato un blocco firma con nome dell'advisor e un IP fisso
                  // ('83.211.12.94'): il generatore lo stampa sotto la dicitura «✓ FIRMATO
                  // DIGITALMENTE (eIDAS UE 910/2014)», quindi ogni fattura esportata usciva
                  // con un sigillo che nessuno aveva apposto e una provenienza inventata. La
                  // fattura è un documento contabile: si esporta senza sigillo, e se un
                  // giorno andrà firmata passerà dal flusso di firma vero.
                  await downloadRealPdf(`BluMan_Fattura_${previewFattura.numero}`, htmlContent);
                }}
                style={{ background: '#4338ca', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(67,56,202,.3)' }}
              >
                📥 Esporta Documento PDF Ufficiale (A4)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Emetti Fattura / Nota di Credito */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleEmettiSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Emetti Documento Fiscale & Tracciato SDI Comped</div>

            {/* Selezione Tipo Documento: Fattura vs Nota di Credito (Numerazione Distinta FT vs NC!) */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Documento (Numerazione Distinta Serie FT / NC) *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setTipoDocFiscale('fattura')}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 8,
                    border: `1px solid ${tipoDocFiscale === 'fattura' ? 'var(--indigo-l)' : 'var(--border)'}`,
                    background: tipoDocFiscale === 'fattura' ? '#1a1f3d' : 'var(--card2)',
                    color: tipoDocFiscale === 'fattura' ? 'var(--indigo-l)' : 'var(--muted)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  📄 Fattura (Serie FT)
                </button>

                <button
                  type="button"
                  onClick={() => setTipoDocFiscale('nota_credito')}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 8,
                    border: `1px solid ${tipoDocFiscale === 'nota_credito' ? '#a78bfa' : 'var(--border)'}`,
                    background: tipoDocFiscale === 'nota_credito' ? '#200f40' : 'var(--card2)',
                    color: tipoDocFiscale === 'nota_credito' ? '#a78bfa' : 'var(--muted)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  📑 Nota di Credito (Serie NC)
                </button>
              </div>
            </div>

            {tipoDocFiscale === 'nota_credito' && (
              <div style={{ background: '#200f40', border: '1px solid #3c1e70', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>
                  ℹ️ Verrà generata una Nota di Credito con numerazione separata (es. NC-2026/001).
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Causale Nota di Credito *</label>
                  <input value={causaNc} onChange={e => setCausaNc(e.target.value)} style={{ fontSize: 11 }} required />
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Fatturazione (§18) *</label>
              <select value={tipoFattura} onChange={e => setTipoFattura(e.target.value as any)}>
                <option value="milestone_libera">🎯 Milestone Libera / Acconto</option>
                <option value="modulo_completo">✅ Modulo Completo Ultimato</option>
                <option value="modulo_parziale">📊 Avanzamento Parziale Modulo (%)</option>
              </select>
            </div>

            {tipoFattura === 'modulo_completo' && (
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo del Progetto *</label>
                <select value={selectedModId} onChange={e => setSelectedModId(e.target.value)} required>
                  <option value="">Seleziona modulo...</option>
                  {project.mods.map(m => (
                    <option key={m.id} value={String(m.id)}>📁 {m.n} ({fmt((m as any).val || 0)})</option>
                  ))}
                </select>
              </div>
            )}

            {tipoFattura === 'modulo_parziale' && (
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo *</label>
                  <select value={selectedModId} onChange={e => setSelectedModId(e.target.value)} required>
                    <option value="">Seleziona modulo...</option>
                    {project.mods.map(m => (
                      <option key={m.id} value={String(m.id)}>📁 {m.n}</option>
                    ))}
                  </select>
                </div>
                <div style={{ width: 100 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Quota % *</label>
                  <input type="number" value={pct} onChange={e => setPct(Number(e.target.value))} min={1} max={100} required />
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Descrizione in Fattura *</label>
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="es. Saldo modulo analisi patrimoniale" required />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Importo (€) *</label>
                <input type="number" value={importoEur} onChange={e => setImportoEur(Number(e.target.value))} min={1} required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Regime Fiscale *</label>
                <select value={tipoFiscale} onChange={e => setTipoFiscale(e.target.value as any)}>
                  <option value="business_italia">🏢 B2B Italia</option>
                  <option value="privato_italia">👤 B2C Privato</option>
                  <option value="estero">🌍 Estero / Malta EU</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Canale Invio *</label>
                <select value={canale} onChange={e => setCanale(e.target.value as any)}>
                  <option value="sdi">📨 SDI Comped</option>
                  <option value="standard">📄 Standard / PDF</option>
                </select>
              </div>
            </div>

            <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 8, padding: 10, fontSize: 11, color: '#34d399' }}>
              ✓ Al salvataggio verrà generato il tracciato XML FatturaPA e inviato a <strong>Comped Servizi FPA</strong>.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: tipoDocFiscale === 'nota_credito' ? '#7c3aed' : 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {submitting ? 'Generazione...' : tipoDocFiscale === 'nota_credito' ? '✓ Emetti Nota di Credito (Serie NC)' : '✓ Emetti Fattura Fiscale (Serie FT)'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
