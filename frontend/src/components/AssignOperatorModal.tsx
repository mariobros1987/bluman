import { useEffect, useMemo, useRef, useState } from 'react';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { fetchOperatoriSuggeriti, type OperatoreSuggeritoApi } from '../api/client';
import { Avatar } from './ui/Avatar';
import type { TeamMember } from '../types';

interface AssignOperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetName: string; // e.g. "Modulo Corporate Structuring" or "Raccolta Documenti"
  /** Categoria del lavoro da assegnare (es. 'Societario', 'Trust'): usata per il suggerimento §6.2. */
  categoria?: string;
  currentAssignedIds?: number[];
  /**
   * §1ter.6 (C1) — passa il **membro**, non il suo id numerico.
   *
   * Il numero è l'id della UI: serve a evidenziare la riga e a personalizzare l'avatar, e
   * non esiste in nessuna tabella. L'assegnazione ha bisogno dell'uuid di `bluman_user`, e
   * il chiamante che riceveva solo il numero lo costruiva a mano (`` `usr-0${operatorId}` ``):
   * la chiave esterna lo rifiutava a ogni chiamata, dentro un `.catch(() => {})`, quindi il
   * pulsante non ha mai funzionato e l'interfaccia diceva che era andato tutto bene.
   * Passando l'oggetto, l'uuid c'è per costruzione e nessuno deve inventarlo.
   *
   * Restituisce una promessa perché il messaggio di esito deve descrivere quello che è
   * successo davvero: prima compariva dopo 1200 ms fissi, a chiamata ancora in volo.
   */
  onAssign: (membro: TeamMember, roleLevel: string) => Promise<void>;
}

export function AssignOperatorModal({
  isOpen,
  onClose,
  targetName,
  categoria,
  currentAssignedIds = [],
  onAssign,
}: AssignOperatorModalProps) {
  const { team: teamList, loading } = useTeamMembers();
  // `null` è uno stato legittimo — «nessuno selezionato» — e va distinto da un id
  // inventato: prima il valore di partenza era `currentAssignedIds[0] || 1`, cioè
  // l'operatore numero 1 anche quando non esisteva.
  const [selectedOpId, setSelectedOpId] = useState<number | null>(currentAssignedIds[0] ?? null);
  const [roleLevel, setRoleLevel] = useState<string>('write');
  const [esito, setEsito] = useState<{ tipo: 'ok' | 'errore'; testo: string } | null>(null);
  const [inCorso, setInCorso] = useState(false);

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
    const punteggio = (op: TeamMember) => {
      const s = suggerimentoPerDbId.get(op.dbId);
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

  /**
   * §1ter.6 (C1) — l'esito si scrive **dopo** la chiamata, e descrive quello che è successo.
   *
   * Prima questa funzione chiamava `onAssign` senza attenderla, mostrava «✓ Operatore
   * assegnato con successo ed aggiornato nel registro studio!» e chiudeva dopo 1200 ms
   * fissi. Il messaggio era vero quanto il timer: la chiamata vera falliva a ogni giro —
   * mandava un id che nessuna riga soddisfaceva — e nessuno lo vedeva, perché l'errore
   * finiva in un `.catch(() => {})` dall'altra parte. Un'interfaccia che dice «fatto»
   * mentre la scrittura non è ancora partita non è un'omissione: è un'affermazione falsa
   * su dati dello studio, ed è la classe di difetto che questo progetto tratta per prima.
   */
  const handleConfirm = async () => {
    const membro = teamOrdinati.find((o) => o.id === selectedOpId);
    if (!membro) {
      setEsito({ tipo: 'errore', testo: 'Nessun operatore selezionato.' });
      return;
    }

    setInCorso(true);
    setEsito(null);
    try {
      await onAssign(membro, roleLevel);
      setEsito({ tipo: 'ok', testo: `Operatore assegnato: ${membro.n}.` });
      // La chiusura automatica resta solo sul successo: su un errore il modale si ferma,
      // perché il messaggio va letto e la scelta va rifatta.
      setTimeout(() => {
        setEsito(null);
        onClose();
      }, 1200);
    } catch (err: any) {
      setEsito({ tipo: 'errore', testo: err?.message || 'Assegnazione non riuscita.' });
    } finally {
      setInCorso(false);
    }
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

        {/* Esito dell'assegnazione — scritto dopo la risposta del server, non prima. */}
        {esito && (
          <div
            style={
              esito.tipo === 'ok'
                ? { background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '10px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, marginBottom: 14 }
                : { background: 'var(--pill-red-bg)', border: '1px solid var(--pill-red-bg)', color: 'var(--pill-red-fg)', padding: '10px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, marginBottom: 14 }
            }
          >
            {esito.tipo === 'ok' ? '✓ ' : '⚠ '}
            {esito.testo}
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

        {/* §1ter.6 (C1) — nessuna squadra: prima questo stato non esisteva, perché il
            caricamento finiva sempre con almeno una riga costruita in locale. Quella riga
            però non era assegnabile — non aveva un id di database — quindi riempiva il
            selettore di una scelta che non poteva riuscire. Adesso lo stato vuoto si vede
            e dice il motivo, invece di nascondersi dietro un nome. */}
        {!loading && teamOrdinati.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--amber)', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
            ⚠ Nessun collaboratore assegnabile: l'anagrafica dello studio non risponde e questo
            browser non ha collaboratori salvati. Senza un utente a database non è possibile
            assegnare — riprova quando la connessione è disponibile.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', marginBottom: 20 }}>
          {teamOrdinati.map(op => {
            const isSelected = selectedOpId === op.id;
            const suggerimento = suggerimentoPerDbId.get(op.dbId);
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
                        <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, color: 'var(--amber)' }}>⭐ SPECIALIZZAZIONE ✓</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {op.r}
                      {suggerimento && (
                        <span style={{ marginLeft: 6, color: 'var(--indigo-l, var(--indigo-l))' }}>
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
            disabled={inCorso || selectedOpId === null}
            style={{
              background: inCorso || selectedOpId === null ? 'var(--card2)' : 'var(--indigo)',
              color: inCorso || selectedOpId === null ? 'var(--muted)' : '#fff',
              border: 'none',
              padding: '8px 20px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: inCorso || selectedOpId === null ? 'not-allowed' : 'pointer',
              boxShadow: inCorso || selectedOpId === null ? 'none' : '0 4px 14px rgba(99,102,241,0.4)',
            }}
          >
            {inCorso ? '⏳ Assegnazione in corso…' : '✓ Conferma Assegnazione'}
          </button>
        </div>
      </div>
    </div>
  );
}
