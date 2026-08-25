import { useEffect, useMemo, useRef, useState } from 'react';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { fetchOperatoriSuggeriti, type OperatoreSuggeritoApi } from '../api/client';
import { Avatar } from './ui/Avatar';

interface AssignOperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetName: string; // e.g. "Modulo Corporate Structuring" or "Raccolta Documenti"
  /** Categoria del lavoro da assegnare (es. 'Societario', 'Trust'): usata per il suggerimento §6.2. */
  categoria?: string;
  currentAssignedIds?: number[];
  onAssign: (operatorId: number, roleLevel: string) => void;
}

export function AssignOperatorModal({
  isOpen,
  onClose,
  targetName,
  categoria,
  currentAssignedIds = [1],
  onAssign,
}: AssignOperatorModalProps) {
  const { team: teamList, loading } = useTeamMembers();
  const [selectedOpId, setSelectedOpId] = useState<number>(currentAssignedIds[0] || 1);
  const [roleLevel, setRoleLevel] = useState<string>('write');
  const [notif, setNotif] = useState(false);

  // §6.2 — suggerimento operatore: prima la specializzazione (match con la
  // categoria del lavoro), poi il minor carico di lavoro. L'ordinamento e il
  // badge arrivano da GET /operatori-suggeriti; nessun calcolo finto in UI.
  const [suggeriti, setSuggeriti] = useState<OperatoreSuggeritoApi[]>([]);
  const selezioneManuale = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    let attivo = true;
    fetchOperatoriSuggeriti(categoria)
      .then((r) => { if (attivo) setSuggeriti(r.suggeriti); })
      .catch(() => { if (attivo) setSuggeriti([]); }); // senza API il modale resta utilizzabile
    return () => { attivo = false; };
  }, [isOpen, categoria]);

  const suggerimentoPerDbId = useMemo(() => {
    const mappa = new Map<string, OperatoreSuggeritoApi>();
    for (const s of suggeriti) mappa.set(s.id, s);
    return mappa;
  }, [suggeriti]);

  // Ordine della lista: specializzazione corrispondente prima, poi minor
  // carico; chi non è nel database dello studio resta in coda.
  const teamOrdinati = useMemo(() => {
    if (suggeriti.length === 0) return teamList;
    const punteggio = (op: (typeof teamList)[number]) => {
      const s = op.dbId ? suggerimentoPerDbId.get(op.dbId) : undefined;
      if (!s) return { priorita: 2, carico: Number.POSITIVE_INFINITY };
      return { priorita: s.corrisponde ? 0 : 1, carico: s.caricoOre };
    };
    return [...teamList].sort((a, b) => {
      const pa = punteggio(a);
      const pb = punteggio(b);
      return pa.priorita - pb.priorita || pa.carico - pb.carico;
    });
  }, [teamList, suggeriti, suggerimentoPerDbId]);

  // Pre-selezione automatica del candidato migliore, finché l'utente non
  // sceglie a mano: corrisponde alla specializzazione + ha il carico minore.
  useEffect(() => {
    if (!isOpen || selezioneManuale.current || suggeriti.length === 0 || teamList.length === 0) return;
    const migliore = suggeriti.find((s) => s.corrisponde) ?? suggeriti[0];
    if (!migliore) return;
    const membro = teamList.find((t) => t.dbId === migliore.id);
    if (membro) setSelectedOpId(membro.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, suggeriti, teamList]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onAssign(selectedOpId, roleLevel);
    setNotif(true);
    setTimeout(() => {
      setNotif(false);
      onClose();
    }, 1200);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15,23,42,0.75)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 16,
    }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        maxWidth: 520,
        width: '100%',
        padding: 24,
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        color: 'var(--text)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--indigo-l)', fontWeight: 800, letterSpacing: '.5px' }}>
              👥 GESTIONE ASSEGNAZIONI OPERATORI STUDIO
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '4px 0 0 0' }}>Assegna Operatore Interno</h3>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Elemento in assegnazione: <strong style={{ color: 'var(--text)' }}>{targetName}</strong>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        {/* Notifica Confirm */}
        {notif && (
          <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '10px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, marginBottom: 14 }}>
            ✓ Operatore assegnato con successo ed aggiornato nel registro studio!
          </div>
        )}

        {/* Operator Selection List */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>
          Seleziona Operatore o Consulente di Studio:
          {loading && <span style={{ marginLeft: 8, fontWeight: 400, fontStyle: 'italic' }}>⏳ Caricamento dal database…</span>}
        </div>

        {/* §6.2 — criterio del suggerimento */}
        {suggeriti.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--muted)', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '7px 10px', marginBottom: 10 }}>
            ⭐ Ordinati per <strong>specializzazione{categoria ? ` (${categoria})` : ''} + minor carico di lavoro</strong>. Il migliore è pre-selezionato.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', marginBottom: 20 }}>
          {teamOrdinati.map(op => {
            const isSelected = selectedOpId === op.id;
            const suggerimento = op.dbId ? suggerimentoPerDbId.get(op.dbId) : undefined;
            return (
              <div
                key={op.id}
                onClick={() => { selezioneManuale.current = true; setSelectedOpId(op.id); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: isSelected ? 'var(--card2)' : 'rgba(255,255,255,0.02)',
                  border: `1.5px solid ${isSelected ? 'var(--indigo)' : 'var(--border)'}`,
                  borderRadius: 12,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  transition: 'all .15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar id={op.id} size={36} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {op.n}
                      {suggerimento?.corrisponde && (
                        <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, color: '#fbbf24' }}>⭐ SPECIALIZZAZIONE ✓</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {op.r}
                      {suggerimento && (
                        <span style={{ marginLeft: 6, color: 'var(--indigo-l, #818cf8)' }}>
                          · carico {suggerimento.caricoOre.toLocaleString('it-IT', { maximumFractionDigits: 1 })} h
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 800,
                    padding: '3px 8px',
                    borderRadius: 10,
                    background: isSelected ? 'var(--indigo)' : 'var(--card2)',
                    color: isSelected ? '#fff' : 'var(--muted)',
                  }}>
                    {isSelected ? '✓ SELEZIONATO' : 'SELEZIONA'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Role & Level Selection */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
            Livello di Permesso & Incarico:
          </label>
          <select
            value={roleLevel}
            onChange={e => setRoleLevel(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--card2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--text)',
            }}
          >
            <option value="write">👷 Operatore Incaricato (Esecuzione & Consuntivazione)</option>
            <option value="lead">👑 Lead Advisor / Supervisor (Approvazione & Validazione)</option>
            <option value="read">👁 Consultazione Read-Only (Solo Lettura Audit)</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <button
            onClick={onClose}
            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Annulla
          </button>
          <button
            onClick={handleConfirm}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.4)' }}
          >
            ✓ Conferma Assegnazione
          </button>
        </div>
      </div>
    </div>
  );
}
