import React from 'react';

export function ModaleNuovoTemplate({
  setShowNewTmplModal,
  handleCreateCustomMaster,
  newTmplTitolo,
  setNewTmplTitolo,
  newTmplCat,
  setNewTmplCat,
  newTmplDesc,
  setNewTmplDesc,
}: {
  setShowNewTmplModal: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateCustomMaster: (e: React.FormEvent) => void;
  newTmplTitolo: string;
  setNewTmplTitolo: React.Dispatch<React.SetStateAction<string>>;
  newTmplCat: 'societario' | 'contratto' | 'nda' | 'engagement' | 'delega' | 'fiscale' | 'trust' | 'compliance';
  setNewTmplCat: React.Dispatch<React.SetStateAction<'societario' | 'contratto' | 'nda' | 'engagement' | 'delega' | 'fiscale' | 'trust' | 'compliance'>>;
  newTmplDesc: string;
  setNewTmplDesc: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
          onClick={() => setShowNewTmplModal(false)}
        >
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              width: '100%',
              maxWidth: 520,
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>➕ Crea Nuovo Modello Master Studio</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Crea un nuovo modello personalizzato con Smart Tags riutilizzabili</div>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTmplModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustomMaster} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                  Titolo Modello Master *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Es. Patto di Riservatezza Dipendenti, Mandato Wealth Management..."
                  value={newTmplTitolo}
                  onChange={(e) => setNewTmplTitolo(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12.5 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                  Categoria *
                </label>
                <select
                  value={newTmplCat}
                  onChange={(e) => setNewTmplCat(e.target.value as any)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12.5 }}
                >
                  <option value="societario">Societario & Statuti</option>
                  <option value="contratto">Contratti & Accordi</option>
                  <option value="engagement">Engagement Letter & Mandati</option>
                  <option value="nda">NDA & Riservatezza</option>
                  <option value="delega">Procure & Deleghe</option>
                  <option value="trust">Trust & Fiduciaria</option>
                  <option value="compliance">Compliance & UBO KYC</option>
                  <option value="fiscale">Fiscale & Tax Planning</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', display: 'block', marginBottom: 5 }}>
                  Descrizione Modello
                </label>
                <textarea
                  rows={3}
                  placeholder="Breve descrizione dell'utilizzo pratico e delle condizioni previste dal modello..."
                  value={newTmplDesc}
                  onChange={(e) => setNewTmplDesc(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 12 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowNewTmplModal(false)}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.3)' }}
                >
                  ✓ Crea e Apri nell'Editor
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}
