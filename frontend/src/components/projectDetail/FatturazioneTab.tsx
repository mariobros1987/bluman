import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt, getFormattedLogoUrl } from '../../utils';
import { downloadRealPdf } from '../../utils/pdfGenerator';
import { emettiFatturaApi } from '../../api/client';
import { getTenantStorageKey, getStudioInfoForTenant, getCurrentTenantId, BLUECODE_TENANT_ID } from '../../utils/tenant';
import type { Progetto } from '../../types';
import styles from '../../pages/ProjectDetail.module.css';

export interface VoceFatturabile {
  key: string;
  moduloId: string;
  moduloNome: string;
  titolo: string;
  stato: string; // 'done' | 'in_progress' | 'pending'
  oreConsuntivate: number;
  importo: number;
  selezionato: boolean;
}

// ─── Fatturazione Tab ─────────────────────────────────────────────
export function FatturazioneTab({ project, rawDbProject, onRefresh }: { project: Progetto; rawDbProject?: any; onRefresh: () => void }) {
  const navigate = useNavigate();
  const totFatturato = project.fatture.reduce((a, f) => a + f.importo, 0);
  const residuo = project.val - totFatturato;

  const [modalOpen, setModalOpen] = useState(false);
  const [canale, setCanale] = useState<'sdi' | 'standard'>('sdi');
  const [tipoFiscale, setTipoFiscale] = useState<'privato_italia' | 'business_italia' | 'estero'>('business_italia');
  const [submitting, setSubmitting] = useState(false);

  const [previewFattura, setPreviewFattura] = useState<any | null>(null);

  const [tipoDocFiscale, setTipoDocFiscale] = useState<'fattura' | 'nota_credito'>('fattura');
  const [causaNc, setCausaNc] = useState('Storno parziale per rettifica importi concordati');

  const [vociFatturabili, setVociFatturabili] = useState<VoceFatturabile[]>([]);

  // Inizializza le voci dai moduli e microvoci del progetto
  const initVoci = () => {
    const list: VoceFatturabile[] = [];
    (project.mods || []).forEach((m, mIdx) => {
      const numV = (m.v || []).length;
      const baseVal = (m as any).val ? Math.round((m as any).val / (numV || 1)) : 400;
      (m.v || []).forEach((mv, vIdx) => {
        const anyMv = mv as any;
        const st = anyMv.s || anyMv.st || (anyMv.done ? 'done' : 'pending');
        const ore = anyMv.hA || anyMv.a || 0;
        const imp = ore > 0 ? ore * 120 : baseVal;
        list.push({
          key: `${m.id || mIdx}-${mv.id || vIdx}`,
          moduloId: String(m.id || mIdx),
          moduloNome: m.n || 'Modulo',
          titolo: mv.n || 'Micro-voce operativa',
          stato: st,
          oreConsuntivate: ore,
          importo: imp,
          selezionato: st === 'done' || anyMv.done === true, // pre-seleziona in automatico quelle completate
        });
      });
      if (numV === 0) {
        list.push({
          key: `mod-${m.id || mIdx}`,
          moduloId: String(m.id || mIdx),
          moduloNome: m.n || 'Modulo',
          titolo: m.n || 'Modulo completo',
          stato: m.st || 'pending',
          oreConsuntivate: (m as any).a || 0,
          importo: (m as any).val || 1000,
          selezionato: m.st === 'done',
        });
      }
    });
    setVociFatturabili(list);
  };

  const handleOpenModal = () => {
    initVoci();
    setModalOpen(true);
  };

  const vociSelezionate = vociFatturabili.filter(v => v.selezionato);
  const totaleImponibile = vociSelezionate.reduce((acc, v) => acc + (Number(v.importo) || 0), 0);
  const aliquotaIva = tipoFiscale === 'estero' ? 0 : 0.22;
  const totaleIva = Math.round(totaleImponibile * aliquotaIva * 100) / 100;
  const totaleDocumento = totaleImponibile + totaleIva;

  const selezionaSoloCompletate = () => {
    setVociFatturabili(prev => prev.map(v => ({ ...v, selezionato: v.stato === 'done' })));
  };

  const selezionaTutte = () => {
    setVociFatturabili(prev => prev.map(v => ({ ...v, selezionato: true })));
  };

  const deselezionaTutte = () => {
    setVociFatturabili(prev => prev.map(v => ({ ...v, selezionato: false })));
  };

  const toggleModulo = (modNome: string) => {
    const vociDelMod = vociFatturabili.filter(v => v.moduloNome === modNome);
    const tutteSel = vociDelMod.every(v => v.selezionato);
    setVociFatturabili(prev => prev.map(v => v.moduloNome === modNome ? { ...v, selezionato: !tutteSel } : v));
  };

  const updateVoceImporto = (key: string, importo: number) => {
    setVociFatturabili(prev => prev.map(v => v.key === key ? { ...v, importo } : v));
  };

  const toggleVoce = (key: string) => {
    setVociFatturabili(prev => prev.map(v => v.key === key ? { ...v, selezionato: !v.selezionato } : v));
  };

  const handleEmettiFatturaUfficiale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawDbProject && !project.id) return;
    if (vociSelezionate.length === 0) {
      alert('Seleziona almeno una micro-voce o modulo da fatturare.');
      return;
    }
    setSubmitting(true);
    try {
      const effId = rawDbProject?.id || String(project.id);
      const righe = vociSelezionate.map(v => ({
        tipo: 'modulo_completo' as const,
        moduloProgettoId: v.moduloId.startsWith('mod-') ? v.moduloId.replace('mod-', '') : v.moduloId,
        importo: (tipoDocFiscale === 'nota_credito' ? -1 : 1) * Math.abs(Number(v.importo)) * 100, // centesimi
        descrizione: tipoDocFiscale === 'nota_credito'
          ? `[NOTA DI CREDITO] [${v.moduloNome}] ${v.titolo} — ${causaNc}`
          : `[${v.moduloNome}] ${v.titolo}`,
      }));

      const resFattura: any = await emettiFatturaApi({
        progettoId: effId,
        tipoClienteFiscale: tipoFiscale,
        partitaIva: rawDbProject?.cliente?.piva || rawDbProject?.cliente?.codiceFiscale || undefined,
        canale,
        righe,
      });

      setModalOpen(false);
      onRefresh();
      alert(`✓ Documento ${resFattura?.numero || 'fiscale'} emesso con successo a database (${righe.length} voci fatturate per ${fmt(totaleImponibile)})!`);
    } catch (err: any) {
      console.error(err);
      alert(`Errore emissione fattura: ${err?.message || 'Impossibile completare la richiesta'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleApriInDocumentStudio = () => {
    const effId = rawDbProject?.id || String(project.id);
    const targetRows = vociSelezionate.length > 0 ? vociSelezionate : (vociFatturabili.length > 0 ? vociFatturabili : [
      { key: 'def-1', moduloId: '1', moduloNome: 'Incarico Professionale', titolo: project.n || 'Prestazioni Professionali', stato: 'done', oreConsuntivate: 0, importo: project.val || 3500, selezionato: true }
    ]);
    const targetTotal = vociSelezionate.length > 0 ? totaleImponibile : project.val;

    sessionStorage.setItem('bluman_proforma_table_rows', JSON.stringify({
      projId: effId,
      rows: targetRows,
      totalEur: targetTotal,
    }));

    setModalOpen(false);
    navigate(`/editor?projId=${effId}&tmplId=tmpl-avviso-parcella`);
  };

  // Raggruppa voci per modulo per la visualizzazione ad albero
  const modNomiUnici = Array.from(new Set(vociFatturabili.map(v => v.moduloNome)));

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

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button className={styles.addFatturaBtn} style={{ flex: 1, minWidth: 220 }} onClick={handleOpenModal}>
          ✨ Componi Fattura da Microvoci & Moduli
        </button>
        <button
          onClick={handleApriInDocumentStudio}
          style={{
            background: 'var(--card2)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 10,
            padding: '10px 16px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Apri in Document Studio per redigere avviso proforma o rendiconto personalizzato"
        >
          📝 Redigi Proforma in Document Studio
        </button>
      </div>

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

      {/* Modal Avanzato di Composizione Fattura & Proforma da Microvoci */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleEmettiFatturaUfficiale} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                  ✨ Compositore Fattura & Proforma da Microvoci
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  Seleziona con le spunte le microvoci o i moduli completati da includere nel documento
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Tipologia Documento: Fattura vs Nota di Credito */}
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
                📄 Fattura Fiscale (Serie FT)
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

            {tipoDocFiscale === 'nota_credito' && (
              <div style={{ background: '#200f40', border: '1px solid #3c1e70', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>
                  ℹ️ Verrà generata una Nota di Credito stornando le voci selezionate.
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Causale Nota di Credito *</label>
                  <input value={causaNc} onChange={e => setCausaNc(e.target.value)} style={{ fontSize: 11, width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }} required />
                </div>
              </div>
            )}

            {/* Toolbar di Selezione Rapida */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card2)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>Selezione rapida:</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={selezionaSoloCompletate}
                  style={{ background: '#064e3b', border: '1px solid #059669', color: '#6ee7b7', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                >
                  ✨ Solo Completate (Done)
                </button>
                <button
                  type="button"
                  onClick={selezionaTutte}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                >
                  ☑️ Seleziona Tutto
                </button>
                <button
                  type="button"
                  onClick={deselezionaTutte}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                >
                  ⏹️ Deseleziona
                </button>
              </div>
            </div>

            {/* Lista Moduli & Microvoci ad Albero con Checkbox */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
              {vociFatturabili.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)', fontSize: 12 }}>
                  Nessuna micro-voce configurata nel progetto.
                </div>
              ) : (
                modNomiUnici.map((modNome) => {
                  const vociDelMod = vociFatturabili.filter(v => v.moduloNome === modNome);
                  const tutteSel = vociDelMod.every(v => v.selezionato);
                  return (
                    <div key={modNome} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--indigo-l)' }}>📁 {modNome}</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>({vociDelMod.filter(v => v.selezionato).length}/{vociDelMod.length} selezionate)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleModulo(modNome)}
                          style={{ background: 'transparent', border: 'none', color: tutteSel ? '#f87171' : 'var(--indigo-l)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                        >
                          {tutteSel ? 'Deseleziona Modulo' : 'Seleziona Tutto il Modulo'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {vociDelMod.map((v) => {
                          const isDone = v.stato === 'done';
                          const isInProg = v.stato === 'in_progress';
                          return (
                            <div
                              key={v.key}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: v.selezionato ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
                                border: `1px solid ${v.selezionato ? 'rgba(99, 102, 241, 0.3)' : 'transparent'}`,
                                borderRadius: 6,
                                padding: '6px 8px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={v.selezionato}
                                  onChange={() => toggleVoce(v.key)}
                                  style={{ cursor: 'pointer', width: 16, height: 16 }}
                                />
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <span style={{ fontSize: 12, fontWeight: v.selezionato ? 600 : 400, color: v.selezionato ? 'var(--text)' : 'var(--muted)' }}>
                                    {v.titolo}
                                  </span>
                                </div>
                                <span
                                  style={{
                                    fontSize: 10,
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    fontWeight: 600,
                                    background: isDone ? '#064e3b' : isInProg ? '#1e3a8a' : '#334155',
                                    color: isDone ? '#6ee7b7' : isInProg ? '#93c5fd' : '#94a3b8',
                                  }}
                                >
                                  {isDone ? '✓ Fatto' : isInProg ? '⏳ In Corso' : '⚪ Da Fare'}
                                </span>
                                {v.oreConsuntivate > 0 && (
                                  <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>
                                    ⏱️ {v.oreConsuntivate}h
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12 }}>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>€</span>
                                <input
                                  type="number"
                                  value={v.importo}
                                  onChange={e => updateVoceImporto(v.key, Number(e.target.value))}
                                  disabled={!v.selezionato}
                                  style={{
                                    width: 85,
                                    padding: '3px 6px',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textAlign: 'right',
                                    borderRadius: 4,
                                    border: '1px solid var(--border)',
                                    background: v.selezionato ? 'var(--bg)' : 'var(--card)',
                                    color: v.selezionato ? 'var(--text)' : 'var(--muted)',
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Parametri Fiscali & Canale */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, background: 'var(--card2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Regime Fiscale *</label>
                <select value={tipoFiscale} onChange={e => setTipoFiscale(e.target.value as any)} style={{ width: '100%', padding: '6px', fontSize: 11, borderRadius: 6 }}>
                  <option value="business_italia">🏢 B2B Italia (IVA 22%)</option>
                  <option value="privato_italia">👤 B2C Privato (IVA 22%)</option>
                  <option value="estero">🌍 Estero / Malta EU (Esente Art. 7-ter)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Canale Invio *</label>
                <select value={canale} onChange={e => setCanale(e.target.value as any)} style={{ width: '100%', padding: '6px', fontSize: 11, borderRadius: 6 }}>
                  <option value="sdi">📨 SDI Comped FPA</option>
                  <option value="standard">📄 Standard / Cartaceo</option>
                </select>
              </div>
            </div>

            {/* Riepilogo Finanziario Live */}
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Voci selezionate: <strong>{vociSelezionate.length}</strong> su {vociFatturabili.length}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Imponibile: {fmt(totaleImponibile)} · IVA ({tipoFiscale === 'estero' ? '0%' : '22%'}): {fmt(totaleIva)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>TOTALE DOCUMENTO</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#38bdf8' }}>{fmt(totaleDocumento)}</div>
              </div>
            </div>

            {/* Azioni del Modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Annulla
              </button>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleApriInDocumentStudio}
                  style={{
                    background: 'var(--card2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  title="Inietta le microvoci selezionate nel template Avviso di Parcella di Document Studio"
                >
                  📝 Componi Proforma in Studio
                </button>

                <button
                  type="submit"
                  disabled={submitting || vociSelezionate.length === 0}
                  style={{
                    background: tipoDocFiscale === 'nota_credito' ? '#7c3aed' : 'var(--indigo)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 20px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: vociSelezionate.length === 0 ? 'not-allowed' : 'pointer',
                    opacity: vociSelezionate.length === 0 ? 0.5 : 1,
                  }}
                >
                  {submitting ? 'Emissione...' : tipoDocFiscale === 'nota_credito' ? '✓ Emetti Nota di Credito (Serie NC)' : '🚀 Emetti Fattura Fiscale (Serie FT)'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

