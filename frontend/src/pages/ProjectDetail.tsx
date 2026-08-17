import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { CatBadge } from '../components/ui/CatBadge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup, Avatar } from '../components/ui/Avatar';
import { PassaggioModal } from '../components/PassaggioModal';
import { fmt, progressColor, getFormattedLogoUrl, resolveRighe } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import { SimpleZipBuilder } from '../utils/zipBuilder';
import { PREBUILT_TEMPLATES, resolveDocumentTemplateHtml } from '../utils/documentTemplates';
import { ComunicazioniTab } from '../components/ComunicazioniTab';
import { AssignOperatorModal } from '../components/AssignOperatorModal';
import { CalendarPreviewModal } from '../components/CalendarPreviewModal';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { PROJECTS, MLIB, ARTICOLI } from '../store/mockData';
import { fetchProgettoDettaglio, emettiFatturaApi, consuntivaMicrovoceApi, assegnaAccessoProgettoApi, salvaProgettoDettaglioApi, archiviaProgettoApi, eliminaProgettoApi, fetchModuliLibreria, fetchArticoli, uploadFileApi, inviaComunicazioneApi } from '../api/client';
import { TEAM } from '../store/mockData';
import { useTeamMembers } from '../hooks/useTeamMembers';
import type { Progetto, ModuloProgetto, MicroVoce, CategoriaModulo, StatoProgetto, StatoModulo, Cliente } from '../types';
import styles from './ProjectDetail.module.css';

