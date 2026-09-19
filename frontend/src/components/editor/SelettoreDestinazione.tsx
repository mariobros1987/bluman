import React from 'react';
import type { Cliente, Progetto } from '../../types';

export function SelettoreDestinazione({
  clienti,
  selectedClienteId,
  setSelectedClienteId,
  progetti,
  selectedProgettoId,
  setSelectedProgettoId,
  microvoci,
  selectedMicrovoceId,
  setSelectedMicrovoceId,
  effProgettoId,
  caricandoMicrovoci,
  activeProgetto,
}: {
  clienti: Cliente[];
  selectedClienteId: string;
  setSelectedClienteId: React.Dispatch<React.SetStateAction<string>>;
  progetti: Progetto[];
  selectedProgettoId: string;
  setSelectedProgettoId: React.Dispatch<React.SetStateAction<string>>;
  microvoci: { id: string; nome: string; modulo: string }[];
  selectedMicrovoceId: string;
  setSelectedMicrovoceId: React.Dispatch<React.SetStateAction<string>>;
  effProgettoId: string;
  caricandoMicrovoci: boolean;
  activeProgetto: any;
}) {
  return (
    <>
      {/* Target Data Selector Strip */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>👤 Cliente Target ERP:</label>
          <select
            value={selectedClienteId}
            onChange={(e) => setSelectedClienteId(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
          >
            {clienti.length === 0 ? (
              <option value="">(Nessun cliente registrato in questo Studio)</option>
            ) : (
              clienti.map(c => (
                <option key={c.id} value={c.id}>{c.nome} {c.piva || c.codiceFiscale ? `(${c.piva || c.codiceFiscale})` : ''}</option>
              ))
            )}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>📁 Progetto Collegato:</label>
          <select
            value={selectedProgettoId}
            onChange={(e) => setSelectedProgettoId(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
          >
            {progetti.length === 0 ? (
              <option value="">(Nessun progetto attivo in questo Studio)</option>
            ) : (
              progetti.map((p: any) => (
                <option key={p.id} value={p.id}>{p.titolo || p.n || p.nome || `Progetto #${p.id}`} {p.cl ? `(${p.cl})` : ''}</option>
              ))
            )}
          </select>
        </div>

        {/* §WF-DOC — micro-voce di destinazione. È il collegamento che nel portale
            consente al cliente di risalire dal documento al lavoro che l'ha prodotto.
            Se l'operatore non ne indica una il documento resta di solo fascicolo (§2.9),
            ma è una scelta esplicita e la pagina lo dice. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>🔖 Micro-voce di Destinazione:</label>
          <select
            value={selectedMicrovoceId}
            onChange={(e) => setSelectedMicrovoceId(e.target.value)}
            disabled={!effProgettoId || caricandoMicrovoci}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600, maxWidth: 340 }}
            title="Il documento verrà agganciato a questa micro-voce: il cliente lo vedrà nel portale sotto la relativa lavorazione"
          >
            {caricandoMicrovoci ? (
              <option value="">Lettura micro-voci…</option>
            ) : microvoci.length === 0 ? (
              <option value="">(Nessuna micro-voce a database su questo progetto)</option>
            ) : (
              <>
                <option value="">— Solo fascicolo progetto (nessuna micro-voce) —</option>
                {microvoci.map(mv => (
                  <option key={mv.id} value={mv.id}>{mv.modulo} › {mv.nome}</option>
                ))}
              </>
            )}
          </select>
        </div>
      </div>

      {/* Filo logico dichiarato: dove finirà il documento e cosa serve perché il cliente lo veda. */}
      <div style={{ background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 10, padding: '9px 14px', fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>Percorso del documento:</span>
        <span>
          {effProgettoId
            ? <>
                {activeProgetto?.titolo || activeProgetto?.n || activeProgetto?.nome || 'Progetto'}
                {' › '}
                {selectedMicrovoceId
                  ? (microvoci.find(m => m.id === selectedMicrovoceId)?.modulo ?? 'Modulo') + ' › ' + (microvoci.find(m => m.id === selectedMicrovoceId)?.nome ?? 'Micro-voce')
                  : 'fascicolo progetto'}
                {' › '}
                <span style={{ color: 'var(--muted)' }}>bozza interna</span>
                {' → '}
                <span style={{ color: 'var(--cat-societario)' }}>pubblicazione dalla micro-voce</span>
                {' → '}
                <span style={{ color: 'var(--green)' }}>firma del cliente nel portale</span>
              </>
            : 'nessun progetto selezionato — il salvataggio sul server è sospeso'}
        </span>
      </div>
    </>
  );
}
