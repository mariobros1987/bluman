import React, { useState, useEffect } from 'react';
import { fetchUtentiTenant, creaUtenteTenantApi, uploadFileApi } from '../api/client';
import styles from './Settings.module.css';

type Tab = 'company' | 'users' | 'sdi' | 'invoice_design';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('company');
  const [saved, setSaved] = useState(false);

  // Form dati azienda (Sede Legale & Operativa)
  const [ragioneSociale, setRagioneSociale] = useState('Bluecode Ltd');
  const [pIva, setPIva] = useState('MT28491039');
  const [codFisc, setCodFisc] = useState('BLUCD90A01H501X');
  const [sedeLegale, setSedeLegale] = useState('Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta');
  const [sedeOperativa, setSedeOperativa] = useState('Via Montenapoleone 8, 20121 Milano (MI), Italia');
  const [email, setEmail] = useState('info@bluecode.advisory');
  const [pec, setPec] = useState('bluecode@legalmail.it');
  const [telefono, setTelefono] = useState('+356 2134 5678');
  const [iban, setIban] = useState('MT89VALL22013000000012345678');
  const [regimeFiscale, setRegimeFiscale] = useState('Ordinario / Malta EU Jurisdiction');
  const [capitaleSociale, setCapitaleSociale] = useState('€ 100.000,00 i.v.');
  const [regImprese, setRegImprese] = useState('Reg. Imprese C-99881 / REA 49021');

  // Personalizzazione Layout Fattura & PDF
  const [logoUrl, setLogoUrl] = useState('');
  const [coloreTemaFattura, setColoreTemaFattura] = useState('#4338ca'); // Indigo
  const [titoloIntestazione, setTitoloIntestazione] = useState('BLUECODE ADVISORY & CONSULTING');
  const [notePieDiPagina, setNotePieDiPagina] = useState('Fattura emessa ai sensi delle vigenti disposizioni fiscali UE. Pagamento a mezzo bonifico bancario su IBAN indicato.');
  const [mostraSdi, setMostraSdi] = useState(true);
  const [mostraIva, setMostraIva] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Form utenti
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [modalUserOpen, setModalUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'super_admin' | 'advisor' | 'operator'>('advisor');
  const [submittingUser, setSubmittingUser] = useState(false);

  const loadUsers = async () => {
    setLoadingUsers(true);
    const dbUsers = await fetchUtentiTenant();
    if (dbUsers && Array.isArray(dbUsers) && dbUsers.length > 0) {
      setUsers(dbUsers);
    } else {
      setUsers([
        { id: 'usr-01', nome: 'Joe Disabato', email: 'joe@bluecode.advisory', ruolo: 'super_admin' },
        { id: 'usr-02', nome: 'Elena Rossi', email: 'elena@bluecode.advisory', ruolo: 'advisor' },
      ]);
    }
    setLoadingUsers(false);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleSaveCompany = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadingLogo(true);
      try {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.readAsDataURL(file);
        });
        const base64Data = await base64Promise;
        const uploadRes = await uploadFileApi(file.name, base64Data);
        if (uploadRes && uploadRes.url) {
          setLogoUrl(uploadRes.url);
        } else {
          setLogoUrl(URL.createObjectURL(file));
        }
      } catch (err) {
        console.error(err);
        setLogoUrl(URL.createObjectURL(file));
      } finally {
        setUploadingLogo(false);
      }
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    setSubmittingUser(true);
    try {
      await creaUtenteTenantApi({
        nome: newUserName,
        email: newUserEmail,
        ruolo: newUserRole,
      });
      setNewUserName('');
      setNewUserEmail('');
      setModalUserOpen(false);
      await loadUsers();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingUser(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Impostazioni Studio, Sede Legale & Layout Fatture</div>
          <div className={styles.subTitle}>Configura le sedi legali/operative, la personalizzazione del modello di fattura PDF ed il team</div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'company' ? styles.tabActive : ''}`} onClick={() => setTab('company')}>
          🏢 Anagrafica Studio & Sedi Legali
        </button>
        <button className={`${styles.tab} ${tab === 'invoice_design' ? styles.tabActive : ''}`} onClick={() => setTab('invoice_design')}>
          🎨 Personalizzazione Modello Fattura PDF
        </button>
        <button className={`${styles.tab} ${tab === 'users' ? styles.tabActive : ''}`} onClick={() => setTab('users')}>
          👥 Gestione Team ({users.length})
        </button>
        <button className={`${styles.tab} ${tab === 'sdi' ? styles.tabActive : ''}`} onClick={() => setTab('sdi')}>
          📨 Configurazione SDI & Firma
        </button>
      </div>

      {saved && (
        <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '12px 16px', borderRadius: 10, fontSize: 12, fontWeight: 500 }}>
          ✓ Impostazioni studio e layout fattura aggiornati con successo!
        </div>
      )}

      {/* TAB 1: Dati Società & Sedi */}
      {tab === 'company' && (
        <form onSubmit={handleSaveCompany} className={styles.sectionBox}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Anagrafica Fiscale & Sedi dell'Advisory Firm</div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label>Ragione Sociale Studio *</label>
              <input value={ragioneSociale} onChange={e => setRagioneSociale(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label>Partita IVA / VAT Number *</label>
              <input value={pIva} onChange={e => setPIva(e.target.value)} required />
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label>Codice Fiscale Societario *</label>
              <input value={codFisc} onChange={e => setCodFisc(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label>Capitale Sociale & Registro Imprese *</label>
              <input value={capitaleSociale} onChange={e => setCapitaleSociale(e.target.value)} required />
            </div>
          </div>

          {/* SEDE LEGALE & SEDE OPERATIVA */}
          <div className={styles.field}>
            <label style={{ color: 'var(--indigo-l)', fontWeight: 700 }}>📍 Indirizzo Sede Legale (Legally Registered Office) *</label>
            <input value={sedeLegale} onChange={e => setSedeLegale(e.target.value)} placeholder="Indirizzo completo sede legale..." required />
          </div>

          <div className={styles.field}>
            <label style={{ color: '#a78bfa', fontWeight: 700 }}>🏢 Indirizzo Sede Operativa / Rappresentanza *</label>
            <input value={sedeOperativa} onChange={e => setSedeOperativa(e.target.value)} placeholder="Indirizzo uffici operativi..." required />
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label>Email Ufficiale *</label>
              <input value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label>Email PEC Ufficiale *</label>
              <input value={pec} onChange={e => setPec(e.target.value)} required />
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.field}>
              <label>Telefono di Contatto *</label>
              <input value={telefono} onChange={e => setTelefono(e.target.value)} required />
            </div>
            <div className={styles.field}>
              <label>Regime Fiscale & Giurisdizione *</label>
              <input value={regimeFiscale} onChange={e => setRegimeFiscale(e.target.value)} required />
            </div>
          </div>

          <div className={styles.field}>
            <label>IBAN per Accredito Fatture *</label>
            <input value={iban} onChange={e => setIban(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12.5 }} required />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              ✓ Salva Anagrafica & Sedi Legali
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: Personalizzazione Layout Fattura PDF (§Admin) */}
      {tab === 'invoice_design' && (
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
              {logoUrl ? (
                <div style={{ marginTop: 6, background: '#fff', padding: 8, borderRadius: 8, textAlign: 'center' }}>
                  <img src={logoUrl} alt="Logo Studio" style={{ maxHeight: 50, objectFit: 'contain' }} />
                </div>
              ) : (
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Nessun logo caricato. Verrà usata l'intestazione testuale di default.</div>
              )}
            </div>

            {/* Colore Tema */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>🎨 Colore Primario Layout Stampa</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { name: 'Indigo', hex: '#4338ca' },
                  { name: 'Emerald', hex: '#059669' },
                  { name: 'Navy', hex: '#0f172a' },
                  { name: 'Purple', hex: '#7c3aed' },
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
              onClick={() => {
                setSaved(true);
                setTimeout(() => setSaved(false), 2500);
              }}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '9px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              ✓ Salva Personalizzazione Fattura PDF
            </button>
          </div>
        </div>
      )}

      {/* Modal Live Preview Fattura PDF (§Admin) */}
      {previewOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
          <div style={{ background: '#fff', color: '#0f172a', borderRadius: 16, padding: 32, width: '100%', maxWidth: 660, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            {/* Header Documento con Colore Personalizzato */}
            <div style={{ borderBottom: `3px solid ${coloreTemaFattura}`, paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo" style={{ maxHeight: 45, marginBottom: 6 }} />
                ) : (
                  <div style={{ fontSize: 20, fontWeight: 800, color: coloreTemaFattura }}>{titoloIntestazione}</div>
                )}
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                  <strong>Sede Legale:</strong> {sedeLegale}<br />
                  <strong>Sede Operativa:</strong> {sedeOperativa}<br />
                  P.IVA/VAT: {pIva} · Reg. C-99881
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: coloreTemaFattura }}>FATTURA PROFORMA</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>FT-2026-PREVIEW</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Data: {new Date().toLocaleDateString('it-IT')}</div>
              </div>
            </div>

            {/* Dati Cliente */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Cliente Destinatario:</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>Holding Beta S.r.l.</div>
                <div style={{ fontSize: 11, color: '#475569' }}>P.IVA: IT09876543210</div>
              </div>
              {mostraSdi && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Canale SDI Comped:</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#166534', marginTop: 2 }}>✓ SDI SUBM70N</div>
                </div>
              )}
            </div>

            {/* Tabella Voci */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Descrizione Incarico</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Imponibile</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Totale €</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
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
              <div style={{ fontSize: 10, color: '#64748b', maxWidth: 360 }}>
                {notePieDiPagina}<br />
                <strong>IBAN Bonifico:</strong> {iban}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Totale Documento:</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: coloreTemaFattura }}>€ 5.000,00</div>
              </div>
            </div>

            {/* Footer Modal */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              <button onClick={() => setPreviewOpen(false)} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Chiudi Anteprima
              </button>
              <button onClick={() => window.print()} style={{ background: coloreTemaFattura, color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                🖨 Prova Stampa PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Gestione Team & Accessi */}
      {tab === 'users' && (
        <div className={styles.sectionBox}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Utenti & Collaboratori dello Studio</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Definisci i ruoli ed i permessi di accesso per il personale dello studio</div>
            </div>
            <button
              onClick={() => setModalUserOpen(true)}
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
            >
              + Invita Collaboratore
            </button>
          </div>

          {loadingUsers ? (
            <div style={{ padding: 20, color: 'var(--muted)', fontSize: 12 }}>Caricamento collaboratori...</div>
          ) : (
            <div className={styles.userGrid}>
              {users.map(u => (
                <div key={u.id} className={styles.userCard}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
                    {(u.nome || u.name || 'U').substring(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{u.nome || u.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{u.email}</div>
                  </div>
                  <span className={styles.roleBadge} style={{ background: (u.ruolo || u.role || '').includes('super') ? '#200f40' : '#1a1f3d', color: (u.ruolo || u.role || '').includes('super') ? '#a78bfa' : '#818cf8' }}>
                    {u.ruolo || u.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Configurazione SDI */}
      {tab === 'sdi' && (
        <div className={styles.sectionBox}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Configurazione Nodo Fatturazione SDI & Comped Servizi FPA</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Imposta le credenziali ed i certificati per la fatturazione elettronica integrata</div>
          
          <div className={styles.grid2} style={{ marginTop: 14 }}>
            <div className={styles.field}>
              <label>Provider Fatturazione *</label>
              <input value="Comped Servizi FPA (portale-fpa.compedservizi.it)" readOnly style={{ background: 'var(--card2)' }} />
            </div>
            <div className={styles.field}>
              <label>Codice Destinatario Default *</label>
              <input value="SUBM70N" readOnly style={{ fontFamily: 'monospace', fontWeight: 700 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
