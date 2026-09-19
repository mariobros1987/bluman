import type React from 'react';
import type { PropostaDatiFiscale } from '../../api/client';
import { docBoxStyle } from './styles';

type DatiSocietari = { ragioneSociale: string; piva: string; legaleRappresentante: string; codiceFiscale: string; iban: string; titolareEffettivo: string; sedeLegale: string };

export interface TabFormProps {
  mostraDatiSensibili: boolean;
  setMostraDatiSensibili: (valore: boolean) => void;
  formSaved: boolean;
  propostaMsg: { text: string; type: 'success' | 'error' } | null;
  handleSaveForm: (e: React.FormEvent) => Promise<void>;
  bozzaDati: DatiSocietari;
  setBozzaDati: (dati: DatiSocietari) => void;
  propostaInAttesa: (campo: string) => PropostaDatiFiscale | null;
  formData: DatiSocietari;
  mascheraIban: (iban: string) => string;
  mascheraUbo: (nome: string) => string;
  invioProposta: boolean;
}

export function TabForm({
  mostraDatiSensibili,
  setMostraDatiSensibili,
  formSaved,
  propostaMsg,
  handleSaveForm,
  bozzaDati,
  setBozzaDati,
  propostaInAttesa,
  formData,
  mascheraIban,
  mascheraUbo,
  invioProposta,
}: TabFormProps) {
  return (
    <div style={docBoxStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>📋 Dati Societari e KYC</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            Le modifiche diventano una <b>proposta</b>: i nuovi valori entrano in anagrafica solo dopo la conferma dello studio. IBAN e titolare effettivo sono mascherati.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMostraDatiSensibili(!mostraDatiSensibili)}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {mostraDatiSensibili ? '🙈 Nascondi dati sensibili' : '👁 Mostra dati sensibili'}
        </button>
      </div>
      <div style={{ height: 14 }} />

      {formSaved && (
        <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
          ✓ Proposta inviata allo studio!
        </div>
      )}

      {propostaMsg && (
        <div style={{ background: propostaMsg.type === 'success' ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)', border: `1px solid ${propostaMsg.type === 'success' ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)'}`, color: propostaMsg.type === 'success' ? 'var(--green)' : 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
          {propostaMsg.text}
        </div>
      )}

      <form onSubmit={handleSaveForm} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ragione Sociale Entità *</label>
            <input value={bozzaDati.ragioneSociale} onChange={e => setBozzaDati({ ...bozzaDati, ragioneSociale: e.target.value })} required />
            {propostaInAttesa('ragioneSociale') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('ragioneSociale')?.valoreProposto}»</div>}
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Partita IVA / VAT Number *</label>
            <input value={bozzaDati.piva} onChange={e => setBozzaDati({ ...bozzaDati, piva: e.target.value })} required />
            {propostaInAttesa('piva') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('piva')?.valoreProposto}»</div>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Legale Rappresentante *</label>
            <input value={bozzaDati.legaleRappresentante} onChange={e => setBozzaDati({ ...bozzaDati, legaleRappresentante: e.target.value })} required />
            {propostaInAttesa('legaleRappresentante') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('legaleRappresentante')?.valoreProposto}»</div>}
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Codice Fiscale *</label>
            <input value={bozzaDati.codiceFiscale} onChange={e => setBozzaDati({ ...bozzaDati, codiceFiscale: e.target.value })} required />
            {propostaInAttesa('codiceFiscale') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('codiceFiscale')?.valoreProposto}»</div>}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>IBAN per Operazioni / Accreditamento *</label>
          {mostraDatiSensibili ? (
            <input value={bozzaDati.iban} onChange={e => setBozzaDati({ ...bozzaDati, iban: e.target.value })} style={{ fontFamily: 'monospace' }} required />
          ) : (
            <input value={mascheraIban(formData.iban)} disabled style={{ fontFamily: 'monospace', opacity: 0.65 }} title="Usa «Mostra dati sensibili» per vedere o modificare l'IBAN" />
          )}
          {propostaInAttesa('iban') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa di conferma dello studio</div>}
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolare Effettivo (UBO) & Quota di Possesso *</label>
          {mostraDatiSensibili ? (
            <input value={bozzaDati.titolareEffettivo} onChange={e => setBozzaDati({ ...bozzaDati, titolareEffettivo: e.target.value })} required />
          ) : (
            <input value={mascheraUbo(formData.titolareEffettivo)} disabled style={{ opacity: 0.65 }} title="Usa «Mostra dati sensibili» per vedere o modificare il titolare effettivo" />
          )}
          {propostaInAttesa('titolareEffettivo') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa di conferma dello studio</div>}
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Sede Legale</label>
          <input value={bozzaDati.sedeLegale} onChange={e => setBozzaDati({ ...bozzaDati, sedeLegale: e.target.value })} />
          {propostaInAttesa('sedeLegale') && <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 4 }}>⏳ Proposta in attesa: «{propostaInAttesa('sedeLegale')?.valoreProposto}»</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="submit" disabled={invioProposta} style={{ background: invioProposta ? 'var(--muted)' : 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: invioProposta ? 'default' : 'pointer', opacity: invioProposta ? 0.6 : 1 }}>
            {invioProposta ? 'Invio in corso…' : '➕ Invia proposte di modifica allo studio'}
          </button>
        </div>
      </form>
    </div>
  );
}
