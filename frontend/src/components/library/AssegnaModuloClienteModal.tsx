import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmt, moduloH, moduloP, resolveRighe } from '../../utils';
import { getTenantStorageKey } from '../../utils/tenant';
import { fetchClienti, fetchProgetti, creaProgettoApi, salvaProgettoDettaglioApi } from '../../api/client';
import type { Articolo, ModuloTemplate } from '../../types';
import { useToast } from '../ui/ToastProvider';

// ─── Modal Assegna Modulo a Cliente con Anti-Duplicazione ─────────
export function AssegnaModuloClienteModal({
  modulo,
  articoliList,
  onClose,
}: {
  modulo: ModuloTemplate;
  articoliList: Articolo[];
  onClose: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [clienti, setClienti] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [progetti, setProgetti] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('new');
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [duplicationReport, setDuplicationReport] = useState<Array<{ name: string; status: string; isDuplicate: boolean }>>([]);

  useEffect(() => {
    async function loadClientData() {
      const dbClienti = await fetchClienti();
      if (dbClienti && Array.isArray(dbClienti) && dbClienti.length > 0) {
        setClienti(dbClienti);
        setSelectedClientId(dbClienti[0].id);
      }
    }
    loadClientData();
  }, []);

  useEffect(() => {
    if (!selectedClientId) return;
    async function loadProjects() {
      const allProjs = await fetchProgetti();
      const clientProjs = (allProjs || []).filter((p: any) => String(p.clienteId || p.clId) === String(selectedClientId));
      setProgetti(clientProjs);
      if (clientProjs.length > 0) {
        setSelectedProjectId(String(clientProjs[0].id));
      } else {
        setSelectedProjectId('new');
      }
    }
    loadProjects();
  }, [selectedClientId]);

  // Scan live for duplicated articles in target project
  useEffect(() => {
    if (selectedProjectId === 'new' || !selectedProjectId) {
      setDuplicationReport([]);
      return;
    }
    const targetProj = progetti.find(p => String(p.id) === String(selectedProjectId));
    if (!targetProj || !targetProj.mods) {
      setDuplicationReport([]);
      return;
    }

    const righeNew = resolveRighe(modulo, articoliList);
    const existingMvNames = new Set<string>();
    const existingMvStatuses = new Map<string, string>();

    targetProj.mods.forEach((m: any) => {
      (m.v || []).forEach((mv: any) => {
        const nameClean = (mv.n || '').toLowerCase().trim();
        existingMvNames.add(nameClean);
        existingMvStatuses.set(nameClean, mv.s || 'pending');
      });
    });

    const report = righeNew.map(r => {
      const nameClean = (r.art.n || '').toLowerCase().trim();
      const isDup = existingMvNames.has(nameClean);
      return {
        name: r.art.n,
        status: isDup ? (existingMvStatuses.get(nameClean) || 'done') : 'new',
        isDuplicate: isDup,
      };
    });

    setDuplicationReport(report);
  }, [selectedProjectId, modulo, articoliList, progetti]);

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) return;
    setLoading(true);

    try {
      let projIdToUse = selectedProjectId;
      let targetProj: any = null;

      if (selectedProjectId === 'new') {
        const clientObj = clienti.find(c => String(c.id) === String(selectedClientId));
        const projName = newProjectName.trim() || `Incarico ${modulo.n} — ${clientObj?.nome || 'Cliente'}`;
        const newP = await creaProgettoApi({ clienteId: selectedClientId, nome: projName });
        projIdToUse = String(newP.id);
        targetProj = { id: projIdToUse, clienteId: selectedClientId, cl: clientObj?.nome, nome: projName, mods: [], val: 0 };
      } else {
        targetProj = progetti.find(p => String(p.id) === String(selectedProjectId));
      }

      const righeNew = resolveRighe(modulo, articoliList);
      const newMicrovoci = righeNew.map(r => {
        const dupItem = duplicationReport.find(d => d.name === r.art.n && d.isDuplicate);
        const isDoneAlready = dupItem && (dupItem.status === 'done' || dupItem.status === 'completed');

        return {
          n: r.art.n,
          hE: isDoneAlready ? 0 : r.h,
          hA: isDoneAlready ? r.h : 0,
          s: isDoneAlready ? 'done' : 'pending',
          // Regola 7: nessun assegnatario fittizio — prima `as: 1` finiva persistito a
          // database con salvaProgettoDettaglioApi. L'assegnazione avviene solo quando
          // un membro reale del team viene scelto sulla micro-voce.
          d: 0,
          vn: isDoneAlready ? '✓ Già ultimato nel progetto precedente (Evitato doppione)' : undefined,
        };
      });

      const newModObj = {
        id: Date.now(),
        n: modulo.n,
        cat: modulo.cat,
        st: newMicrovoci.every(v => v.s === 'done') ? 'done' : 'pending',
        pct: newMicrovoci.every(v => v.s === 'done') ? 100 : 0,
        h: moduloH(modulo, articoliList),
        a: 0,
        p: moduloP(modulo, articoliList),
        // Regola 7: il modulo appena aggiunto non ha ancora nessuno assegnato; il team
        // vuoto evita che un membro fittizio venga persistito sul progetto.
        team: [],
        v: newMicrovoci,
      };

      const updatedMods = [...(targetProj.mods || []), newModObj];
      const updatedVal = (targetProj.val || 0) + (newModObj.p || 0);
      const updatedProj = { ...targetProj, mods: updatedMods, val: updatedVal };

      await salvaProgettoDettaglioApi(projIdToUse, updatedProj);

      // Backup local storage
      const storageKey = getTenantStorageKey('bluman_custom_projects');
      const savedStr = localStorage.getItem(storageKey);
      const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
      const updatedArr = [updatedProj, ...savedArr.filter(p => String(p.id) !== String(projIdToUse))];
      localStorage.setItem(storageKey, JSON.stringify(updatedArr));

      onClose();
      navigate(`/projects/${projIdToUse}`);
    } catch (err: any) {
      // §3.3 — prima l'errore finiva solo in console.error: l'assegnazione falliva e il
      // modal restava lì senza alcun messaggio, oppure l'utente riprovava alla cieca.
      toast.errore(`Assegnazione modulo non riuscita: ${err?.message || 'errore di rete'}. Il progetto NON è stato modificato.`);
    } finally {
      setLoading(false);
    }
  };

  const hasDuplicates = duplicationReport.some(d => d.isDuplicate);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 16 }}>
      <form onSubmit={handleAssignSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)' }}>🚀 Assegna Modulo "{modulo.n}" a Cliente</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona il cliente ed il progetto in cui istanziare il modulo ed il relativo workflow.</div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>1. Seleziona Cliente Target *</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)} required style={{ padding: 10, fontSize: 12 }}>
            {clienti.map(c => (
              <option key={c.id} value={c.id}>
                {c.tipo === 'company' ? '🏢' : '👤'} {c.nome}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>2. Seleziona Incarico / Progetto del Cliente *</label>
          <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} style={{ padding: 10, fontSize: 12 }}>
            <option value="new">➕ Crea Nuovo Incarico per questo Cliente</option>
            {progetti.map(p => (
              <option key={p.id} value={p.id}>
                📁 {p.nome || p.n} (Valore: {fmt(p.val || 0)})
              </option>
            ))}
          </select>
        </div>

        {selectedProjectId === 'new' && (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome Nuovo Incarico *</label>
            <input
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder={`es. Incarico ${modulo.n}`}
              style={{ fontSize: 12 }}
            />
          </div>
        )}

        {/* Controllo Anti-Duplicazione Live */}
        {selectedProjectId !== 'new' && (
          <div style={{ background: hasDuplicates ? 'var(--pill-amber-bg)' : 'var(--pill-green-bg)', border: `1px solid ${hasDuplicates ? 'var(--amber)' : 'var(--pill-green-bg)'}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: hasDuplicates ? 'var(--amber)' : 'var(--green)' }}>
              {hasDuplicates ? '⚠️ Controllo Anti-Duplicazione: Rilevati Articoli Già Lavorati' : '✓ Nessun Doppione Rilevato'}
            </div>
            <div style={{ fontSize: 11, color: hasDuplicates ? 'var(--pill-amber-bg)' : 'var(--pill-green-fg)', lineHeight: 1.4 }}>
              {hasDuplicates
                ? 'Gli articoli già ultimati nel progetto non verranno duplicati. Saranno segnati come già validati a 0 ore per evitare di far rifare il lavoro.'
                : 'Tutti gli articoli della distinta base verranno integrati nel nuovo modulo del cliente.'}
            </div>

            {duplicationReport.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {duplicationReport.map((d, idx) => (
                  <div key={idx} style={{ fontSize: 10.5, display: 'flex', justifyContent: 'space-between', color: d.isDuplicate ? 'var(--pill-amber-fg)' : 'var(--pill-green-bg)' }}>
                    <span>• {d.name}</span>
                    <span style={{ fontWeight: 700 }}>{d.isDuplicate ? `✓ Già lavorato (${d.status})` : '➕ Nuovo'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
          <button type="submit" disabled={loading} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {loading ? 'Assegnazione in corso...' : '✓ Conferma ed Assegna a Cliente ➔'}
          </button>
        </div>
      </form>
    </div>
  );
}
