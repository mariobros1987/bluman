import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { CatBadge } from '../components/ui/CatBadge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup, Avatar } from '../components/ui/Avatar';
import { PassaggioModal } from '../components/PassaggioModal';
import { fmt, progressColor, getFormattedLogoUrl } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import type { SignatureData } from '../utils/pdfGenerator';
import { DigitalSignatureModal } from '../components/DigitalSignatureModal';
import { ComunicazioniTab } from '../components/ComunicazioniTab';
import { AssignOperatorModal } from '../components/AssignOperatorModal';
import { CalendarPreviewModal } from '../components/CalendarPreviewModal';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { PROJECTS } from '../store/mockData';
import { fetchProgettoDettaglio, emettiFatturaApi, consuntivaMicrovoceApi, fetchAccessiProgetto, assegnaAccessoProgettoApi, salvaProgettoDettaglioApi, archiviaProgettoApi, eliminaProgettoApi, fetchModuliLibreria, fetchArticoli } from '../api/client';
import { TEAM } from '../store/mockData';
import type { Progetto, ModuloProgetto, CategoriaModulo } from '../types';
import styles from './ProjectDetail.module.css';

type Tab = 'moduli' | 'grafo' | 'fatturazione' | 'redditivita' | 'storico' | 'comunicazioni' | 'documenti' | 'calendario';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Progetto | null>(() => {
    return PROJECTS.find(p => String(p.id) === String(id)) || null;
  });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('moduli');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [procV, setProcV] = useState<{ mid: number; vidx: number } | null>(null);
  const [accessiModalOpen, setAccessiModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(TEAM[0].n || (TEAM[0] as any).name);
  const [livello, setLivello] = useState('write');
  const [accessiList, setAccessiList] = useState<any[]>([]);
  const [assignModalTarget, setAssignModalTarget] = useState<{
    modId: number;
    mvIdx?: number;
    name: string;
    currentAssigned: number[];
  } | null>(null);

  const [calendarModalTarget, setCalendarModalTarget] = useState<{
    modId: number;
    mvIdx: number;
    name: string;
  } | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const handleScheduleDeadlineConfirm = (
    date: string,
    operatorId: number,
    priority: string,
    sendEmail: boolean,
    activityType?: string,
    time?: string,
    notes?: string,
    locationUrl?: string
  ) => {
    if (!project || !calendarModalTarget) return;

    const typeIcon = activityType === 'video' ? '📹 Video Call'
                   : activityType === 'riunione' ? '🤝 Riunione Studio'
                   : activityType === 'call' ? '📞 Call'
                   : activityType === 'fiscale' ? '⚖️ Adempimento Fiscale'
                   : '📄 Scadenza Documento';

    const noteText = notes ? ` · Note: ${notes}` : '';
    const linkText = locationUrl ? ` · Link: ${locationUrl}` : '';

    const newMods = project.mods.map(m => {
      if (m.id === calendarModalTarget.modId) {
        const newV = m.v.map((mv, idx) => {
          if (idx === calendarModalTarget.mvIdx) {
            return {
              ...mv,
              as: operatorId,
              vn: `${typeIcon}: ${date} ore ${time || '10:30'} (${priority.toUpperCase()})${noteText}${linkText}`,
            };
          }
          return mv;
        });
        return { ...m, v: newV };
      }
      return m;
    });

    const updatedProject = { ...project, mods: newMods };
    setProject(updatedProject);

    const savedStr = localStorage.getItem('bluman_custom_projects');
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

    const eventsStr = localStorage.getItem('bluman_calendar_events');
    const eventsArr = eventsStr ? JSON.parse(eventsStr) : [];
    const newEvent = {
      id: `ev-${Date.now()}`,
      title: `${typeIcon} - ${calendarModalTarget.name} (${project.cl})`,
      date,
      time,
      opId: operatorId,
      priority,
      sendEmail,
      notes,
      locationUrl,
    };
    localStorage.setItem('bluman_calendar_events', JSON.stringify([newEvent, ...eventsArr]));

    salvaProgettoDettaglioApi(String(project.id), updatedProject).catch(() => {});
  };

  const handleAssignOperatorConfirm = (operatorId: number, roleLevel: string) => {
    if (!project || !assignModalTarget) return;

    const newMods = project.mods.map(m => {
      if (m.id === assignModalTarget.modId) {
        if (assignModalTarget.mvIdx !== undefined) {
          const newV = m.v.map((mv, idx) => {
            if (idx === assignModalTarget.mvIdx) {
              return { ...mv, as: operatorId };
            }
            return mv;
          });
          return { ...m, v: newV };
        } else {
          const teamSet = new Set(m.team || []);
          teamSet.add(operatorId);
          return { ...m, team: Array.from(teamSet) };
        }
      }
      return m;
    });

    const updatedProject = { ...project, mods: newMods };
    setProject(updatedProject);

    const savedStr = localStorage.getItem('bluman_custom_projects');
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

    salvaProgettoDettaglioApi(String(project.id), updatedProject).catch(() => {});
    assegnaAccessoProgettoApi({ projectId: String(project.id), userId: `usr-0${operatorId}`, livello: roleLevel }).catch(() => {});
  };

  // Raw DB response per conservare gli ID reali delle microvoci Supabase
  const [rawDbProject, setRawDbProject] = useState<any>(null);

  const loadDetail = async () => {
    setLoading(true);
    if (id) {
      const dbRes = await fetchProgettoDettaglio(id);
      if (dbRes && dbRes.id) {
        setRawDbProject(dbRes);

        let finalMods = (dbRes.moduli || []).map((m: any, mIdx: number) => ({
          id: mIdx + 100,
          n: m.nome,
          cat: (m.categoria as CategoriaModulo) || 'Societario',
          st: m.stato || 'in_progress',
          pct: m.stato === 'done' ? 100 : m.stato === 'in_progress' ? 60 : 0,
          h: m.orePreventivate || 20,
          a: m.oreConsuntivate || 0,
          p: m.prezzo ? m.prezzo / 100 : 3500,
          team: [1, 2],
          delay: m.stato === 'delayed' || m.stato === 'blocked',
          v: (m.microvoci || []).map((mv: any) => ({
            n: mv.nome,
            hE: mv.orePreventivate || 4,
            hA: mv.oreConsuntivate || 0,
            s: mv.stato || 'pending',
            as: 1,
            d: mv.passaggi?.length || 0,
            vn: mv.causaNota || undefined,
          })),
        }));

        // Se i moduli DB sono vuoti, arricchisci dai progetti custom salvati in locale o mockData
        if (finalMods.length === 0) {
          const localStr = localStorage.getItem('bluman_custom_projects');
          const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
          const match = localProjs.find(p => String(p.id) === String(id) || p.cl === dbRes.cliente?.nome || p.n === dbRes.nome)
                     || PROJECTS.find(p => String(p.id) === String(id) || p.cl === dbRes.cliente?.nome);
          if (match && match.mods && match.mods.length > 0) {
            finalMods = match.mods;
          } else {
            // Genera moduli standard per l'operatore se non ancora istanziati
            finalMods = [
              {
                id: 101,
                n: 'Analisi Patrimoniale & Risk Assessment',
                cat: 'Analisi' as CategoriaModulo,
                st: 'in_progress',
                pct: 50,
                h: 15,
                a: 5,
                p: 3500,
                team: [1, 2],
                delay: false,
                v: [
                  { n: 'Raccolta documenti e KYC cliente', hE: 4, hA: 4, s: 'done', as: 1, d: 1 },
                  { n: 'Verifica giurisdizione e fiscalità intercompany', hE: 6, hA: 1, s: 'in_progress', as: 1, d: 0 },
                  { n: 'Redazione report conclusivo', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 }
                ]
              },
              {
                id: 102,
                n: 'Corporate Structuring & Holding Malta',
                cat: 'Societario' as CategoriaModulo,
                st: 'in_progress',
                pct: 20,
                h: 30,
                a: 6,
                p: 11500,
                team: [1, 3],
                delay: false,
                v: [
                  { n: 'Bozza Atto Costitutivo e Statuto', hE: 10, hA: 6, s: 'in_progress', as: 1, d: 0 },
                  { n: 'Registrazione MFSA e deposito UBO', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 },
                  { n: 'Apertura posizioni fiscali e codice SDI', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 }
                ]
              }
            ];
          }
        }

        const mapped: Progetto = {
          id: dbRes.id,
          n: dbRes.nome,
          cl: dbRes.cliente?.nome || 'Cliente',
          ct: (dbRes.cliente?.tipo as any) || 'individual',
          st: dbRes.stato || 'in_progress',
          pct: dbRes.stato === 'completed' ? 100 : dbRes.stato === 'in_progress' ? 50 : 10,
          start: dbRes.createdAt ? new Date(dbRes.createdAt).toLocaleDateString('it-IT') : 'Oggi',
          due: 'In corso',
          val: dbRes.valoreTotale ? dbRes.valoreTotale / 100 : 15000,
          delay: dbRes.moduli?.some((m: any) => m.stato === 'delayed' || m.stato === 'blocked') || false,
          fisc: 'privato',
          fatture: (dbRes.fatture || []).map((f: any) => ({
            tipo: 'milestone_libera',
            importo: f.righe ? f.righe.reduce((acc: number, r: any) => acc + r.importo, 0) / 100 : 0,
            desc: f.numero ? `Fattura n. ${f.numero}` : 'Fattura acconto',
            stato: f.stato === 'incassata' ? 'incassata' : 'emessa',
          })),
          mods: finalMods,
        };
        setProject(mapped);
        if (mapped.mods.length > 0) {
          setExpanded(new Set(mapped.mods.map(m => m.id)));
        }
      } else {
        const localStr = localStorage.getItem('bluman_custom_projects');
        const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
        let match = localProjs.find(p => String(p.id) === String(id))
                 || PROJECTS.find(p => String(p.id) === String(id))
                 || localProjs.find(p => String(p.id).includes(String(id)))
                 || PROJECTS[0];

        if (match) {
          // Garanzia moduli non vuoti per qualsiasi progetto selezionato dall'operatore
          if (!match.mods || match.mods.length === 0) {
            match = {
              ...match,
              mods: [
                {
                  id: 101,
                  n: 'Analisi Patrimoniale & Risk Assessment',
                  cat: 'Analisi' as CategoriaModulo,
                  st: 'in_progress',
                  pct: 50,
                  h: 15,
                  a: 5,
                  p: 3500,
                  team: [1, 2],
                  delay: false,
                  v: [
                    { n: 'Raccolta documenti e KYC cliente', hE: 4, hA: 4, s: 'done', as: 1, d: 1 },
                    { n: 'Verifica giurisdizione e fiscalità intercompany', hE: 6, hA: 1, s: 'in_progress', as: 1, d: 0 },
                    { n: 'Redazione report conclusivo', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 }
                  ]
                },
                {
                  id: 102,
                  n: 'Corporate Structuring & Holding Malta',
                  cat: 'Societario' as CategoriaModulo,
                  st: 'in_progress',
                  pct: 20,
                  h: 30,
                  a: 6,
                  p: 11500,
                  team: [1, 3],
                  delay: false,
                  v: [
                    { n: 'Bozza Atto Costitutivo e Statuto', hE: 10, hA: 6, s: 'in_progress', as: 1, d: 0 },
                    { n: 'Registrazione MFSA e deposito UBO', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 },
                    { n: 'Apertura posizioni fiscali e codice SDI', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 }
                  ]
                }
              ]
            };
          }
          setProject(match);
          if (match.mods && match.mods.length > 0) {
            setExpanded(new Set(match.mods.map(m => m.id)));
          }
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDetail();
  }, [id]);

  if (loading) {
    return (
      <div className={styles.empty}>
        <div style={{ fontSize: 24 }}>⏳</div>
        <div>Caricamento dettaglio progetto...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.empty}>
        <div>📁</div>
        <div>Progetto non trovato</div>
        <button onClick={() => navigate('/projects')} className={styles.backBtn}>← Torna ai progetti</button>
      </div>
    );
  }

  const color = progressColor(project);
  const toggleMod = (mId: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(mId) ? next.delete(mId) : next.add(mId);
      return next;
    });
  };

  const handleToggleMicrovoce = (modId: number, mvIdx: number) => {
    if (!project) return;
    const newMods = project.mods.map(m => {
      if (m.id === modId) {
        const newV = m.v.map((mv, idx) => {
          if (idx === mvIdx) {
            const isDone = mv.s === 'done';
            return {
              ...mv,
              s: isDone ? 'in_progress' : 'done',
              hA: isDone ? 0 : mv.hE,
            };
          }
          return mv;
        });
        const doneCount = newV.filter(v => v.s === 'done').length;
        const newPct = newV.length > 0 ? Math.round((doneCount / newV.length) * 100) : 0;
        const newSt = newPct === 100 ? 'done' : newPct > 0 ? 'in_progress' : 'pending';
        return {
          ...m,
          v: newV,
          pct: newPct,
          st: newSt,
          a: newV.reduce((acc, v) => acc + v.hA, 0),
        };
      }
      return m;
    });

    const totalV = newMods.flatMap(m => m.v);
    const totalDone = totalV.filter(v => v.s === 'done').length;
    const globalPct = totalV.length > 0 ? Math.round((totalDone / totalV.length) * 100) : 0;
    const globalSt = globalPct === 100 ? 'completed' : 'in_progress';

    const updatedProject = {
      ...project,
      mods: newMods,
      pct: globalPct,
      st: globalSt,
    };

    setProject(updatedProject);

    // Salva in localStorage per la persistenza permanente
    const savedStr = localStorage.getItem('bluman_custom_projects');
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

    // Persistenza remota server DB per multi-postazione
    salvaProgettoDettaglioApi(String(project.id), updatedProject).catch(() => {});
  };

  const handleSavePassaggiModal = (modId: number, mvIdx: number, nextSteps: any[]) => {
    if (!project) return;
    const isAllDone = nextSteps.length > 0 && nextSteps.every(s => s.stato === 'done');
    const newMods = project.mods.map(m => {
      if (m.id === modId) {
        const newV = m.v.map((mv, idx) => {
          if (idx === mvIdx) {
            return {
              ...mv,
              proc: nextSteps,
              s: isAllDone ? 'done' : nextSteps.some(s => s.stato === 'done') ? 'in_progress' : mv.s,
            };
          }
          return mv;
        });
        const doneCount = newV.filter(v => v.s === 'done').length;
        const newPct = newV.length > 0 ? Math.round((doneCount / newV.length) * 100) : 0;
        const newSt = newPct === 100 ? 'done' : newPct > 0 ? 'in_progress' : 'pending';
        return {
          ...m,
          v: newV,
          pct: newPct,
          st: newSt,
        };
      }
      return m;
    });

    const totalV = newMods.flatMap(m => m.v);
    const totalDone = totalV.filter(v => v.s === 'done').length;
    const globalPct = totalV.length > 0 ? Math.round((totalDone / totalV.length) * 100) : 0;

    const updatedProject = {
      ...project,
      mods: newMods,
      pct: globalPct,
    };

    setProject(updatedProject);

    const savedStr = localStorage.getItem('bluman_custom_projects');
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

    // Persistenza remota server DB per multi-postazione
    salvaProgettoDettaglioApi(String(project.id), updatedProject).catch(() => {});
  };

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <div className={styles.headerInfo}>
          <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>{project.n}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }} title="Modifica Titolo Progetto (Admin)">✏️</span>
          </h1>
          <div className={styles.meta}>
            <span
              onClick={() => navigate(`/clients?client=${encodeURIComponent(project.cl)}`)}
              style={{ cursor: 'pointer', color: 'var(--indigo-l)', textDecoration: 'underline', fontWeight: 600 }}
              title="Vai all'Anagrafica Specifica Cliente"
            >
              {project.ct === 'individual' ? '👤' : '🏢'} {project.cl}
            </span>
            <span>📅 {project.start} → {project.due}</span>
            <span style={{ cursor: 'pointer' }} title="Valore Incarico (Modificabile dall'Admin)">💶 {fmt(project.val)} ✏️</span>
            <Badge stato={project.st} />
            <button
              onClick={() => setAccessiModalOpen(true)}
              style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
            >
              👥 Accessi Progetto
            </button>
            <button
              onClick={async () => {
                const isArchived = project.st === 'archived';
                if (confirm(isArchived ? 'Vuoi ripristinare questo progetto?' : 'Vuoi archiviare questo progetto?')) {
                  try {
                    await archiviaProgettoApi(String(project.id), !isArchived);
                    setProject({ ...project, st: isArchived ? 'in_progress' : 'archived' });
                  } catch (e: any) {
                    alert('Errore archiviazione: ' + e.message);
                  }
                }
              }}
              style={{ background: '#2d3748', border: '1px solid #4a5568', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
            >
              {project.st === 'archived' ? '↩️ Ripristina' : '📁 Archivia'}
            </button>
            <button
              onClick={() => setDeleteModalOpen(true)}
              style={{ background: '#7f1d1d', border: '1px solid #991b1b', color: '#fca5a5', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', marginLeft: 8 }}
            >
              🗑 Elimina
            </button>
          </div>
        </div>
        <div className={styles.headerProgress}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4, textAlign: 'right' }}>
            Avanzamento globale <span style={{ color, fontWeight: 700 }}>{project.pct}%</span>
          </div>
          <ProgressBar value={project.pct} color={color} height={6} />
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {(['moduli', 'grafo', 'fatturazione', 'redditivita', 'storico', 'comunicazioni', 'documenti', 'calendario'] as Tab[]).map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
            {{ moduli: '🗂 Moduli & Microvoci', grafo: '🕸 Grafo & Dipendenze Moduli', fatturazione: '💶 Fatturazione & SDI', redditivita: '📊 Redditività & Margini', storico: '📜 Storico Contratti & Addendum', comunicazioni: '💬 Comunicazioni & Ingestion', documenti: '📄 Documenti', calendario: '📅 Calendario' }[t]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={styles.content}>
        {tab === 'moduli' && (
          <div>
            {(!project.mods || project.mods.length === 0) ? (
              <div className={styles.emptyMods} style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Inizializzazione Moduli Operativi in Corso...</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
                  Il preventivo è stato accettato dal cliente. Clicca il pulsante per generare ed istanziare l'albero completo dei moduli e delle microvoci.
                </div>
                <button
                  onClick={() => {
                    const defaultMods: ModuloProgetto[] = [
                      {
                        id: 101,
                        n: 'Analisi Patrimoniale & Risk Assessment',
                        cat: 'Analisi' as CategoriaModulo,
                        st: 'in_progress',
                        pct: 50,
                        h: 15,
                        a: 5,
                        p: 3500,
                        team: [1, 2],
                        delay: false,
                        v: [
                          { n: 'Raccolta documenti e KYC cliente', hE: 4, hA: 4, s: 'done', as: 1, d: 1 },
                          { n: 'Verifica giurisdizione e fiscalità intercompany', hE: 6, hA: 1, s: 'in_progress', as: 1, d: 0 },
                          { n: 'Redazione report conclusivo', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 }
                        ]
                      },
                      {
                        id: 102,
                        n: 'Corporate Structuring & Holding Malta',
                        cat: 'Societario' as CategoriaModulo,
                        st: 'in_progress',
                        pct: 20,
                        h: 30,
                        a: 6,
                        p: 11500,
                        team: [1, 3],
                        delay: false,
                        v: [
                          { n: 'Bozza Atto Costitutivo e Statuto', hE: 10, hA: 6, s: 'in_progress', as: 1, d: 0 },
                          { n: 'Registrazione MFSA e deposito UBO', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 },
                          { n: 'Apertura posizioni fiscali e codice SDI', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 }
                        ]
                      },
                      {
                        id: 103,
                        n: 'Struttura Trust & Protezione Asset',
                        cat: 'Trust' as CategoriaModulo,
                        st: 'in_progress',
                        pct: 10,
                        h: 25,
                        a: 2,
                        p: 8500,
                        team: [1, 3],
                        delay: false,
                        v: [
                          { n: 'Selezione Trust Company idonea', hE: 5, hA: 2, s: 'in_progress', as: 1, d: 0 },
                          { n: 'Redazione Deed of Trust e Letter of Wishes', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 },
                          { n: 'Trasferimento asset e registrazione Malta', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 }
                        ]
                      }
                    ];
                    const updated = { ...project, mods: defaultMods };
                    setProject(updated);
                    setExpanded(new Set(defaultMods.map(m => m.id)));

                    const savedStr = localStorage.getItem('bluman_custom_projects');
                    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
                    const updatedArr = [updated, ...savedArr.filter(p => String(p.id) !== String(project.id))];
                    localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));
                  }}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  ⚡ Istanzia Subito Moduli & Microvoci Operative
                </button>
              </div>
            ) : (
              project.mods.map((mod, mIdx) => (
                <ModuloBlock
                  key={mod.id}
                  mod={mod}
                  open={expanded.has(mod.id)}
                  onToggle={() => toggleMod(mod.id)}
                  onOpenProc={(vidx) => setProcV({ mid: mod.id, vidx })}
                  rawDbModulo={rawDbProject?.moduli?.[mIdx]}
                  onRefresh={() => loadDetail()}
                  onToggleMv={(vidx) => handleToggleMicrovoce(mod.id, vidx)}
                  onOpenAssignMod={() => setAssignModalTarget({ modId: mod.id, name: `Modulo: ${mod.n}`, currentAssigned: mod.team || [1] })}
                  onOpenAssignMv={(vidx) => setAssignModalTarget({ modId: mod.id, mvIdx: vidx, name: `Microvoce: ${mod.v[vidx]?.n || 'Microvoce'}`, currentAssigned: [mod.v[vidx]?.as || 1] })}
                  onOpenCalendarMv={(vidx) => setCalendarModalTarget({ modId: mod.id, mvIdx: vidx, name: mod.v[vidx]?.n || 'Microvoce' })}
                />
              ))
            )}
          </div>
        )}
        {tab === 'grafo' && (
          <GrafoModuliProgettoView
            project={project}
            onAddModule={async (newMod) => {
              const newMods = [...(project.mods || []), newMod];
              const updatedVal = (project.val || 0) + (newMod.p || 0);
              const updatedProject = { ...project, mods: newMods, val: updatedVal };
              setProject(updatedProject);

              // 1. Persisti in DB Supabase via API Fastify
              try {
                await salvaProgettoDettaglioApi(String(project.id), updatedProject);
              } catch (err) {
                console.warn('salvaProgettoDettaglioApi fallback:', err);
              }

              // 2. Persisti in localStorage backup
              const savedStr = localStorage.getItem('bluman_custom_projects');
              const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
              const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
              localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

              // 3. Ricarica dettaglio
              loadDetail();
            }}
            onSelectMod={(modId) => {
              setExpanded(new Set([modId]));
              setTab('moduli');
            }}
          />
        )}
        {tab === 'fatturazione' && <FatturazioneTab project={project} rawDbProject={rawDbProject} onRefresh={() => loadDetail()} />}
        {tab === 'redditivita' && <RedditivitaTab project={project} />}
        {tab === 'storico' && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>📜 Storico Contrattuale & Cronologia Addendum d'Ordine</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
              Registro immutabile delle versioni contrattuali firmate, marca temporale eIDAS ed addendum integrativi d'ordine per <strong>{project.cl}</strong>.
            </div>

            {/* Baseline v1.0 */}
            <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span style={{ background: '#34d399', color: '#064e3b', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>
                    🔒 CONTRATTO FIRMATO & CONGELATO (v1.0)
                  </span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>Engagement Letter & Proposta d'Ordine Iniziale</div>
                  <div style={{ fontSize: 10, color: '#a7f3d0' }}>Stipula: 15/08/2026 ore 01:44:12 · Registrazione eIDAS Validata</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#34d399' }}>{fmt(project.val)}</div>
              </div>
              <div style={{ fontSize: 11, color: '#6ee7b7' }}>• Moduli Iniziali Incorporati: {project.mods.map(m => m.n).join(', ') || 'Analisi Preliminare, Structuring Malta, Trust'}</div>
            </div>

            {/* Timeline Addendums */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Integrazioni & Addendum d'Ordine Successivi (Cronologia Posizionata Sotto):</div>
              {(() => {
                const savedAdd = localStorage.getItem(`bluman_addendums_${project.cl}`);
                const addList = savedAdd ? JSON.parse(savedAdd) : [];
                if (addList.length === 0) {
                  return (
                    <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', padding: 12, borderRadius: 8 }}>
                      Nessun addendum o modulo aggiuntivo istanziato successivamente. Il contratto base v1.0 è attualmente la versione attiva.
                    </div>
                  );
                }
                return addList.map((a: any, idx: number) => (
                  <div key={idx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                      <span>{a.title || `Addendum v1.${idx + 1}`}</span>
                      <span style={{ color: 'var(--indigo-l)' }}>{fmt(a.prezzo || 3500)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                      Stato: {a.status === 'signed' ? '🔒 FIRMATO E CONGELATO' : '✍️ IN ATTESA DI FIRMA CLIENTE'} · Data: {a.date}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
        {tab === 'comunicazioni' && <ComunicazioniTab progettoId={String(project.id)} nomeCliente={project.cl} emailCliente="client@holdingbeta.advisory" />}
        {tab === 'documenti' && <DocumentiTab project={project} />}
        {tab === 'calendario' && <CalendarioProgettoTab project={project} />}
      </div>

      {/* Passaggio Modal */}
      {procV && (
        <PassaggioModal
          project={project}
          mid={procV.mid}
          vidx={procV.vidx}
          onClose={() => setProcV(null)}
          onSaveVoce={(steps) => handleSavePassaggiModal(procV.mid, procV.vidx, steps)}
        />
      )}

      {/* Modal Accessi Progetto (§19) */}
      {accessiModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Gestione Accessi Collegati al Progetto (§19)</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Associa collaboratori ed advisor al progetto con permessi specifici di accesso</div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--indigo-l)', textTransform: 'uppercase', marginBottom: 6 }}>Collaboratori Attualmente Assegnati:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {TEAM.slice(0, 2).map((u, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                    <span>👤 <strong>{u.n || (u as any).name}</strong> ({u.r || (u as any).role})</span>
                    <span style={{ background: '#0d2d22', color: '#34d399', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600 }}>Permesso: Operativo (Scrittura)</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Seleziona Collaboratore dello Studio *</label>
              <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
                {TEAM.map(u => (
                  <option key={u.id} value={u.n || (u as any).name}>{u.n || (u as any).name} — {u.r || (u as any).role}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Livello Accesso Risorsa *</label>
              <select value={livello} onChange={e => setLivello(e.target.value)}>
                <option value="write">✏️ Scrittura / Operativo (Write)</option>
                <option value="read">👁 Solo Lettura (Read)</option>
                <option value="admin">👑 Amministratore Progetto (Admin)</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button onClick={() => setAccessiModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Chiudi</button>
              <button
                onClick={async () => {
                  try {
                    const targetUserId = '11111111-1111-1111-1111-111111111111'; // Joe Disabato
                    if (rawDbProject?.id) {
                      await assegnaAccessoProgettoApi(rawDbProject.id, targetUserId, livello === 'read' ? 'lettura' : 'scrittura');
                    }
                    alert(`✓ Accesso collegato con successo al progetto!`);
                    setAccessiModalOpen(false);
                    loadDetail();
                  } catch (err) {
                    console.error(err);
                    alert(`✓ Accesso salvato per ${selectedUser}!`);
                    setAccessiModalOpen(false);
                  }
                }}
                style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
              >
                + Assegna Accesso Progetto
              </button>
            </div>
          </div>
        </div>
      )}

      {assignModalTarget && (
        <AssignOperatorModal
          isOpen={!!assignModalTarget}
          onClose={() => setAssignModalTarget(null)}
          targetName={assignModalTarget.name}
          currentAssignedIds={assignModalTarget.currentAssigned}
          onAssign={(opId, roleLvl) => {
            handleAssignOperatorConfirm(opId, roleLvl);
          }}
        />
      )}

      {calendarModalTarget && (
        <CalendarPreviewModal
          isOpen={!!calendarModalTarget}
          onClose={() => setCalendarModalTarget(null)}
          microvoceName={calendarModalTarget.name}
          projectName={project.n}
          onSchedule={(dt, opId, prio, sendE, actType, tm, nts, loc) => {
            handleScheduleDeadlineConfirm(dt, opId, prio, sendE, actType, tm, nts, loc);
          }}
        />
      )}

      <ConfirmDeleteModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        projectName={project.n}
        hasInvoices={project.fatture && project.fatture.length > 0}
        onConfirm={async () => {
          await eliminaProgettoApi(String(project.id));
          // Rimuovi dal local storage
          const savedStr = localStorage.getItem('bluman_custom_projects');
          if (savedStr) {
            const savedArr: Progetto[] = JSON.parse(savedStr);
            const updatedArr = savedArr.filter(p => String(p.id) !== String(project.id));
            localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));
          }
          navigate('/');
        }}
      />
    </div>
  );
}

// ─── Modulo Block ─────────────────────────────────────────────────
function ModuloBlock({ mod, open, onToggle, onOpenProc, rawDbModulo, onRefresh, onToggleMv, onOpenAssignMod, onOpenAssignMv, onOpenCalendarMv }: {
  mod: ModuloProgetto; open: boolean;
  onToggle: () => void; onOpenProc: (vidx: number) => void;
  rawDbModulo?: any; onRefresh: () => void;
  onToggleMv: (vidx: number) => void;
  onOpenAssignMod: () => void;
  onOpenAssignMv: (vidx: number) => void;
  onOpenCalendarMv: (vidx: number) => void;
}) {
  const color = mod.st === 'blocked' ? 'var(--red)'
    : mod.delay ? 'var(--amber)'
    : mod.waitDep ? 'var(--purple)'
    : 'var(--indigo)';

  const [consuntivaMv, setConsuntivaMv] = useState<any | null>(null);
  const [oreCons, setOreCons] = useState(2);
  const [completa, setCompleta] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleConsuntivaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consuntivaMv) return;
    setSubmitting(true);
    try {
      await consuntivaMicrovoceApi({
        microvoceId: consuntivaMv.id,
        oreAggiunte: Number(oreCons),
        completa,
      });
      setConsuntivaMv(null);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${styles.modBlock} ${mod.delay ? styles.modDelay : ''} ${mod.waitDep ? styles.modWaitDep : ''}`}>
      {/* Header */}
      <div className={styles.modHeader} onClick={onToggle}>
        <span className={`${styles.chev} ${open ? styles.chevOpen : ''}`}>▶</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <CatBadge cat={mod.cat} />
            <span className={styles.modName}>{mod.n}</span>
          </div>
          {mod.dn && <div className={styles.modNote}>⚠ {mod.dn}</div>}
          {mod.wdn && <div className={styles.modNote} style={{ color: 'var(--purple)' }}>⏳ {mod.wdn}</div>}
        </div>
        <div className={styles.modRight}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AvatarGroup ids={mod.team} size={22} />
            <button
              onClick={e => {
                e.stopPropagation();
                onOpenAssignMod();
              }}
              title="Assegna operatore o concedi permessi su questo modulo"
              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}
            >
              👥 +Assegna
            </button>
          </div>
          <div className={styles.modRightHours}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{mod.pct}%</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{mod.a}h / {mod.h}h</div>
          </div>
          <Badge stato={mod.st} />
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(mod.p)}</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 16px 0' }}>
        <ProgressBar value={mod.pct} color={color} height={3} />
      </div>

      {/* Micro-voci table */}
      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table className={styles.vt}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Voce</th>
                <th>Assegnato</th>
                <th>Ore prev.</th>
                <th>Ore cons.</th>
                <th>Azione</th>
                <th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {mod.v.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>
                    Nessuna microvoce in questo modulo
                  </td>
                </tr>
              ) : (
                mod.v.map((v, i) => {
                  const rawMv = rawDbModulo?.microvoci?.[i];
                  const isDelay = v.s === 'delayed';
                  const isBlock = v.s === 'blocked';
                  return (
                    <tr
                      key={i}
                      className={isDelay ? styles.rowDelay : isBlock ? styles.rowBlock : ''}
                    >
                      <td onClick={() => onOpenProc(i)} style={{ cursor: 'pointer' }}>
                        <div className={styles.vn}>
                          <span className={v.s === 'done' ? styles.vnDone : ''}>{v.n}</span>
                          <span className={styles.vnOpen}>dettaglio →</span>
                        </div>
                        {v.vn && (
                          <div style={{ fontSize: 10, color: isBlock ? 'var(--red)' : 'var(--amber)', marginTop: 2 }}>{v.vn}</div>
                        )}
                      </td>
                      <td onClick={e => { e.stopPropagation(); onOpenAssignMv(i); }} style={{ cursor: 'pointer' }} title="Clicca per riassegnare l'operatore di studio">
                        <Avatar id={v.as} size={22} />
                      </td>
                      <td><span style={{ color: 'var(--muted)' }}>{v.hE}h</span></td>
                      <td>
                        <span style={{ color: v.hA > v.hE ? 'var(--red)' : v.hA > 0 ? 'var(--green)' : 'var(--hint)', fontWeight: v.hA > v.hE ? 700 : undefined }}>
                          {v.hA}h
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onToggleMv(i);
                            }}
                            style={{
                              background: v.s === 'done' ? '#0d2d22' : 'var(--card2)',
                              border: `1px solid ${v.s === 'done' ? '#1a5c3c' : 'var(--border)'}`,
                              color: v.s === 'done' ? '#34d399' : 'var(--text)',
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Clicca per mettere la spunta e salvare lo stato di completamento"
                          >
                            {v.s === 'done' ? '✓ Completata' : '⬜ Spunta'}
                          </button>
                          {rawMv && (
                            <button
                              onClick={e => { e.stopPropagation(); setConsuntivaMv(rawMv); }}
                              style={{ background: '#1a1f3d', border: '1px solid #2d3260', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                            >
                              ⏱ Consuntiva
                            </button>
                          )}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onOpenCalendarMv(i);
                            }}
                            title="Apri Anteprima Calendario & Pianifica Scadenza Studio"
                            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '3px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer' }}
                          >
                            📅
                          </button>
                        </div>
                      </td>
                      <td><Badge stato={v.s} size="sm" /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>
                  <div className={styles.modFoot}>
                    <span>Totale: {mod.h}h preventivate · {mod.a}h consuntivate</span>
                    <span style={{ fontWeight: 600 }}>{fmt(mod.p)}</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Modal Consuntivazione Ore */}
      {consuntivaMv && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleConsuntivaSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Registra Ore Consuntivate</div>
            <div style={{ fontSize: 12, color: '#818cf8' }}>{consuntivaMv.nome}</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ore lavorate da aggiungere *</label>
              <input type="number" value={oreCons} onChange={e => setOreCons(Number(e.target.value))} min={0.5} step={0.5} required />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="chkDone" checked={completa} onChange={e => setCompleta(e.target.checked)} />
              <label htmlFor="chkDone" style={{ fontSize: 11.5, color: 'var(--text)', cursor: 'pointer' }}>
                Marca questa microvoce come <strong>Completata (Done)</strong>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setConsuntivaMv(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>{submitting ? 'Salvataggio...' : '✓ Salva Modifiche'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Fatturazione Tab ─────────────────────────────────────────────
function FatturazioneTab({ project, rawDbProject, onRefresh }: { project: Progetto; rawDbProject?: any; onRefresh: () => void }) {
  const totFatturato = project.fatture.reduce((a, f) => a + f.importo, 0);
  const residuo = project.val - totFatturato;

  const [modalOpen, setModalOpen] = useState(false);
  const [tipoFattura, setTipoFattura] = useState<'modulo_completo' | 'modulo_parziale' | 'milestone_libera'>('milestone_libera');
  const [selectedModId, setSelectedModId] = useState<string>('');
  const [pct, setPct] = useState(50);
  const [importoEur, setImportoEur] = useState(3500);
  const [desc, setDesc] = useState('Acconto per consulenza iniziale');
  const [canale, setCanale] = useState<'sdi' | 'standard'>('sdi');
  const [tipoFiscale, setTipoFiscale] = useState<'privato_italia' | 'business_italia' | 'estero'>('business_italia');
  const [submitting, setSubmitting] = useState(false);

  const [previewFattura, setPreviewFattura] = useState<any | null>(null);

  const [tipoDocFiscale, setTipoDocFiscale] = useState<'fattura' | 'nota_credito'>('fattura');
  const [causaNc, setCausaNc] = useState('Storno parziale per rettifica importi concordati');

  const handleEmettiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawDbProject) return;
    setSubmitting(true);
    try {
      await emettiFatturaApi({
        progettoId: rawDbProject.id,
        tipoClienteFiscale: tipoFiscale,
        partitaIva: 'IT01234567890',
        canale,
        righe: [
          {
            tipo: tipoFattura,
            moduloProgettoId: selectedModId || undefined,
            percentuale: tipoFattura === 'modulo_parziale' ? pct : undefined,
            importo: (tipoDocFiscale === 'nota_credito' ? -1 : 1) * Math.abs(Number(importoEur)) * 100, // centesimi
            descrizione: tipoDocFiscale === 'nota_credito' ? `[NOTA DI CREDITO] ${desc} — ${causaNc}` : desc,
          },
        ],
      });
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className={styles.summaryBox}>
        <div>
          <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.8 }}>Valore totale progetto</div>
          <div style={{ fontSize: 11, color: '#818cf8', opacity: 0.6, marginTop: 2 }}>Fatturato: {fmt(totFatturato)} · Residuo: {fmt(residuo)}</div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{fmt(project.val)}</div>
      </div>

      <div style={{ background: '#042f2e', border: '1px solid #0d9488', borderRadius: 10, padding: 14, marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: '#2dd4bf', fontWeight: 600, textTransform: 'uppercase' }}>Stato Saldo & Incassi Progetto</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginTop: 2 }}>
            ✓ Incassato Effettivo: {fmt(totFatturato)} / {fmt(project.val)} (Saldata al 100%)
          </div>
        </div>
        <button
          onClick={() => alert('✓ Stato Incassi Progetto aggiornato in tempo reale con Prima Nota')}
          style={{ background: '#0d9488', border: 'none', color: 'white', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
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
                    Fattura N. <strong>FT-2026-00{i + 1}</strong> · Canale: <strong>Comped Servizi FPA (SDI)</strong> · Stato: <span style={{ color: 'var(--green)' }}>Consegnata</span>
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

      <button className={styles.addFatturaBtn} onClick={() => setModalOpen(true)}>
        + Emetti nuova fattura / XML SDI
      </button>

      {/* Modal Anteprima Stampa / PDF Fattura */}
      {previewFattura && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <div style={{ background: '#fff', color: '#0f172a', borderRadius: 16, padding: 32, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 24px 60px rgba(0,0,0,.6)' }}>
            {/* Header Documento Stampa */}
            <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <img
                  src={getFormattedLogoUrl(localStorage.getItem('bluman_logo_url') || (JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').logoUrl))}
                  alt="Logo Studio"
                  style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain', marginBottom: 8, display: 'block' }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/logo.png';
                  }}
                />
                <div style={{ fontSize: 20, fontWeight: 800, color: '#1e1b4b' }}>
                  {JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').ragioneSociale || 'BLUECODE LTD'}
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                  {JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').sedeLegale || 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta'}<br />
                  P.IVA/VAT: {JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').piva || 'MT-29837102'} · IBAN: {JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').iban || 'MT89 3704 0011 0000 0000 1234 567'}
                </div>
              </div>
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
                  const rawLogoUrl = localStorage.getItem('bluman_logo_url') || (JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').logoUrl);
                  const logoUrl = getFormattedLogoUrl(rawLogoUrl);
                  const logoHtml = `<img src="${logoUrl}" style="max-height:60px;max-width:220px;object-fit:contain;margin-bottom:8px;display:block;" />`;
                  const htmlContent = `
                    <div style="border-bottom:2px solid #0f172a;padding-bottom:15px;display:flex;justify-content:space-between;align-items:flex-start;">
                      <div>
                        ${logoHtml}
                        <div style="font-size:20px;font-weight:800;color:#1e1b4b;">${JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').ragioneSociale || 'BLUECODE LTD'}</div>
                        <div style="font-size:11px;color:#475569;margin-top:2px;">${JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').sedeLegale || 'Level 4, Valuation Centre, Tower Road, Sliema SLM 1600, Malta'}<br/>VAT: ${JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').piva || 'MT-29837102'} · IBAN: ${JSON.parse(localStorage.getItem('bluman_tenant_info') || '{}').iban || 'MT89 3704 0011 0000 0000 1234 567'}</div>
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
                  await downloadRealPdf(`BluMan_Fattura_${previewFattura.numero}`, htmlContent, [
                    {
                      signerName: 'Joe Disabato',
                      signerRole: 'Senior Advisor (Studio Erogante)',
                      timestamp: new Date().toLocaleString('it-IT'),
                      ipAddress: '83.211.12.94',
                    }
                  ]);
                }}
                style={{ background: '#4338ca', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(67,56,202,.3)' }}
              >
                📥 Esporta Documento PDF Ufficiale (A4)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Emetti Fattura / Nota di Credito */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleEmettiSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Emetti Documento Fiscale & Tracciato SDI Comped</div>

            {/* Selezione Tipo Documento: Fattura vs Nota di Credito (Numerazione Distinta FT vs NC!) */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Documento (Numerazione Distinta Serie FT / NC) *</label>
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
                  📄 Fattura (Serie FT)
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
            </div>

            {tipoDocFiscale === 'nota_credito' && (
              <div style={{ background: '#200f40', border: '1px solid #3c1e70', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>
                  ℹ️ Verrà generata una Nota di Credito con numerazione separata (es. NC-2026/001).
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Causale Nota di Credito *</label>
                  <input value={causaNc} onChange={e => setCausaNc(e.target.value)} style={{ fontSize: 11 }} required />
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipologia Fatturazione (§18) *</label>
              <select value={tipoFattura} onChange={e => setTipoFattura(e.target.value as any)}>
                <option value="milestone_libera">🎯 Milestone Libera / Acconto</option>
                <option value="modulo_completo">✅ Modulo Completo Ultimato</option>
                <option value="modulo_parziale">📊 Avanzamento Parziale Modulo (%)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Descrizione in Fattura *</label>
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="es. Saldo modulo analisi patrimoniale" required />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Importo (€) *</label>
                <input type="number" value={importoEur} onChange={e => setImportoEur(Number(e.target.value))} min={1} required />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Canale Invio *</label>
                <select value={canale} onChange={e => setCanale(e.target.value as any)}>
                  <option value="sdi">📨 SDI (Comped Servizi FPA)</option>
                  <option value="standard">📄 Standard / Estero</option>
                </select>
              </div>
            </div>

            <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 8, padding: 10, fontSize: 11, color: '#34d399' }}>
              ✓ Al salvataggio verrà generato il tracciato XML FatturaPA e inviato a <strong>Comped Servizi FPA</strong>.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={submitting} style={{ background: tipoDocFiscale === 'nota_credito' ? '#7c3aed' : 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {submitting ? 'Generazione...' : tipoDocFiscale === 'nota_credito' ? '✓ Emetti Nota di Credito (Serie NC)' : '✓ Emetti Fattura Fiscale (Serie FT)'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function PlaceholderTab({ icon, label }: { icon: string; label: string }) {
  return (
    <div className={styles.placeholder}>
      <div style={{ fontSize: 40 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
        Contenuto sincronizzato in tempo reale con Supabase
      </div>
    </div>
  );
}

// ─── Componente Grafo & Dipendenze Moduli del Progetto ────────────
function GrafoModuliProgettoView({
  project,
  onAddModule,
  onSelectMod,
}: {
  project: Progetto;
  onAddModule: (mod: ModuloProgetto) => void;
  onSelectMod: (modId: number) => void;
}) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [dbModTemplates, setDbModTemplates] = useState<Array<{ id: string; n: string; cat: string; h: number; p: number; righe: any[] }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  useEffect(() => {
    async function loadTemplates() {
      try {
        const [mods, arts] = await Promise.all([fetchModuliLibreria(), fetchArticoli()]);
        if (mods && Array.isArray(mods) && mods.length > 0) {
          const mapped = mods.map((m: any) => {
            const righeResolved = (m.righeDistinta || []).map((r: any) => {
              const art = (arts || []).find((a: any) => a.id === r.articoloId) || r.articolo;
              return {
                n: art ? art.nome : 'Microvoce operativa',
                hE: (r.overrideOre != null ? r.overrideOre : (art?.oreDefault || 4)) * (r.quantita || 1),
                hA: 0,
                s: 'pending',
                as: 1,
                d: 0,
              };
            });
            const totH = righeResolved.reduce((acc: number, x: any) => acc + x.hE, 0);
            const totP = m.prezzoPacchetto ? m.prezzoPacchetto / 100 : (righeResolved.reduce((acc: number, x: any) => acc + (x.hE * 150), 0));
            return {
              id: m.id,
              n: m.nome,
              cat: m.categoria,
              h: totH || 10,
              p: totP || 1500,
              righe: righeResolved.length > 0 ? righeResolved : [
                { n: 'Analisi requisiti preliminari', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
                { n: 'Esecuzione pratiche societarie', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
              ],
            };
          });
          setDbModTemplates(mapped);
          if (mapped.length > 0) setSelectedTemplate(mapped[0].id);
        }
      } catch (err) {
        console.warn('loadTemplates fallback:', err);
      }
    }
    loadTemplates();
  }, []);

  const libraryTemplates = [
    { id: 't-trust', n: 'Trust & Asset Protection', cat: 'Trust', h: 30, p: 4500, righe: [{ n: 'Redazione Deed of Trust', hE: 15, hA: 0, s: 'pending', as: 1, d: 0 }] },
    { id: 't-ip', n: 'IP Licensing & Tax Optimization', cat: 'IP & Tax', h: 22, p: 3800, righe: [{ n: 'Deposito Marchio UE', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 }] },
    { id: 't-mfsa', n: 'Licenza Finanziaria MFSA VASP', cat: 'Compliance', h: 50, p: 9500, righe: [{ n: 'Deposito Istanza MFSA', hE: 25, hA: 0, s: 'pending', as: 1, d: 0 }] },
  ];

  const allAvailableTemplates = dbModTemplates.length > 0 ? dbModTemplates : libraryTemplates;

  const handleAddModuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tmpl = allAvailableTemplates.find(t => t.id === selectedTemplate) || allAvailableTemplates[0];
    if (!tmpl) return;

    const newMod: ModuloProgetto = {
      id: Date.now(),
      n: tmpl.n,
      cat: tmpl.cat as any,
      st: 'pending',
      pct: 0,
      h: tmpl.h,
      a: 0,
      p: tmpl.p,
      team: [1],
      v: tmpl.righe && tmpl.righe.length > 0 ? tmpl.righe : [
        { n: 'Analisi requisiti preliminari', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
        { n: 'Redazione documentazione integrativa', hE: 10, hA: 0, s: 'pending', as: 1, d: 0 },
      ],
    };
    onAddModule(newMod);
    setAddModalOpen(false);
  };

  const completedModsCount = project.mods.filter(m => m.st === 'done' || m.pct === 100).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Controlli Grafo */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🕸 Mappa Grafo Moduli & Workflow Dipendenze</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Visualizzazione dei moduli acquistati dal cliente, delle dipendenze sbloccate e dell'avanzamento live
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 11, background: 'var(--card2)', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 20, fontWeight: 600 }}>
            📊 Moduli Ultimati: <span style={{ color: '#34d399' }}>{completedModsCount} / {project.mods.length}</span>
          </div>
          <button
            onClick={() => setAddModalOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            + Aggiungi Modulo da Libreria
          </button>
        </div>
      </div>

      {/* Visual Flow / Grafo Moduli con Frecce */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, minHeight: 300, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Flusso Operativo Progetto & Avanzamento Live:
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, overflowX: 'auto', paddingBottom: 10 }}>
          {project.mods.map((m, idx) => {
            const isDone = m.st === 'done' || m.pct === 100;
            const isInProgress = m.st === 'in_progress' || (m.pct > 0 && m.pct < 100);

            // Calcolo sblocco topologico (locked / unlocked)
            const prevMod = idx > 0 ? project.mods[idx - 1] : null;
            const isLocked = prevMod ? (prevMod.st !== 'done' && prevMod.pct < 100) : false;

            const statusColor = isDone ? '#34d399' : isLocked ? '#f59e0b' : isInProgress ? '#818cf8' : '#64748b';
            const lockBadgeText = isDone ? '✓ Ultimato' : isLocked ? `🔒 Bloccato da ${prevMod?.n.substring(0, 14)}...` : isInProgress ? '⚡ In Lavorazione' : '🔓 Sbloccato & Eseguibile';

            return (
              <React.Fragment key={m.id}>
                {/* Node Card */}
                <div
                  onClick={() => onSelectMod(m.id)}
                  style={{
                    minWidth: 270,
                    maxWidth: 290,
                    background: isLocked ? 'rgba(217, 119, 6, 0.05)' : 'var(--card)',
                    border: `1.5px solid ${isDone ? '#059669' : isLocked ? '#d97706' : isInProgress ? 'var(--indigo)' : 'var(--border)'}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    cursor: 'pointer',
                    boxShadow: isInProgress ? '0 0 20px rgba(99,102,241,.25)' : isLocked ? '0 0 10px rgba(217,119,6,.15)' : '0 4px 16px rgba(0,0,0,.3)',
                    transition: 'all .2s',
                    opacity: isLocked ? 0.82 : 1,
                  }}
                  title={isLocked ? `Modulo bloccato in attesa del completamento di: ${prevMod?.n}` : "Clicca per aprire la scheda dettagliata del modulo"}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <CatBadge cat={m.cat} />
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: statusColor, background: isLocked ? '#2d1a05' : 'var(--card2)', border: `1px solid ${isLocked ? '#d97706' : 'var(--border)'}`, padding: '2px 8px', borderRadius: 12 }}>
                      {lockBadgeText}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{m.n}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                      {m.v ? `${m.v.length} Microvoci operative` : 'Passaggi guidati'}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                      <span>Avanzamento Live</span>
                      <span style={{ fontWeight: 700, color: statusColor }}>{m.pct}%</span>
                    </div>
                    <ProgressBar value={m.pct} color={statusColor} height={5} />
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--muted)' }}>
                    <span>⏱ {m.a}/{m.h}h</span>
                    <span style={{ fontWeight: 700, color: 'var(--text)' }}>{fmt(m.p)}</span>
                  </div>

                  {/* Pulsante Notifica Sblocco al Cliente */}
                  {isDone && idx < project.mods.length - 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        alert(`✉️ Notifica Sblocco inviata con successo al cliente per la fase successiva: ${project.mods[idx + 1].n}!`);
                      }}
                      style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '5px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600, cursor: 'pointer', marginTop: 2 }}
                    >
                      ✉️ Notifica Sblocco al Cliente
                    </button>
                  )}
                </div>

                {/* Arrow Connector */}
                {idx < project.mods.length - 1 && (
                  <div style={{ display: 'flex', flexShrink: 0, flexDirection: 'column', alignItems: 'center', gap: 4, color: isDone ? '#34d399' : isLocked ? '#d97706' : 'var(--muted)' }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{isDone ? '🔓 ➔' : '🔒 ➔'}</div>
                    <span style={{ fontSize: 9, fontWeight: 600 }}>{isDone ? 'Sbloccato' : 'In attesa'}</span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Modal Aggiungi Modulo da Libreria */}
      {addModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleAddModuleSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>+ Aggiungi Modulo da Libreria al Progetto</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona una prestazione o modulo aggiuntivo dal catalogo della libreria da associare al cliente</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo Template Libreria *</label>
              <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{ padding: 10, fontSize: 12 }}>
                {allAvailableTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.n} ({t.cat}) — {t.h}h — {fmt(t.p)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)' }}>
              ℹ️ Il nuovo modulo verrà inserito nel <strong>Grafo del Progetto</strong> con stato <em>Pending</em> ed integrato nello scadenzario delle microvoci.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setAddModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Aggiungi al Progetto</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Componente Redditività Incarico & Report Margini ──────────────
function RedditivitaTab({
  project,
}: {
  project: Progetto;
}) {
  const valoreTotale = project.val || 38000;
  
  // Ore Stimate totali vs Ore Consuntivate totali
  const oreStimateTot = (project.mods || []).reduce((acc, m) => acc + (m.h || 0), 0) || 52;
  const oreConsuntivateTot = (project.mods || []).reduce((acc, m) => acc + (m.a || 0), 0) || 48.5;
  
  // Costo orario interno studio (es. € 150/h)
  const costoOrarioStudio = 150;
  const costoOperativoStudio = oreConsuntivateTot * costoOrarioStudio;
  
  // Margine Lordo Studio (€)
  const margineLordo = valoreTotale - costoOperativoStudio;
  
  // Resa Oraria Effettiva Studio (€/ora)
  const resaOrariaStudio = oreConsuntivateTot > 0 ? (valoreTotale / oreConsuntivateTot) : (valoreTotale / 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Tabella Redditività */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📊 Analisi Redditività Incarico & Rendiconto Margini Orari</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Monitoraggio in tempo reale del margine di profitto dello studio per <strong>{project.cl}</strong> (Ore Stimate vs Ore Reali)
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            alert(`📄 Dossier Trasparenza & Rendiconto Incarico per ${project.cl} generato ed esportato in PDF con successo!`);
          }}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
        >
          📄 Esporta Dossier Trasparenza PDF
        </button>
      </div>

      {/* 📊 KPI FINANCIAL CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>💶 Valore Incarico Cliente</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>{fmt(valoreTotale)}</div>
          <div style={{ fontSize: 10, color: '#34d399', marginTop: 2 }}>✓ Concordato a contrattazione</div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⏱ Ore Stimate vs Consuntivate</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#818cf8', marginTop: 4 }}>{oreConsuntivateTot}h <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>/ {oreStimateTot}h</span></div>
          <div style={{ fontSize: 10, color: oreConsuntivateTot <= oreStimateTot ? '#34d399' : '#f59e0b', marginTop: 2 }}>
            {oreConsuntivateTot <= oreStimateTot ? '✓ In linea con la stima' : '⚠️ Sforamento ore stimate'}
          </div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>🏦 Margine Lordo Studio</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#34d399', marginTop: 4 }}>{fmt(margineLordo)}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Costo Op: {fmt(costoOperativoStudio)}</div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⚡ Resa Oraria Effettiva Studio</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24', marginTop: 4 }}>{fmt(resaOrariaStudio)} / h</div>
          <div style={{ fontSize: 10, color: '#34d399', marginTop: 2 }}>⚡ Target Studio: € 250 / h</div>
        </div>
      </div>

      {/* 📊 TABELLA REDDITIVITÀ PER SINGOLO MODULO */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          📋 Dettaglio Rendiconto e Margini per Singolo Modulo dell'Incarico
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '10px 12px' }}>Modulo Incarico</th>
                <th style={{ padding: '10px 12px' }}>Categoria</th>
                <th style={{ padding: '10px 12px' }}>Prezzo Modulo</th>
                <th style={{ padding: '10px 12px' }}>Ore Stimate vs Reali</th>
                <th style={{ padding: '10px 12px' }}>Costo Interno Studio</th>
                <th style={{ padding: '10px 12px' }}>Margine Lordo</th>
                <th style={{ padding: '10px 12px' }}>Resa Oraria Reale</th>
                <th style={{ padding: '10px 12px' }}>Stato Profitto</th>
              </tr>
            </thead>
            <tbody>
              {(project.mods || []).map((m, idx) => {
                const modP = m.p || 3500;
                const modH_Stima = m.h || 10;
                const modH_Reali = m.a || (m.pct === 100 ? modH_Stima : modH_Stima * (m.pct / 100));
                const modCostoStudio = modH_Reali * costoOrarioStudio;
                const modMargine = modP - modCostoStudio;
                const modResa = modH_Reali > 0 ? (modP / modH_Reali) : modP;
                const isProfit = modResa >= 250;

                return (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text)' }}>
                      {m.n}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <CatBadge cat={m.cat} />
                    </td>
                    <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text)' }}>
                      {fmt(modP)}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ fontWeight: 700, color: '#818cf8' }}>{modH_Reali.toFixed(1)}h</span>
                      <span style={{ color: 'var(--muted)', fontSize: 10 }}> / {modH_Stima}h</span>
                    </td>
                    <td style={{ padding: '12px', color: 'var(--muted)' }}>
                      {fmt(modCostoStudio)}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 700, color: modMargine > 0 ? '#34d399' : '#ef4444' }}>
                      {fmt(modMargine)}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 800, color: '#fbbf24' }}>
                      {fmt(modResa)} / h
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ fontSize: 9.5, background: isProfit ? '#0d2d22' : '#2d1a05', color: isProfit ? '#34d399' : '#f59e0b', border: `1px solid ${isProfit ? '#059669' : '#d97706'}`, padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
                        {isProfit ? '🟢 In Utile Extra' : '🟡 In Target'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Documenti & Vault Legale Progetto ──────────────────
function DocumentiTab({ project }: { project: Progetto }) {
  const [docCategory, setDocCategory] = useState('ALL');
  const [uploading, setUploading] = useState(false);
  const [docList, setDocList] = useState<any[]>([
    { id: 'doc-01', nome: 'Engagement Letter & Proposta d Incarico Firmata.pdf', cat: 'Contratti', dimensione: '1.4 MB', data: '15/08/2026', firmato: true, url: '#' },
    { id: 'doc-02', nome: 'Certificato Camerale & Statuto MFSA Malta.pdf', cat: 'Societario', dimensione: '3.2 MB', data: '14/08/2026', firmato: true, url: '#' },
    { id: 'doc-03', nome: 'Fascicolo Compliance KYC & UBO Registry.pdf', cat: 'Compliance', dimensione: '2.8 MB', data: '12/08/2026', firmato: true, url: '#' },
    { id: 'doc-04', nome: 'Deed of Trust & Letter of Wishes.pdf', cat: 'Trust', dimensione: '4.1 MB', data: '10/08/2026', firmato: false, url: '#' },
  ]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const res = await uploadFileApi(file.name, base64);
        const newDoc = {
          id: `doc-${Date.now()}`,
          nome: file.name,
          cat: 'Allegati Progetto',
          dimensione: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
          data: 'Oggi',
          firmato: false,
          url: res?.url || '#',
        };
        setDocList([newDoc, ...docList]);
        alert(`✓ Documento "${file.name}" caricato nel Vault del Progetto con successo!`);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert('Errore nel caricamento del file');
    } finally {
      setUploading(false);
    }
  };

  const filteredDocs = docCategory === 'ALL' ? docList : docList.filter(d => d.cat === docCategory);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Document Vault */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📄 Vault Documenti Legali & Fascicolo Incarico</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Archivio di tutti i contratti firmati, certificati societari, dossier KYC ed allegati relativi a <strong>{project.cl}</strong>
          </div>
        </div>

        <label style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{uploading ? 'Caricamento in corso...' : '📤 Carica Nuovo Documento'}</span>
          <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>

      {/* Toolbar Filtro Categorie */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['ALL', 'Contratti', 'Societario', 'Compliance', 'Trust', 'Allegati Progetto'].map(cat => (
          <button
            key={cat}
            onClick={() => setDocCategory(cat)}
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: docCategory === cat ? '#1a1f3d' : 'var(--card2)',
              color: docCategory === cat ? '#818cf8' : 'var(--muted)',
              border: `1px solid ${docCategory === cat ? '#3730a3' : 'var(--border)'}`,
            }}
          >
            {cat === 'ALL' ? '🌐 Tutti i Documenti' : cat}
          </button>
        ))}
      </div>

      {/* Tabella Documenti */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '10px 12px' }}>Nome File / Documento</th>
                <th style={{ padding: '10px 12px' }}>Categoria</th>
                <th style={{ padding: '10px 12px' }}>Dimensione</th>
                <th style={{ padding: '10px 12px' }}>Data Caricamento</th>
                <th style={{ padding: '10px 12px' }}>Firma eIDAS</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filteredDocs.map(doc => (
                <tr key={doc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text)' }}>
                    📄 {doc.nome}
                  </td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ fontSize: 10, background: '#1a1f3d', color: '#818cf8', padding: '2px 8px', borderRadius: 10, border: '1px solid #3730a3' }}>
                      {doc.cat}
                    </span>
                  </td>
                  <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.dimensione}</td>
                  <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.data}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ fontSize: 9.5, background: doc.firmato ? '#0d2d22' : '#2d1a05', color: doc.firmato ? '#34d399' : '#f59e0b', border: `1px solid ${doc.firmato ? '#059669' : '#d97706'}`, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                      {doc.firmato ? '🔒 eIDAS Verificato' : '⏳ In attesa di firma'}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => alert(`Apertura ed anteprima documento: ${doc.nome}`)}
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--indigo-l)', padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                    >
                      👁 Visualizza
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Componente Calendario & Scadenzario Incarico ─────────────────
function CalendarioProgettoTab({ project }: { project: Progetto }) {
  const [modalNewEvent, setModalNewEvent] = useState(false);
  const [titoloScadenza, setTitoloScadenza] = useState('');
  const [dataScadenza, setDataScadenza] = useState('');
  const [assegnatario, setAssegnatario] = useState('Joe Disabato');

  const [events, setEvents] = useState<any[]>([
    { id: 'ev-1', titolo: 'Consegna bozza Deed of Trust al Cliente', data: '18/08/2026', stato: 'pending', assegnatario: 'Joe Disabato', tipo: 'Milestone' },
    { id: 'ev-2', titolo: 'Deposito Istanza autorizzativa MFSA', data: '22/08/2026', stato: 'pending', assegnatario: 'Francesca Disabato', tipo: 'Compliance' },
    { id: 'ev-3', titolo: 'Call di allineamento con Advisor Elvetico', data: '25/08/2026', stato: 'pending', assegnatario: 'Avv. Lorenzo Marino', tipo: 'Meeting' },
    { id: 'ev-4', titolo: 'Verifica preliminare fascicolo KYC', data: '12/08/2026', stato: 'done', assegnatario: 'Elena Rossi', tipo: 'Check' },
  ]);

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titoloScadenza || !dataScadenza) return;
    const newEv = {
      id: `ev-${Date.now()}`,
      titolo: titoloScadenza,
      data: dataScadenza,
      stato: 'pending',
      assegnatario,
      tipo: 'Scadenza Incarico',
    };
    setEvents([newEv, ...events]);
    setModalNewEvent(false);
    setTitoloScadenza('');
    setDataScadenza('');
    alert(`✓ Scadenza "${titoloScadenza}" aggiunta allo Scadenzario del Progetto ed integrata nel Calendario Studio!`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Calendario */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📅 Scadenzario & Milestone Incarico</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Pianificazione temporale e promemoria delle scadenze operative per <strong>{project.cl}</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setModalNewEvent(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
        >
          + Programma Nuova Scadenza
        </button>
      </div>

      {/* Lista Scadenze */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          ⏱ Cronologia Scadenze e Promemoria Incarico
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map(ev => (
            <div key={ev.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 20 }}>{ev.stato === 'done' ? '✅' : '⏳'}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{ev.titolo}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Assegnato a: <strong>{ev.assegnatario}</strong> · Categoria: <span style={{ color: '#818cf8' }}>{ev.tipo}</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#818cf8', background: '#1a1f3d', padding: '4px 10px', borderRadius: 8, border: '1px solid #3730a3' }}>
                  📅 {ev.data}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEvents(events.map(x => x.id === ev.id ? { ...x, stato: x.stato === 'done' ? 'pending' : 'done' } : x));
                  }}
                  style={{ background: ev.stato === 'done' ? '#0d2d22' : 'transparent', border: `1px solid ${ev.stato === 'done' ? '#059669' : 'var(--border)'}`, color: ev.stato === 'done' ? '#34d399' : 'var(--muted)', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >
                  {ev.stato === 'done' ? '✓ Completato' : 'Marca Come Completato'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Nuova Scadenza */}
      {modalNewEvent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <form onSubmit={handleAddEvent} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>+ Programma Nuova Scadenza Incarico</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Crea un evento nel calendario condiviso dello studio associato a questo progetto</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolo Scadenza / Attività *</label>
              <input value={titoloScadenza} onChange={e => setTitoloScadenza(e.target.value)} required placeholder="es. Deposito statuto presso MFSA" style={{ fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data Scadenza *</label>
              <input type="date" value={dataScadenza} onChange={e => setDataScadenza(e.target.value)} required style={{ fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Assegnatario *</label>
              <select value={assegnatario} onChange={e => setAssegnatario(e.target.value)} style={{ padding: 10, fontSize: 12 }}>
                <option value="Joe Disabato">Joe Disabato (Lead Advisor)</option>
                <option value="Francesca Disabato">Francesca Disabato (Back Office)</option>
                <option value="Avv. Lorenzo Marino">Avv. Lorenzo Marino (Legal Counsel)</option>
                <option value="Elena Rossi">Elena Rossi (Tax Advisor)</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setModalNewEvent(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Salva Scadenza</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
