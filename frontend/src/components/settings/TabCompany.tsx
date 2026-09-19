import React from 'react';
import styles from '../../pages/Settings.module.css';

interface TabCompanyProps {
  ragioneSociale: string;
  setRagioneSociale: (v: string) => void;
  pIva: string;
  setPIva: (v: string) => void;
  codFisc: string;
  setCodFisc: (v: string) => void;
  capitaleSociale: string;
  setCapitaleSociale: (v: string) => void;
  regImprese: string;
  setRegImprese: (v: string) => void;
  sedeLegale: string;
  setSedeLegale: (v: string) => void;
  sedeOperativa: string;
  setSedeOperativa: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  pec: string;
  setPec: (v: string) => void;
  telefono: string;
  setTelefono: (v: string) => void;
  regimeFiscale: string;
  setRegimeFiscale: (v: string) => void;
  iban: string;
  setIban: (v: string) => void;
  handleSaveCompany: (e?: React.FormEvent) => void;
}

// TAB 1: Dati Società & Sedi
export function TabCompany({
  ragioneSociale,
  setRagioneSociale,
  pIva,
  setPIva,
  codFisc,
  setCodFisc,
  capitaleSociale,
  setCapitaleSociale,
  regImprese,
  setRegImprese,
  sedeLegale,
  setSedeLegale,
  sedeOperativa,
  setSedeOperativa,
  email,
  setEmail,
  pec,
  setPec,
  telefono,
  setTelefono,
  regimeFiscale,
  setRegimeFiscale,
  iban,
  setIban,
  handleSaveCompany,
}: TabCompanyProps) {
  return (
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
              <label>Capitale Sociale Versato *</label>
              <input value={capitaleSociale} onChange={e => setCapitaleSociale(e.target.value)} required />
            </div>
          </div>

          <div className={styles.field}>
            <label>Registro Imprese / REA *</label>
            <input value={regImprese} onChange={e => setRegImprese(e.target.value)} required />
          </div>

          {/* SEDE LEGALE & SEDE OPERATIVA */}
          <div className={styles.field}>
            <label style={{ color: 'var(--indigo-l)', fontWeight: 700 }}>📍 Indirizzo Sede Legale (Legally Registered Office) *</label>
            <input value={sedeLegale} onChange={e => setSedeLegale(e.target.value)} placeholder="Indirizzo completo sede legale..." required />
          </div>

          <div className={styles.field}>
            <label style={{ color: 'var(--purple)', fontWeight: 700 }}>🏢 Indirizzo Sede Operativa / Rappresentanza *</label>
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
  );
}
