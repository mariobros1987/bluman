import type React from 'react';
import type { DocumentoPortale } from '../../api/client';

export interface ModificaDocModalProps {
  modificaDocTarget: DocumentoPortale;
  modificaDocTesto: string;
  setModificaDocTesto: (testo: string) => void;
  modificaDocInviando: boolean;
  setModificaDocTarget: (doc: DocumentoPortale | null) => void;
  handleInviaRichiestaModifica: (e: React.FormEvent) => Promise<void>;
}

export function ModificaDocModal({
  modificaDocTarget,
  modificaDocTesto,
  setModificaDocTesto,
  modificaDocInviando,
  setModificaDocTarget,
  handleInviaRichiestaModifica,
}: ModificaDocModalProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11500, padding: 16 }}>
      <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 540, padding: 22, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 25px 60px rgba(0,0,0,.8)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>📝 Richiedi Modifiche all'Atto</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{modificaDocTarget.nome}</div>
          </div>
          <button type="button" onClick={() => setModificaDocTarget(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 16, cursor: 'pointer' }}>✕</button>
        </div>

        <form onSubmit={handleInviaRichiestaModifica} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.5 }}>
            Descrivi con precisione quali clausole, dettagli o informazioni desideri rettificare. Lo studio riceverà la tua nota ed elaborerà una versione corretta prima della firma definitiva.
          </div>

          <textarea
            value={modificaDocTesto}
            onChange={e => setModificaDocTesto(e.target.value)}
            placeholder="Es. Vorrei rettificare l'indirizzo della sede legale al punto 2 e correggere la quota di partecipazione..."
            rows={5}
            required
            style={{ width: '100%', padding: '10px 12px', fontSize: 12, borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'vertical' }}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setModificaDocTarget(null)}
              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={modificaDocInviando || !modificaDocTesto.trim()}
              style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '7px 18px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: modificaDocInviando || !modificaDocTesto.trim() ? 'not-allowed' : 'pointer' }}
            >
              {modificaDocInviando ? 'Invio in corso…' : 'Invia Richiesta allo Studio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