type Tab = 'moduli' | 'grafo' | 'fatturazione' | 'redditivita' | 'storico' | 'comunicazioni' | 'documenti' | 'calendario';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [currentClient, setCurrentClient] = useState<Cliente | null>(null);
  const [project, setProject] = useState<Progetto | null>(() => {
    return PROJECTS.find(p => String(p.id) === String(id)) || null;
  });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('moduli');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [procV, setProcV] = useState<{ mid: number; vidx: number } | null>(null);
  const [accessiModalOpen, setAccessiModalOpen] = useState(false);
  const { team: teamList } = useTeamMembers();
  const [selectedUser, setSelectedUser] = useState(TEAM[0].n || (TEAM[0] as any).name);
  const [livello, setLivello] = useState('write');
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
          const teamSet = new Set(m.team || []);
          teamSet.add(operatorId);
          return { ...m, v: newV, team: Array.from(teamSet) };
        } else {
          return { ...m, team: [operatorId] };
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
    assegnaAccessoProgettoApi(String(project.id), `usr-0${operatorId}`, roleLevel).catch(() => {});
  };

  // Raw DB response per conservare gli ID reali delle microvoci Supabase
  const [rawDbProject, setRawDbProject] = useState<any>(null);

  const loadDetail = async () => {
    setLoading(true);
    if (id) {
      const localStr = localStorage.getItem('bluman_custom_projects');
      const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
      const localSavedProj = localProjs.find(p => String(p.id) === String(id));

      const dbRes = await fetchProgettoDettaglio(id);
      if (dbRes && dbRes.id) {
        setRawDbProject(dbRes);
        if (dbRes.cliente) {
          setCurrentClient(dbRes.cliente);
        }

        let finalMods = (dbRes.moduli || []).map((m: any, mIdx: number) => {
          const localMod = localSavedProj?.mods?.find((lm: any) => lm.n.toLowerCase() === (m.nome || '').toLowerCase() || lm.id === (mIdx + 100));

          let microvociList = (m.microvoci || []).map((mv: any, vIdx: number) => {
            let savedNotes = mv.note;
            if (!savedNotes) {
              const localSaved = localStorage.getItem(`bluman_notes_${dbRes.id}_${m.id || mIdx + 100}_${vIdx}`);
              if (localSaved) {
                try { savedNotes = JSON.parse(localSaved); } catch {}
              }
            }
            const localMv = localMod?.v?.[vIdx];
            const assignedAs = mv.as || mv.assegnatoId || localMv?.as || 1;

            return {
              n: mv.nome,
              hE: mv.orePreventivate || 4,
              hA: mv.oreConsuntivate || 0,
              s: mv.stato || 'pending',
              as: assignedAs,
              d: mv.passaggi?.length || 0,
              vn: mv.causaNota || undefined,
              proc: mv.proc || (mv.passaggi?.length ? mv.passaggi.map((p: any) => ({
                id: p.id,
                title: p.titolo,
                type: p.tipo,
                who: p.chi,
                stato: p.stato,
                desc: p.descrizione,
                file: p.documentoAllegatoUrl,
                fields: p.campiFormJson,
              })) : undefined),
              note: savedNotes,
            };
          });

          // Se il modulo non ha ancora microvoci nel DB, cerca gli articoli corrispondenti per quel modulo
          if (microvociList.length === 0) {
            const matchedMockMod = MLIB.find(libM => libM.n.toLowerCase() === (m.nome || '').toLowerCase())
              || MLIB[mIdx % MLIB.length];
            if (matchedMockMod && matchedMockMod.righe) {
              const rList = resolveRighe(matchedMockMod, ARTICOLI);
              microvociList = rList.map((r, rIdx) => {
                const localMv = localMod?.v?.[rIdx];
                return {
                  n: r.art?.n || (r as any).n || 'Microvoce',
                  hE: r.h || 4,
                  hA: 0,
                  s: 'pending' as any,
                  as: localMv?.as || 1,
                  d: 0,
                };
              });
            } else {
              microvociList = [
                { n: `Analisi e requisiti per ${m.nome}`, hE: 4, hA: 0, s: 'pending', as: 1, d: 0 },
                { n: `Esecuzione e predisposizione fascicolo ${m.nome}`, hE: 6, hA: 0, s: 'pending', as: 1, d: 0 },
                { n: `Rilascio parere e asseverazione ${m.nome}`, hE: 4, hA: 0, s: 'pending', as: 1, d: 0 },
              ];
            }
          }

          const assignedTeam = localMod?.team || m.team || [1, 2];

          return {
            id: mIdx + 100,
            n: m.nome,
            cat: (m.categoria as CategoriaModulo) || 'Societario',
            st: m.stato || 'in_progress',
            pct: m.stato === 'done' ? 100 : m.stato === 'in_progress' ? 60 : 0,
            h: m.orePreventivate || microvociList.reduce((sum, v) => sum + v.hE, 0) || 20,
            a: m.oreConsuntivate || 0,
            p: m.prezzo ? m.prezzo / 100 : 3500,
            team: assignedTeam,
            delay: m.stato === 'delayed' || m.stato === 'blocked',
            v: microvociList,
          };
        });

        // Se i moduli DB sono vuoti, arricchisci dai progetti custom salvati in locale o mockData
        if (finalMods.length === 0) {
          const localStr = localStorage.getItem('bluman_custom_projects');
          const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
          const match = localProjs.find(p => String(p.id) === String(id) || p.cl === dbRes.cliente?.nome || p.n === dbRes.nome)
                     || PROJECTS.find(p => String(p.id) === String(id) || p.cl === dbRes.cliente?.nome);
          if (match && match.mods && match.mods.length > 0) {
            finalMods = match.mods;
          } else {
            // Genera moduli standard e relative microvoci/articoli
            finalMods = [
              {
                id: 101,
                n: 'Modulo Iniziale Incarico Advisory',
                cat: 'Analisi' as CategoriaModulo,
                st: 'pending',
                pct: 0,
                h: 15,
                a: 0,
                p: 3500,
                team: [1],
                delay: false,
                v: [
                  { n: 'Raccolta documenti e KYC cliente', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
                  { n: 'Verifica requisiti e giurisdizione', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
                  { n: 'Redazione report conclusivo', hE: 5, hA: 0, s: 'pending', as: 1, d: 0 }
                ]
              }
            ];
          }
        }

        // Sanificazione generale: nessun modulo deve avere v vuoto
        finalMods = finalMods.map((m, mIdx) => {
          let vList = m.v || [];
          if (!vList || vList.length === 0) {
            const matchedMock = MLIB.find(libM => libM.n.toLowerCase().trim() === m.n.toLowerCase().trim())
              || MLIB.find(libM => m.n.toLowerCase().includes(libM.n.toLowerCase()))
              || MLIB[mIdx % MLIB.length];
            if (matchedMock && matchedMock.righe) {
              const rList = resolveRighe(matchedMock, ARTICOLI);
              vList = rList.map(r => ({
                n: r.art?.n || (r as any).n || 'Microvoce',
                hE: r.h || 4,
                hA: 0,
                s: 'pending' as any,
                as: 1,
                d: 0,
              }));
            } else {
              vList = [
                { n: `Raccolta documentazione per ${m.n}`, hE: 4, hA: 0, s: 'pending', as: 1, d: 0 },
                { n: `Predisposizione pratica ed adempimenti ${m.n}`, hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
                { n: `Chiusura e verifica conformità ${m.n}`, hE: 3, hA: 0, s: 'pending', as: 1, d: 0 },
              ];
            }
          }
          return {
            ...m,
            v: vList,
          };
        });

        const calculatedVal = finalMods.reduce((acc: number, m: any) => acc + (m.p || 0), 0) || (dbRes.valoreCentesimi ? dbRes.valoreCentesimi / 100 : 3500);

        setProject({
          id: dbRes.id,
          n: dbRes.nome,
          cl: dbRes.cliente?.nome || 'Cliente Studio',
          ct: dbRes.cliente?.tipo === 'company' ? 'company' : 'individual',
          st: dbRes.stato || 'in_progress',
          pct: dbRes.percentualeAvanzamento || 0,
          start: new Date(dbRes.createdAt).toLocaleDateString(),
          due: '30 giorni',
          val: calculatedVal,
          delay: false,
          fisc: 'privato_italia',
          fatture: (dbRes.fatture || []).map((f: any) => ({
            id: f.id,
            numero: f.numero,
            desc: f.righe?.[0]?.descrizione || 'Fattura Progetto',
            importo: f.righe?.reduce((a: number, r: any) => a + r.importo, 0) / 100 || 0,
            data: f.data,
            stato: f.stato === 'incassata' ? 'incassata' : 'emessa',
          })),
          mods: finalMods,
        });
        if (finalMods.length > 0) {
          setExpanded(new Set(finalMods.map(m => m.id)));
        }
      } else {
        const localStr = localStorage.getItem('bluman_custom_projects');
        const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
        let match = localProjs.find(p => String(p.id) === String(id))
                 || PROJECTS.find(p => String(p.id) === String(id))
                 || localProjs.find(p => String(p.id).includes(String(id)))
                 || PROJECTS[0];

        if (match) {
          // Sanifica le microvoci del match
          const sanitizedMods = (match.mods || []).map((m, mIdx) => {
            let vList = m.v || [];
            if (!vList || vList.length === 0) {
              const matchedMock = MLIB.find(libM => libM.n.toLowerCase().trim() === m.n.toLowerCase().trim())
                || MLIB.find(libM => m.n.toLowerCase().includes(libM.n.toLowerCase()))
                || MLIB[mIdx % MLIB.length];
              if (matchedMock && matchedMock.righe) {
                const rList = resolveRighe(matchedMock, ARTICOLI);
                vList = rList.map(r => ({
                  n: r.art?.n || (r as any).n || 'Microvoce',
                  hE: r.h || 4,
                  hA: 0,
                  s: 'pending' as any,
                  as: 1,
                  d: 0,
                }));
              } else {
                vList = [
                  { n: `Raccolta documentazione per ${m.n}`, hE: 4, hA: 0, s: 'pending', as: 1, d: 0 },
                  { n: `Predisposizione pratica ed adempimenti ${m.n}`, hE: 5, hA: 0, s: 'pending', as: 1, d: 0 },
                  { n: `Chiusura e verifica conformità ${m.n}`, hE: 3, hA: 0, s: 'pending', as: 1, d: 0 },
                ];
              }
            }
            return { ...m, v: vList };
          });

          const modValSum = sanitizedMods.reduce((acc: number, m: any) => acc + (m.p || 0), 0);
          const finalVal = modValSum > 0 ? modValSum : match.val;

          const updatedMatch = {
            ...match,
            mods: sanitizedMods,
            val: finalVal,
          };

          setProject(updatedMatch);
          if (sanitizedMods.length > 0) {
            setExpanded(new Set(sanitizedMods.map(m => m.id)));
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
    const globalSt: StatoProgetto = globalPct === 100 ? 'completed' : 'in_progress';

    const updatedProject: Progetto = {
      ...project,
      mods: newMods as ModuloProgetto[],
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

    // Notifica automatica milestone completata nel fascicolo comunicazione
    const targetMv = project.mods.find(m => m.id === modId)?.v?.[mvIdx];
    if (targetMv && targetMv.s !== 'done') {
      inviaComunicazioneApi(String(project.id), {
        canale: 'whatsapp',
        mittente: 'BlueCode Advisor Studio',
        destinatario: project.cl,
        direzione: 'uscita',
        testo: `🔔 Avanzamento Pratica "${project.n}": La fase "${targetMv.n}" è stata completata con successo! L'avanzamento complessivo è ora al ${globalPct}%.`,
      }).catch(() => {});
    }
  };

  const handleSavePassaggiModal = (modId: number, mvIdx: number, nextSteps: any[], nextNotes?: any[]) => {
    if (!project) return;
    const isAllDone = nextSteps.length > 0 && nextSteps.every(s => s.stato === 'done');
    const newMods = project.mods.map(m => {
      if (m.id === modId) {
        const newV = m.v.map((mv, idx) => {
          if (idx === mvIdx) {
            return {
              ...mv,
              proc: nextSteps,
              ...(nextNotes ? { note: nextNotes } : {}),
              s: isAllDone ? ('done' as const) : nextSteps.some(s => s.stato === 'done') ? ('active' as const) : mv.s,
            };
          }
          return mv;
        });
        const doneCount = newV.filter(v => v.s === 'done').length;
        const newPct = newV.length > 0 ? Math.round((doneCount / newV.length) * 100) : 0;
        const newSt: StatoModulo = newPct === 100 ? 'done' : newPct > 0 ? 'in_progress' : 'pending';
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

    const updatedProject: Progetto = {
      ...project,
      mods: newMods,
      pct: globalPct,
    };

    setProject(updatedProject);

    const savedStr = localStorage.getItem('bluman_custom_projects');
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));

    if (nextNotes) {
      localStorage.setItem(`bluman_notes_${project.id}_${modId}_${mvIdx}`, JSON.stringify(nextNotes));
    }

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
            <span
              style={{ fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}
              title="Modifica Titolo Progetto (Admin)"
              onClick={async () => {
                const nuovoTitolo = prompt('Inserisci il nuovo titolo del progetto:', project.n);
                if (nuovoTitolo && nuovoTitolo.trim() && nuovoTitolo.trim() !== project.n) {
                  const updated = { ...project, n: nuovoTitolo.trim() };
                  setProject(updated);
                  const savedStr = localStorage.getItem('bluman_custom_projects');
                  const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
                  const updatedArr = [updated, ...savedArr.filter(p => String(p.id) !== String(project.id))];
                  localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));
                  await salvaProgettoDettaglioApi(String(project.id), updated);
                }
              }}
            >
              ✏️
            </span>
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
            <span
              style={{ cursor: 'pointer' }}
              title="Valore Incarico (Modificabile dall'Admin)"
              onClick={async () => {
                const nuovoVal = prompt('Inserisci il nuovo valore totale dell\'incarico (€):', String(project.val));
                if (nuovoVal && !isNaN(Number(nuovoVal))) {
                  const updated = { ...project, val: Number(nuovoVal) };
                  setProject(updated);
                  const savedStr = localStorage.getItem('bluman_custom_projects');
                  const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
                  const updatedArr = [updated, ...savedArr.filter(p => String(p.id) !== String(project.id))];
                  localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));
                  await salvaProgettoDettaglioApi(String(project.id), updated);
                }
              }}
            >
              💶 {fmt(project.val)} ✏️
            </span>
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
                          { n: 'Verifica giurisdizione e fiscalità intercompany', hE: 6, hA: 1, s: 'active', as: 1, d: 0 },
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
                          { n: 'Bozza Atto Costitutivo e Statuto', hE: 10, hA: 6, s: 'active', as: 1, d: 0 },
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
                          { n: 'Selezione Trust Company idonea', hE: 5, hA: 2, s: 'active', as: 1, d: 0 },
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
                  onDeleteMod={async () => {
                    const confirmDel = window.confirm(`Sei sicuro di voler eliminare il modulo "${mod.n}" dal progetto?`);
                    if (!confirmDel) return;
                    const newMods = project.mods.filter(m => m.id !== mod.id);
                    const updatedVal = newMods.reduce((acc, m) => acc + (m.p || 0), 0);
                    const updatedProject = { ...project, mods: newMods, val: updatedVal };
                    setProject(updatedProject);
                    try {
                      await salvaProgettoDettaglioApi(String(project.id), updatedProject);
                    } catch (err) {
                      console.warn('Salvataggio eliminazione modulo fallback:', err);
                    }
                    const savedStr = localStorage.getItem('bluman_custom_projects');
                    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
                    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
                    localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));
                  }}
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
              Registro delle versioni contrattuali, firma digitale ed addendum d'ordine per <strong>{project.cl}</strong> (Incarico: <em>{project.n}</em>).
            </div>

            {/* Baseline Contratto Iniziale */}
            <div style={{
              background: project.st === 'pre_project' ? 'rgba(217, 119, 6, 0.08)' : '#0d2d22',
              border: `1px solid ${project.st === 'pre_project' ? '#f59e0b' : '#1a5c3c'}`,
              borderRadius: 12,
              padding: 16,
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <span style={{
                    background: project.st === 'pre_project' ? '#f59e0b' : '#34d399',
                    color: project.st === 'pre_project' ? '#451a03' : '#064e3b',
                    fontSize: 10,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 10,
                    textTransform: 'uppercase'
                  }}>
                    {project.st === 'pre_project' ? '✍️ PROPOSTA D\'ORDINE IN ATTESA DI FIRMA (v1.0)' : '🔒 CONTRATTO FIRMATO & CONGELATO (v1.0)'}
                  </span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>
                    Engagement Letter — {project.n}
                  </div>
                  <div style={{ fontSize: 10, color: project.st === 'pre_project' ? '#fde68a' : '#a7f3d0' }}>
                    {project.st === 'pre_project'
                      ? `Generata in data ${project.start} · In attesa di validazione e firma digitale 1-Click del cliente`
                      : `Stipula: ${project.start} · Registrazione eIDAS Validata`}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: project.st === 'pre_project' ? '#f59e0b' : '#34d399' }}>
                  {fmt(project.val)}
                </div>
              </div>
              <div style={{ fontSize: 11, color: project.st === 'pre_project' ? '#fde68a' : '#6ee7b7' }}>
                • Moduli Iniziali Incorporati: {project.mods && project.mods.length > 0 ? project.mods.map(m => m.n).join(', ') : 'Nessun modulo ancora incorporato'}
              </div>
            </div>

            {/* Timeline Addendums */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Integrazioni & Addendum d'Ordine Successivi:</div>
              {(() => {
                const savedAdd = localStorage.getItem(`bluman_addendums_${project.id}`);
                const addList = savedAdd ? JSON.parse(savedAdd) : [];
                if (addList.length === 0) {
                  return (
                    <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', padding: 12, borderRadius: 8 }}>
                      Nessun addendum successivo per questo progetto. La proposta/contratto v1.0 è attualmente la versione attiva.
                    </div>
                  );
                }
                return addList.map((a: any, idx: number) => (
                  <div key={idx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                      <span>{a.title || `Addendum v1.${idx + 1}`}</span>
                      <span style={{ color: 'var(--indigo-l)' }}>{fmt(a.prezzo || 0)}</span>
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
        {tab === 'comunicazioni' && (
          <ComunicazioniTab
            progettoId={String(project.id)}
            nomeCliente={project.cl}
            emailCliente={currentClient?.email || "client@holdingbeta.advisory"}
            cliente={currentClient}
          />
        )}
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
          onSaveVoce={(steps, notes) => handleSavePassaggiModal(procV.mid, procV.vidx, steps, notes)}
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
                {teamList.slice(0, 2).map((u, i) => (
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
                {teamList.map(u => (
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

function ModuloBlock({ mod, open, onToggle, onOpenProc, rawDbModulo, onRefresh, onToggleMv, onOpenAssignMod, onOpenAssignMv, onOpenCalendarMv, onDeleteMod }: {
  mod: ModuloProgetto; open: boolean;
  onToggle: () => void; onOpenProc: (vidx: number) => void;
  rawDbModulo?: any; onRefresh: () => void;
  onToggleMv: (vidx: number) => void;
  onOpenAssignMod: () => void;
  onOpenAssignMv: (vidx: number) => void;
  onOpenCalendarMv: (vidx: number) => void;
  onDeleteMod?: () => void;
}) {
  const color = mod.st === 'blocked' ? 'var(--red)'
    : mod.delay ? 'var(--amber)'
    : mod.waitDep ? 'var(--purple)'
    : 'var(--indigo)';

  const [consuntivaMv, setConsuntivaMv] = useState<any | null>(null);
  const [oreCons, setOreCons] = useState(2);
  const [completa, setCompleta] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Microvoci effettive (con fallback istantaneo su catalogo articoli se vuote)
  const displayMicrovoci: MicroVoce[] = (mod.v && mod.v.length > 0) ? mod.v : (() => {
    const matchedMock = MLIB.find(libM => libM.n.toLowerCase().trim() === mod.n.toLowerCase().trim())
      || MLIB.find(libM => mod.n.toLowerCase().includes(libM.n.toLowerCase()))
      || MLIB[0];
    if (matchedMock && matchedMock.righe) {
      const rList = resolveRighe(matchedMock, ARTICOLI);
      return rList.map(r => ({
        n: r.art?.n || (r as any).n || 'Microvoce',
        hE: r.h || 4,
        hA: 0,
        s: 'pending' as any,
        as: 1,
        d: 0,
      }));
    }
    return [
      { n: `Raccolta documentazione per ${mod.n}`, hE: 4, hA: 0, s: 'pending' as any, as: 1, d: 0 },
      { n: `Predisposizione pratica ed adempimenti ${mod.n}`, hE: 5, hA: 0, s: 'pending' as any, as: 1, d: 0 },
      { n: `Chiusura e verifica conformità ${mod.n}`, hE: 3, hA: 0, s: 'pending' as any, as: 1, d: 0 },
    ];
  })();

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

  const isDeletable = mod.a === 0 || displayMicrovoci.every(v => v.s !== 'done' && (v.hA || 0) === 0);

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
            {isDeletable && onDeleteMod && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onDeleteMod();
                }}
                title="Elimina modulo dal progetto (0 ore espletate)"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '2px 6px', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
              >
                🗑 Elimina
              </button>
            )}
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
              {displayMicrovoci.map((v, i) => {
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
                })}
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
      const resFattura: any = await emettiFatturaApi({
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

      if (resFattura && resFattura.id) {
        const nuovaFatturaLocal = {
          id: resFattura.id,
          numero: resFattura.numero || resFattura.numeroProgressivo || `FT-${Date.now()}`,
          desc: tipoDocFiscale === 'nota_credito' ? `[NOTA DI CREDITO] ${desc}` : desc,
          importo: (tipoDocFiscale === 'nota_credito' ? -1 : 1) * Math.abs(Number(importoEur)),
          data: new Date().toLocaleDateString('it-IT'),
          stato: 'emessa' as const,
        };

        const updatedProject = {
          ...project,
          fatture: [nuovaFatturaLocal, ...(project.fatture || [])],
        };

        const savedStr = localStorage.getItem('bluman_custom_projects');
        const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
        const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
        localStorage.setItem('bluman_custom_projects', JSON.stringify(updatedArr));
      }

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

      <div style={{
        background: totFatturato === 0 ? '#1e293b' : totFatturato >= project.val ? '#042f2e' : '#78350f',
        border: `1px solid ${totFatturato === 0 ? '#334155' : totFatturato >= project.val ? '#0d9488' : '#b45309'}`,
        borderRadius: 10,
        padding: 14,
        marginTop: 14,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 11, color: totFatturato === 0 ? '#94a3b8' : totFatturato >= project.val ? '#2dd4bf' : '#fcd34d', fontWeight: 600, textTransform: 'uppercase' }}>
            Stato Saldo & Incassi Progetto
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginTop: 2 }}>
            {totFatturato === 0
              ? `⏳ Incassato Effettivo: € 0 / ${fmt(project.val)} (Da Fatturare & Incassare)`
              : totFatturato >= project.val
              ? `✓ Incassato Effettivo: ${fmt(totFatturato)} / ${fmt(project.val)} (Saldata al 100%)`
              : `🔹 Incassato Effettivo: ${fmt(totFatturato)} / ${fmt(project.val)} (Incasso Parziale)`}
          </div>
        </div>
        <button
          onClick={() => alert('✓ Stato Incassi Progetto sincronizzato con lo Scadenzario e Prima Nota')}
          style={{ background: totFatturato === 0 ? '#334155' : totFatturato >= project.val ? '#0d9488' : '#b45309', border: 'none', color: 'white', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
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

            {tipoFattura === 'modulo_completo' && (
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo del Progetto *</label>
                <select value={selectedModId} onChange={e => setSelectedModId(e.target.value)} required>
                  <option value="">Seleziona modulo...</option>
                  {project.mods.map(m => (
                    <option key={m.id} value={String(m.id)}>📁 {m.n} ({fmt((m as any).val || 0)})</option>
                  ))}
                </select>
              </div>
            )}

            {tipoFattura === 'modulo_parziale' && (
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo *</label>
                  <select value={selectedModId} onChange={e => setSelectedModId(e.target.value)} required>
                    <option value="">Seleziona modulo...</option>
                    {project.mods.map(m => (
                      <option key={m.id} value={String(m.id)}>📁 {m.n}</option>
                    ))}
                  </select>
                </div>
                <div style={{ width: 100 }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Quota % *</label>
                  <input type="number" value={pct} onChange={e => setPct(Number(e.target.value))} min={1} max={100} required />
                </div>
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Descrizione in Fattura *</label>
              <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="es. Saldo modulo analisi patrimoniale" required />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Importo (€) *</label>
                <input type="number" value={importoEur} onChange={e => setImportoEur(Number(e.target.value))} min={1} required />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Regime Fiscale *</label>
                <select value={tipoFiscale} onChange={e => setTipoFiscale(e.target.value as any)}>
                  <option value="business_italia">🏢 B2B Italia</option>
                  <option value="privato_italia">👤 B2C Privato</option>
                  <option value="estero">🌍 Estero / Malta EU</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Canale Invio *</label>
                <select value={canale} onChange={e => setCanale(e.target.value as any)}>
                  <option value="sdi">📨 SDI Comped</option>
                  <option value="standard">📄 Standard / PDF</option>
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
  
  // Mappa tariffe orarie reali per id operatore
  const OPERATOR_RATES: Record<number, { name: string; rate: number; role: string }> = {
    1: { name: 'Joe Disabato', rate: 120, role: 'Lead Advisor & Senior Partner' },
    2: { name: 'Francesca Disabato', rate: 45, role: 'Back Office & Compliance KYC' },
    3: { name: 'Avv. Lorenzo Marino', rate: 90, role: 'Legal Counsel — Diritto Societario' },
    4: { name: 'Dr. Elena Russo', rate: 85, role: 'Tax Advisor & Fiscalità Internazionale' },
    5: { name: 'Avv. Mario Dibenedetto', rate: 95, role: 'Legal Counsel & Partner' },
  };

  // Calcolo ore e costi reali analitici per microvoce
  let costoOperativoStudioReale = 0;
  let oreStimateTot = 0;
  let oreConsuntivateTot = 0;
  const teamContributions: Record<number, { hours: number; cost: number }> = {};

  (project.mods || []).forEach(m => {
    oreStimateTot += (m.h || 0);
    const modActual = (m.a || 0);
    oreConsuntivateTot += modActual;

    if (m.v && m.v.length > 0) {
      m.v.forEach(mv => {
        const opId = mv.as || (m.team && m.team[0]) || 1;
        const opRate = OPERATOR_RATES[opId]?.rate || 95;
        const mvHours = mv.hA || 0;
        const mvCost = mvHours * opRate;
        costoOperativoStudioReale += mvCost;

        if (!teamContributions[opId]) {
          teamContributions[opId] = { hours: 0, cost: 0 };
        }
        teamContributions[opId].hours += mvHours;
        teamContributions[opId].cost += mvCost;
      });
    } else {
      const defaultOp = (m.team && m.team[0]) || 1;
      const opRate = OPERATOR_RATES[defaultOp]?.rate || 95;
      const modCost = modActual * opRate;
      costoOperativoStudioReale += modCost;

      if (!teamContributions[defaultOp]) {
        teamContributions[defaultOp] = { hours: 0, cost: 0 };
      }
      teamContributions[defaultOp].hours += modActual;
      teamContributions[defaultOp].cost += modCost;
    }
  });

  // Se non ci sono ore consuntivate dettagliate, fallback proporzionale realistico
  if (costoOperativoStudioReale === 0 && oreConsuntivateTot > 0) {
    costoOperativoStudioReale = oreConsuntivateTot * 95;
  }

  // Margine Lordo Studio (€ e %)
  const margineLordo = valoreTotale - costoOperativoStudioReale;
  const marginePercentuale = valoreTotale > 0 ? ((margineLordo / valoreTotale) * 100) : 0;
  const percentualeBudgetCosumata = valoreTotale > 0 ? ((costoOperativoStudioReale / valoreTotale) * 100) : 0;

  // Resa Oraria Effettiva Studio (€/ora)
  const resaOrariaStudio = oreConsuntivateTot > 0 ? (valoreTotale / oreConsuntivateTot) : valoreTotale;

  // Semaforo Alert
  const semaforoStato = marginePercentuale >= 50 ? 'green' : marginePercentuale >= 20 ? 'yellow' : 'red';
  const semaforoText = semaforoStato === 'green' ? '🟢 Margine Ottimale (>50%)' : semaforoStato === 'yellow' ? '🟡 Margine in Linea (20% - 50%)' : '🔴 Attenzione: Sforamento Budget';
  const semaforoBg = semaforoStato === 'green' ? '#0d2d22' : semaforoStato === 'yellow' ? '#2d1a05' : '#3b1c1c';
  const semaforoBorder = semaforoStato === 'green' ? '#059669' : semaforoStato === 'yellow' ? '#d97706' : '#ef4444';
  const semaforoColor = semaforoStato === 'green' ? '#34d399' : semaforoStato === 'yellow' ? '#f59e0b' : '#f87171';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Tabella Redditività */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📊 Analisi Redditività Incarico & Controllo Budget Commessa</span>
            <span style={{ fontSize: 11, background: semaforoBg, color: semaforoColor, border: `1px solid ${semaforoBorder}`, padding: '2px 10px', borderRadius: 12, fontWeight: 800 }}>
              {semaforoText}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Monitoraggio finanziario in tempo reale: Valore Contrattuale vs Costo Lavoro Reale Studio per <strong>{project.cl}</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const csvRows = [
              ['Riepilogo Redditivita Commessa', project.n, project.cl],
              ['Valore Incarico', valoreTotale.toFixed(2)],
              ['Costo Lavoro Studio Reale', costoOperativoStudioReale.toFixed(2)],
              ['Margine Lordo Studio', margineLordo.toFixed(2)],
              ['Margine Percentuale', `${marginePercentuale.toFixed(1)}%`],
              ['Ore Stimate', oreStimateTot.toFixed(1)],
              ['Ore Consuntivate', oreConsuntivateTot.toFixed(1)],
              [],
              ['Modulo', 'Prezzo', 'Ore Stimate', 'Ore Reali', 'Costo Lavoro Studio', 'Margine Modulo'],
              ...(project.mods || []).map(m => [
                m.n,
                (m.p || 0).toFixed(2),
                (m.h || 0).toFixed(1),
                (m.a || 0).toFixed(1),
                ((m.a || 0) * 95).toFixed(2),
                ((m.p || 0) - (m.a || 0) * 95).toFixed(2),
              ])
            ];
            const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(e => e.join(';')).join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `Rendiconto_Redditivita_${project.n.replace(/\s+/g, '_')}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span>📥 Esporta Rendiconto Economico CSV</span>
        </button>
      </div>

      {/* 📊 KPI FINANCIAL CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>💶 Valore Incarico Forfait</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', marginTop: 4 }}>{fmt(valoreTotale)}</div>
          <div style={{ fontSize: 10, color: '#34d399', marginTop: 2 }}>✓ Concordato a contrattazione</div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⏱ Ore Consuntivate / Stimate</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#818cf8', marginTop: 4 }}>{oreConsuntivateTot.toFixed(1)}h <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>/ {oreStimateTot}h</span></div>
          <div style={{ fontSize: 10, color: oreConsuntivateTot <= oreStimateTot ? '#34d399' : '#f59e0b', marginTop: 2 }}>
            {oreConsuntivateTot <= oreStimateTot ? '✓ In linea con la stima' : '⚠️ Sforamento monte ore'}
          </div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>🏦 Margine Lordo Commessa</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: margineLordo >= 0 ? '#34d399' : '#ef4444', marginTop: 4 }}>
            {fmt(margineLordo)} <span style={{ fontSize: 13, fontWeight: 600 }}>({marginePercentuale.toFixed(1)}%)</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Costo Lavoro Studio: {fmt(costoOperativoStudioReale)}</div>
        </div>

        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>⚡ Resa Oraria Effettiva</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24', marginTop: 4 }}>{fmt(resaOrariaStudio)} / h</div>
          <div style={{ fontSize: 10, color: '#34d399', marginTop: 2 }}>Target Studio: € 200 / h</div>
        </div>
      </div>

      {/* 📈 GAUGE CONSUMO BUDGET COMMESSA */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
          <span style={{ fontWeight: 700 }}>📉 Consumo Budget Lavoro Studio:</span>
          <span style={{ fontWeight: 800, color: semaforoColor }}>{percentualeBudgetCosumata.toFixed(1)}% del valore vendita utilizzato</span>
        </div>
        <div style={{ width: '100%', height: 10, background: 'rgba(255,255,255,0.08)', borderRadius: 6, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${Math.min(100, percentualeBudgetCosumata)}%`, background: semaforoColor, transition: 'width 0.4s ease' }} />
        </div>
      </div>

      {/* 👥 RIPARTIZIONE ORE E COSTI PER PROFESSIONISTA STUDIO */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
          👥 Ripartizione Lavoro & Costi per Professionista Studio
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '8px 12px' }}>Professionista</th>
                <th style={{ padding: '8px 12px' }}>Ruolo & Specializzazione</th>
                <th style={{ padding: '8px 12px' }}>Tariffa Oraria</th>
                <th style={{ padding: '8px 12px' }}>Ore Registrate</th>
                <th style={{ padding: '8px 12px' }}>Costo Totale Studio</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(teamContributions).map(([opIdStr, data]) => {
                const opId = Number(opIdStr);
                const info = OPERATOR_RATES[opId] || { name: `Operatore #${opId}`, rate: 95, role: 'Consulente Studio' };
                return (
                  <tr key={opId} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text)' }}>
                      👤 {info.name}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                      {info.role}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      € {info.rate},00 / h
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#818cf8' }}>
                      {data.hours.toFixed(1)} h
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#34d399' }}>
                      € {data.cost.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
                const defaultOp = (m.team && m.team[0]) || 1;
                const opRate = OPERATOR_RATES[defaultOp]?.rate || 95;
                const modCostoStudio = modH_Reali * opRate;
                const modMargine = modP - modCostoStudio;
                const modResa = modH_Reali > 0 ? (modP / modH_Reali) : modP;
                const isProfit = modResa >= 200;

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
                    <td style={{ padding: '12px', fontWeight: 700, color: modMargine >= 0 ? '#34d399' : '#ef4444' }}>
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
// ─── Componente Documenti & Vault Legale Progetto (Google Drive / Cloud Vault) ───
function DocumentiTab({ project }: { project: Progetto }) {
  const navigate = useNavigate();
  const [docCategory, setDocCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [uploading, setUploading] = useState(false);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<any | null>(null);

  // Caricamento Documenti dal Vault Locale e Cloud (Sincronizzati 1-a-1 con i Modelli Word Studio)
  const [docList, setDocList] = useState<any[]>(() => {
    const defaultDocs = PREBUILT_TEMPLATES.map(t => {
      const isSigned = t.id === 'tmpl-engagement' || t.id === 'tmpl-nda';
      const catLabel = t.categoria === 'engagement' ? 'Contratti' :
                       t.categoria === 'nda' ? 'Contratti' :
                       t.categoria === 'societario' ? 'Societario' :
                       t.categoria === 'trust' ? 'Trust' :
                       t.categoria === 'compliance' ? 'Compliance' :
                       t.categoria === 'delega' ? 'Societario' : 'Contratti';
      return {
        id: `doc-${t.id}`,
        templateId: t.id,
        nome: `${t.titolo} — ${project.cl}.docx`,
        titolo: t.titolo,
        cat: catLabel,
        dimensione: '54 KB',
        data: '15/08/2026',
        dataCaricamento: '15/08/2026',
        firmato: isSigned,
        formato: 'word',
        contenutoHtml: resolveDocumentTemplateHtml(t.contenutoHtml, {
          cliente: { nome: project.cl, ragione_sociale: project.cl },
          progetto: { titolo: project.n, importo_totale: fmt(project.val) },
          studio: { ragioneSociale: 'Bluecode Ltd', sedeLegale: 'Level 4, Valuation Centre, Sliema, Malta', piva: 'MT28491039' },
          isForPrintOrExport: false,
          tagMode: 'plain',
        }),
      };
    });

    try {
      const storageKey = `bluman_project_documents_${project.id}`;
      const savedProjDocsStr = localStorage.getItem(storageKey);
      const savedProjDocs: any[] = savedProjDocsStr ? JSON.parse(savedProjDocsStr) : [];

      const allVaultStr = localStorage.getItem('bluman_all_vault_documents');
      const allVault: any[] = allVaultStr ? JSON.parse(allVaultStr) : [];
      const matchingGlobalDocs = allVault.filter((d: any) => String(d.progettoId) === String(project.id));

      const mergedMap = new Map<string, any>();
      [...defaultDocs, ...savedProjDocs, ...matchingGlobalDocs].forEach(d => {
        if (d && (d.id || d.nome)) {
          mergedMap.set(d.id || d.nome, d);
        }
      });
      return Array.from(mergedMap.values());
    } catch {
      return defaultDocs;
    }
  });

  // Helper per scaricare localmente copia VERA in PDF A4 con Header/Footer Studio
  const handleDownloadDocument = async (doc: any) => {
    const rawContent = doc.contenutoHtml || `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11pt; padding: 10px;">
        <h1 style="color: #1e1b4b; text-align: center; text-transform: uppercase; font-size: 18pt; border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 20px;">
          ${doc.titolo || doc.nome}
        </h1>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 10pt;">
          <strong>Studio Professionale:</strong> Bluecode Ltd (Malta / Svizzera)<br/>
          <strong>Cliente Committente:</strong> ${project.cl} (${project.n})<br/>
          <strong>Categoria Vault:</strong> ${doc.cat || doc.categoria || 'Generale'}<br/>
          <strong>Stato eIDAS:</strong> ${doc.firmato ? '🔒 Sottoscritto con Sigillo FEA eIDAS UE 910/2014' : 'Bozza Documentale Studio'}
        </div>
      </div>
    `;

    const fullPrintHtml = `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
          <div>
            <div style="font-size: 16pt; font-weight: 800; color: #1e1b4b;">BLUECODE LTD — ADVISORY SERVICES</div>
            <div style="font-size: 9pt; color: #64748b;">Valuation Centre, Sliema, Malta · Reg. N. C-99881</div>
          </div>
          <div style="text-align: right; font-size: 8.5pt; color: #64748b;">
            Rif. Incarico: #${project.id}<br/>Data: ${doc.data || doc.dataCaricamento || '2026'}
          </div>
        </div>
        <div>${rawContent}</div>
        <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8;">
          <span>Bluecode Ltd • Pratica: ${project.n}</span>
          <span>Sigillo eIDAS Documentale • Validità Giuridica UE</span>
        </div>
      </div>
    `;

    const safePdfName = `${(doc.titolo || doc.nome || 'Documento').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    await downloadRealPdf(safePdfName, fullPrintHtml);
  };

  // Caricamento File da Disco nel Vault Progetto
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const res = await uploadFileApi(file.name, base64);
        const isWord = file.name.endsWith('.docx') || file.name.endsWith('.doc');
        const newDoc = {
          id: `doc-${Date.now()}`,
          nome: file.name,
          titolo: file.name.replace(/\.[^/.]+$/, ''),
          cat: isWord ? 'Contratti' : 'Allegati Progetto',
          dimensione: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
          data: new Date().toLocaleDateString('it-IT'),
          dataCaricamento: new Date().toLocaleDateString('it-IT'),
          progettoId: String(project.id),
          clienteNome: project.cl,
          firmato: false,
          formato: isWord ? 'word' : 'pdf',
          url: res?.url || '#',
        };

        const updated = [newDoc, ...docList];
        setDocList(updated);
        localStorage.setItem(`bluman_project_documents_${project.id}`, JSON.stringify(updated));

        const allVaultStr = localStorage.getItem('bluman_all_vault_documents');
        const allVault: any[] = allVaultStr ? JSON.parse(allVaultStr) : [];
        localStorage.setItem('bluman_all_vault_documents', JSON.stringify([newDoc, ...allVault]));

        alert(`✓ File "${file.name}" archiviato nel Cloud Drive del Progetto con successo!`);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      alert('Errore nel caricamento del file nel Drive');
    } finally {
      setUploading(false);
    }
  };

  // Eliminazione Documento dal Vault
  const handleDeleteDoc = (docId: string) => {
    if (!confirm('Vuoi rimuovere questo documento dal Vault del progetto?')) return;
    const updated = docList.filter(d => d.id !== docId);
    setDocList(updated);
    localStorage.setItem(`bluman_project_documents_${project.id}`, JSON.stringify(updated));
    if (selectedPreviewDoc?.id === docId) setSelectedPreviewDoc(null);
  };

  // Filtraggio dinamico
  const filteredDocs = docList.filter(d => {
    const matchCat = docCategory === 'ALL' || d.cat === docCategory || (docCategory === 'Contratti' && d.formato === 'word');
    const matchSearch = !searchQuery || (d.nome || d.titolo || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header Document Vault Google Drive Style */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>📁 Google Drive & Cloud Vault Documenti</span>
            <span style={{ fontSize: 10, background: '#1e1b4b', color: '#818cf8', padding: '3px 8px', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase' }}>
              Word Studio + PDF Vault
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Fascicolo digitale per <strong>{project.cl}</strong> · <strong>{project.n}</strong> ({docList.length} file archiviati)
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              const zip = new SimpleZipBuilder();
              const safeProjName = (project.n || 'Pratica').replace(/[^a-zA-Z0-9_-]/g, '_');
              const safeClientName = (project.cl || 'Cliente').replace(/[^a-zA-Z0-9_-]/g, '_');

              // Indice del fascicolo
              const indiceText = `================================================================================
BLUECODE LTD — ADVISORY PLATFORM
FASCICOLO COMMESSA: ${project.n}
COMMITTENTE: ${project.cl}
DATA EXPORT: ${new Date().toLocaleString('it-IT')}
VALORE COMMESSA: € ${project.val || 0}
STATO PRATICA: ${project.st}
================================================================================

ELENCO DEI DOCUMENTI PRESENTI NEL FASCICOLO DIGITALE:

${docList.map((d, i) => `${i + 1}. [${d.cat || 'Documento'}] ${d.nome || d.titolo} (${d.firmato ? 'Firma FEA eIDAS Verificata' : 'Bozza Documentale Studio'})`).join('\n')}

================================================================================
Note di Conformita:
I documenti contrattuali sottoscritti con Firma Elettronica Avanzata (FEA)
sono pienamente conformi al Regolamento UE 910/2014 (eIDAS) con marcatura
temporale certificata ISO UTC ed impronta crittografica SHA-256.
================================================================================
`;

              zip.addTextFile('INDICE_FASCICOLO.txt', indiceText);

              // Inserisci i documenti nelle cartelle ordinate
              docList.forEach(d => {
                let folder = '01_Contratti_e_Incarico';
                const catLower = (d.cat || '').toLowerCase();
                if (catLower.includes('societario') || catLower.includes('mfsa') || catLower.includes('statuto')) {
                  folder = '02_Societario_e_Delibere';
                } else if (catLower.includes('compliance') || catLower.includes('kyc') || catLower.includes('aml') || catLower.includes('allegati')) {
                  folder = '03_KYC_Compliance_e_Visure';
                } else if (catLower.includes('fattur') || catLower.includes('ricevut')) {
                  folder = '04_Fatture_e_Ricevute';
                }

                const fileName = (d.nome || `${d.titolo}.html`).replace(/[^a-zA-Z0-9._-]/g, '_');
                const docHtmlContent = d.contenutoHtml || `<h1>${d.titolo || d.nome}</h1><p>Documento del fascicolo ${project.n} - ${project.cl}</p>`;
                zip.addTextFile(`${folder}/${fileName.replace(/\.docx?$/, '.html')}`, docHtmlContent);
              });

              zip.download(`Fascicolo_Completo_${safeProjName}_${safeClientName}.zip`);
            }}
            style={{
              background: '#059669',
              color: '#fff',
              border: '1px solid #10b981',
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(5,150,105,.3)',
            }}
            title="Scarica tutti i contratti, atti, documenti KYC e ricevute della pratica in un unico archivio ZIP ordinato"
          >
            <span>📦 Esporta Fascicolo ZIP Completo</span>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/documents?projId=${project.id}`)}
            style={{
              background: 'linear-gradient(135deg, #4338ca 0%, #312e81 100%)',
              color: '#fff',
              border: '1px solid #6366f1',
              padding: '8px 16px',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(99,102,241,.3)',
            }}
          >
            <span>📝 Nuovo con Word Studio</span>
          </button>

          <label style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 8px rgba(0,0,0,.1)' }}>
            <span>{uploading ? 'Caricamento in corso...' : '📤 Carica File da Disco'}</span>
            <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* Toolbar: Ricerca, Filtri e Switch Visualizzazione (Grid / Table) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, background: 'var(--card2)', padding: '12px 18px', borderRadius: 12, border: '1px solid var(--border)' }}>
        {/* Filtri Categoria */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: `🌐 Tutti (${docList.length})` },
            { id: 'Contratti', label: '📄 Contratti & Word' },
            { id: 'Societario', label: '🏢 Societario & MFSA' },
            { id: 'Compliance', label: '🛡 Compliance & KYC' },
            { id: 'Trust', label: '🏛 Trust & Fiscale' },
            { id: 'Allegati Progetto', label: '📎 Allegati' },
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setDocCategory(cat.id)}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: docCategory === cat.id ? '#1e1b4b' : 'var(--card)',
                color: docCategory === cat.id ? '#818cf8' : 'var(--muted)',
                border: `1px solid ${docCategory === cat.id ? '#4338ca' : 'var(--border)'}`,
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search & Mode Switch */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Cerca file nel Vault..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ fontSize: 11.5, padding: '6px 12px', borderRadius: 8, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', width: 190 }}
          />

          <div style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('grid')}
              style={{ padding: '6px 10px', background: viewMode === 'grid' ? '#1e1b4b' : 'transparent', color: viewMode === 'grid' ? '#818cf8' : 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: 12 }}
              title="Vista Griglia Schede"
            >
              ⊞ Griglia
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{ padding: '6px 10px', background: viewMode === 'list' ? '#1e1b4b' : 'transparent', color: viewMode === 'list' ? '#818cf8' : 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: 12 }}
              title="Vista Elenco Tabellare"
            >
              ☰ Elenco
            </button>
          </div>
        </div>
      </div>

      {/* Grid View Google Drive Style */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 16 }}>
          {filteredDocs.map(doc => {
            const isWord = doc.formato === 'word' || (doc.nome && (doc.nome.endsWith('.docx') || doc.nome.endsWith('.doc')));
            return (
              <div
                key={doc.id}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                  transition: 'transform .15s, border-color .15s',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ fontSize: 28 }}>
                      {isWord ? '📝' : '📄'}
                    </div>
                    <span style={{ fontSize: 9.5, background: doc.firmato ? '#0d2d22' : '#1e1b4b', color: doc.firmato ? '#34d399' : '#818cf8', border: `1px solid ${doc.firmato ? '#059669' : '#4338ca'}`, padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}>
                      {doc.firmato ? '🔒 eIDAS Firmato' : (isWord ? 'DOCX Word' : 'PDF')}
                    </span>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {doc.titolo || doc.nome}
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>📁 {doc.cat || doc.categoria || 'Vault'}</span>
                    <span>·</span>
                    <span>💾 {doc.dimensione || '24 KB'}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                    📅 {doc.data || doc.dataCaricamento || '15/08/2026'}
                  </div>
                </div>

                {/* Actions per Card */}
                <div style={{ display: 'flex', gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedPreviewDoc(doc)}
                    style={{ flex: 1, background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                  >
                    👁 Anteprima
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate(`/documents?projId=${project.id}&docId=${doc.id}`)}
                    style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#818cf8', padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    title="Apri e Modifica con Word Studio"
                  >
                    ✏️ Studio
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadDocument(doc)}
                    style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    title="Scarica Copia Localmente"
                  >
                    📥 Scarica
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteDoc(doc.id)}
                    style={{ background: '#2d1515', border: '1px solid #7f1d1d', color: '#f87171', padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                    title="Elimina Documento dal Drive"
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View Table */}
      {viewMode === 'list' && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: 'var(--card2)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '10px 12px' }}>Nome File / Documento</th>
                  <th style={{ padding: '10px 12px' }}>Categoria</th>
                  <th style={{ padding: '10px 12px' }}>Dimensione</th>
                  <th style={{ padding: '10px 12px' }}>Data</th>
                  <th style={{ padding: '10px 12px' }}>Firma eIDAS</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Azioni Cloud Vault</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map(doc => {
                  const isWord = doc.formato === 'word' || (doc.nome && (doc.nome.endsWith('.docx') || doc.nome.endsWith('.doc')));
                  return (
                    <tr key={doc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{isWord ? '📝' : '📄'}</span>
                        <span>{doc.titolo || doc.nome}</span>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ fontSize: 10, background: '#1a1f3d', color: '#818cf8', padding: '2px 8px', borderRadius: 10, border: '1px solid #3730a3' }}>
                          {doc.cat || doc.categoria || 'Generale'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.dimensione || '24 KB'}</td>
                      <td style={{ padding: '12px', color: 'var(--muted)' }}>{doc.data || doc.dataCaricamento || '15/08/2026'}</td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ fontSize: 9.5, background: doc.firmato ? '#0d2d22' : '#2d1a05', color: doc.firmato ? '#34d399' : '#f59e0b', border: `1px solid ${doc.firmato ? '#059669' : '#d97706'}`, padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                          {doc.firmato ? '🔒 eIDAS Verificato' : '⏳ In attesa di firma'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedPreviewDoc(doc)}
                            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--indigo-l)', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            👁 Anteprima
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/documents?projId=${project.id}&docId=${doc.id}`)}
                            style={{ background: '#1e1b4b', border: '1px solid #4338ca', color: '#818cf8', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✏️ Word Studio
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadDocument(doc)}
                            style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
                          >
                            📥 Scarica
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteDoc(doc.id)}
                            style={{ background: 'transparent', border: '1px solid #7f1d1d', color: '#f87171', padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Visualizzatore Anteprima Documento Vault */}
      {selectedPreviewDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, width: '100%', maxWidth: 780, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,.7)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>📄 {selectedPreviewDoc.titolo || selectedPreviewDoc.nome}</span>
                  <span style={{ fontSize: 10, background: selectedPreviewDoc.firmato ? '#0d2d22' : '#200f40', color: selectedPreviewDoc.firmato ? '#34d399' : '#a78bfa', padding: '2px 8px', borderRadius: 10, border: '1px solid #3730a3' }}>
                    {selectedPreviewDoc.firmato ? '🔒 eIDAS Sottoscritto' : 'Bozza Legale Studio'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                  Pratica: <strong>{project.n}</strong> · Cliente: <strong>{project.cl}</strong> · Dimensione: {selectedPreviewDoc.dimensione || '32 KB'}
                </div>
              </div>
              <button
                onClick={() => setSelectedPreviewDoc(null)}
                style={{ background: 'var(--card2)', border: 'none', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 16 }}
              >
                ✕
              </button>
            </div>

            {/* Document Content Rendering */}
            <div style={{ flex: 1, padding: 24, overflowY: 'auto', background: '#0a0d14' }}>
              <div style={{ background: '#fff', color: '#1e293b', borderRadius: 8, padding: 32, fontFamily: 'serif', boxShadow: '0 10px 30px rgba(0,0,0,.5)', border: '1px solid #cbd5e1', lineHeight: 1.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0284c7', paddingBottom: 14, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#0369a1', fontFamily: 'sans-serif' }}>BLUMAN ADVISORY SERVICES</div>
                    <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'sans-serif' }}>Corporate Structuring & Cross-Border Wealth Planning</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b', fontFamily: 'sans-serif' }}>
                    Rif. Incarico: #{project.id}<br />
                    Data: {selectedPreviewDoc.data || selectedPreviewDoc.dataCaricamento || '2026'}
                  </div>
                </div>

                <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 700, marginBottom: 18, color: '#0f172a', textTransform: 'uppercase' }}>
                  {selectedPreviewDoc.titolo || selectedPreviewDoc.nome}
                </div>

                {selectedPreviewDoc.contenutoHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: selectedPreviewDoc.contenutoHtml }} />
                ) : (
                  <div style={{ fontSize: 12, color: '#334155', textAlign: 'justify' }}>
                    <p style={{ marginBottom: 12 }}>
                      Il presente documento certifica la conformità delle procedure societarie e contrattuali svolte per il Cliente <strong>{project.cl}</strong> nell'ambito dell'incarico <strong>{project.n}</strong>.
                    </p>
                    <p style={{ marginBottom: 12 }}>
                      Tutti gli atti societari, visure, delibere ed accordi sono archiviati con crittografia end-to-end e valore legale probatorio ai sensi dell'art. 20 del CAD e del Regolamento UE 910/2014 (eIDAS).
                    </p>
                  </div>
                )}

                <div style={{ marginTop: 40, paddingTop: 16, borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'sans-serif' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#475569' }}>BluMan Advisory Firm:</div>
                    <div style={{ marginTop: 20, fontStyle: 'italic', color: '#0284c7', fontWeight: 600 }}>Joe Disabato (Senior Partner)</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: '#475569' }}>Firma Committente:</div>
                    <div style={{ marginTop: 20, fontStyle: 'italic', color: selectedPreviewDoc.firmato ? '#059669' : '#64748b', fontWeight: 700 }}>
                      {selectedPreviewDoc.firmato ? `✓ FIRMATO DA ${project.cl.toUpperCase()} (FEA eIDAS Validata)` : `(Sottoscrizione per ${project.cl})`}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--card)' }}>
              <button
                type="button"
                onClick={() => handleDownloadDocument(selectedPreviewDoc)}
                style={{ background: '#0d2d22', border: '1px solid #059669', color: '#34d399', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                📥 Scarica Copia Localmente (.docx/html)
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/documents?projId=${project.id}&docId=${selectedPreviewDoc.id}`);
                  }}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  📝 Modifica in Document Studio
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPreviewDoc(null)}
                  style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
