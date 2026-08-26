import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { CatBadge } from '../components/ui/CatBadge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { AvatarGroup, Avatar } from '../components/ui/Avatar';
import { PassaggioModal } from '../components/PassaggioModal';
import { fmt, progressColor, getFormattedLogoUrl } from '../utils';
import { downloadRealPdf } from '../utils/pdfGenerator';
import { SimpleZipBuilder } from '../utils/zipBuilder';
import { PREBUILT_TEMPLATES, resolveDocumentTemplateHtml } from '../utils/documentTemplates';
import { ComunicazioniTab } from '../components/ComunicazioniTab';
import { AssignOperatorModal } from '../components/AssignOperatorModal';
import { CalendarPreviewModal } from '../components/CalendarPreviewModal';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { fetchProgettoDettaglio, emettiFatturaApi, consuntivaMicrovoceApi, assegnaAccessoProgettoApi, salvaProgettoDettaglioApi, archiviaProgettoApi, eliminaProgettoApi, eliminaModuloApi, fetchModuliLibreria, fetchArticoli, inviaComunicazioneApi, ricalcolaProgettoApi, creaPreventivoEAccettaApi, listaDocumentiProgetto, salvaDocumentoApi, eliminaDocumentoApi, richiesteAddendumStudioApi, aggiornaStatoAddendumApi } from '../api/client';
import type { RichiestaAddendum } from '../api/client';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Progetto, ModuloProgetto, MicroVoce, CategoriaModulo, StatoProgetto, StatoModulo, Cliente } from '../types';
import styles from './ProjectDetail.module.css';

type Tab = 'moduli' | 'grafo' | 'fatturazione' | 'redditivita' | 'storico' | 'comunicazioni' | 'documenti' | 'calendario';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [currentClient, setCurrentClient] = useState<Cliente | null>(null);
  const [project, setProject] = useState<Progetto | null>(() => {
    const isBluecode = getCurrentTenantId() === BLUECODE_TENANT_ID;
    if (isBluecode) {
      // Bluecode parte da database: nessun progetto precaricato in memoria.
      return null;
    }
    const localStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
    if (localStr) {
      try {
        const list = JSON.parse(localStr);
        return list.find((p: any) => String(p.id) === String(id)) || null;
      } catch {}
    }
    return null;
  });
  const [loading, setLoading] = useState(true);

  /**
   * Motivo dell'ultimo salvataggio non riuscito, mostrato in cima alla pagina.
   *
   * Ogni salvataggio verso il database finiva con `.catch(() => {})`: l'operatore assegnava una
   * risorsa, chiudeva una micro-voce, correggeva il valore dell'incarico, vedeva la modifica
   * comparire (arrivava da `localStorage`) e non sapeva che a database non era arrivata niente.
   * Da lì nasceva la segnalazione «il cliente non vede i moduli inseriti dall'operatore»: il
   * portale legge il database, e nel database quelle modifiche non c'erano.
   */
  const [erroreSalvataggio, setErroreSalvataggio] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('moduli');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [procV, setProcV] = useState<{ mid: number; vidx: number } | null>(null);
  const [accessiModalOpen, setAccessiModalOpen] = useState(false);
  const { team: teamList } = useTeamMembers();
  const [selectedUser, setSelectedUser] = useState('');
  // §Blocco 7 (fix) — la selezione viaggia sull'id reale del membro (dbId),
  // non sul nome: è quello che l'API di assegnazione accessi si aspetta.
  const idMembro = (u: (typeof teamList)[number]) => u.dbId || String(u.id);
  // Il primo collaboratore disponibile viene preselezionato solo quando la squadra
  // arriva (dal database): prima c'era un nome fisso preso dall'elenco mock.
  useEffect(() => {
    if (!selectedUser && teamList.length > 0) {
      setSelectedUser(idMembro(teamList[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamList]);
  const [livello, setLivello] = useState('write');
  const [assignModalTarget, setAssignModalTarget] = useState<{
    modId: number;
    mvIdx?: number;
    name: string;
    currentAssigned: number[];
    /** Categoria del modulo: alimenta il suggerimento operatore §6.2 (specializzazione + carico). */
    categoria?: string;
  } | null>(null);

  const [calendarModalTarget, setCalendarModalTarget] = useState<{
    modId: number;
    mvIdx?: number;
    name: string;
    currentDueDate?: string;
    operatorName?: string;
    operatorId?: number;
  } | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [ricalcolando, setRicalcolando] = useState(false);

  /**
   * Ruolo dell'utente in sessione, per mostrare il ricalcolo dell'avanzamento (§16) solo a chi
   * gestisce lo studio. È un filtro di interfaccia, non la difesa: `POST /progetti/:id/ricalcola`
   * autorizza per conto proprio e RLS confina la scrittura al tenant. Senza `bluman_user` in
   * sessione non si assume nessun ruolo: il pulsante non compare.
   */
  const ruoloSessione: string = (() => {
    try {
      const raw = localStorage.getItem('bluman_user');
      return raw ? (JSON.parse(raw).ruolo || '') : '';
    } catch {
      return '';
    }
  })();
  const puoRicalcolare = ruoloSessione === 'super_admin' || ruoloSessione === 'advisor';

  /**
   * Manda a database il progetto modificato e riporta l'esito.
   *
   * Il server risponde con quante righe ha aggiornato e quali non ha potuto aggiornare: se il
   * corpo conteneva moduli e nessuno è finito a database, il salvataggio non è riuscito anche se
   * la risposta è un 200, e va detto. Il caso tipico è un progetto che esiste solo in questo
   * browser perché è stato creato mentre la sessione era scaduta.
   */
  const salvaSuDatabase = async (aggiornato: Progetto) => {
    try {
      const esito: any = await salvaProgettoDettaglioApi(String(aggiornato.id), aggiornato);
      const moduliInviati = (aggiornato.mods || []).length;

      if (moduliInviati > 0 && esito && esito.moduliSalvati === 0 && esito.microvociSalvate === 0) {
        setErroreSalvataggio(
          'Il database non ha registrato nessuna modifica: i moduli di questo progetto non esistono a database. ' +
            'Quello che vedi è la copia locale di questo browser, e il cliente dal portale non la vede. ' +
            (esito.nonSalvate?.length ? `Dettaglio: ${esito.nonSalvate.join('; ')}.` : ''),
        );
        return false;
      }

      if (esito?.nonSalvate?.length) {
        setErroreSalvataggio(`Salvato in parte. Non registrato a database: ${esito.nonSalvate.join('; ')}.`);
        return false;
      }

      setErroreSalvataggio(null);
      return true;
    } catch (err: any) {
      setErroreSalvataggio(err?.message || 'Salvataggio su database non riuscito.');
      return false;
    }
  };

  const handleSaveCalendarEvent = (
    date: string,
    time: string,
    operatorId: number,
    typeIcon: string,
    priority: string,
    sendEmail: boolean,
    notes: string,
    locationUrl?: string
  ) => {
    if (!project || !calendarModalTarget) return;

    const newMods = project.mods.map(m => {
      if (m.id === calendarModalTarget.modId) {
        if (calendarModalTarget.mvIdx !== undefined) {
          const newV = m.v.map((mv, idx) => {
            if (idx === calendarModalTarget.mvIdx) {
              return { ...mv, due: date, as: operatorId };
            }
            return mv;
          });
          return { ...m, v: newV };
        }
      }
      return m;
    });

    const updatedProject = { ...project, mods: newMods };
    setProject(updatedProject);

    const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));

    const eventsStr = localStorage.getItem(getTenantStorageKey('bluman_calendar_events'));
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
    localStorage.setItem(getTenantStorageKey('bluman_calendar_events'), JSON.stringify([newEvent, ...eventsArr]));

    void salvaSuDatabase(updatedProject);
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

    const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));

    void salvaSuDatabase(updatedProject);
    assegnaAccessoProgettoApi(String(project.id), `usr-0${operatorId}`, roleLevel).catch(() => {});
  };

  const [rawDbProject, setRawDbProject] = useState<any>(null);

  const loadDetail = async () => {
    setLoading(true);
    if (id) {
      const localStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
      const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
      const localSavedProj = localProjs.find(p => String(p.id) === String(id));

      const dbRes = await fetchProgettoDettaglio(id);
      if (dbRes && dbRes.id) {
        setRawDbProject(dbRes);
        if (dbRes.cliente) {
          setCurrentClient(dbRes.cliente);
        }

        // §16 — l'avanzamento (stato e percentuali, per progetto e per modulo) arriva calcolato
        // dal backend: qui si legge e non si ricalcola. Un modulo senza micro-voci a database
        // risulta 0% anche se sotto vengono mostrate micro-voci di libreria: la percentuale
        // segue le ore registrate, non quelle che il modello di riferimento prevederebbe.
        const av = dbRes.avanzamento;
        const avModuli = new Map<string, any>((av?.moduli || []).map((m: any) => [m.id, m]));

        let finalMods: ModuloProgetto[] = (dbRes.moduli || []).map((m: any, mIdx: number): ModuloProgetto => {
          const localMod = localSavedProj?.mods?.find((lm: any) => lm.n.toLowerCase() === (m.nome || '').toLowerCase() || lm.id === (mIdx + 100));

          let microvociList: MicroVoce[] = (m.microvoci || []).map((mv: any, vIdx: number): MicroVoce => {
            let savedNotes = mv.note;
            if (!savedNotes) {
              const localSaved = localStorage.getItem(getTenantStorageKey(`bluman_notes_${dbRes.id}_${m.id || mIdx + 100}_${vIdx}`));
              if (localSaved) {
                try { savedNotes = JSON.parse(localSaved); } catch {}
              }
            }
            const localMv = localMod?.v?.[vIdx];
            const assignedAs = mv.as || mv.assegnatoId || localMv?.as || 1;

            return {
              // L'identificativo di database, che serve al salvataggio per sapere quale riga
              // aggiornare. Senza questo `PUT /progetti/:id/stato-completo` deve indovinare per
              // nome, e su due micro-voci omonime non salva niente.
              dbId: mv.id,
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

          // Se il modulo non ha micro-voci a database, l'elenco resta vuoto e la pagina lo
          // dichiara. Prima qui si pescava dalla libreria mock MLIB per indice (`MLIB[mIdx %
          // MLIB.length]`, quindi un modulo qualunque) oppure si generavano tre righe generiche
          // interpolando il nome del modulo. Effetto: i due moduli reali senza micro-voci su
          // "Struttura Holding — Famiglia Ricci" risultavano istruiti, con ore preventivate che
          // nessuno aveva stimato — ed è il motivo per cui quel debito di Fase 1 non si vedeva
          // dalla UI. Le micro-voci si creano dall'ERP e finiscono a database, non qui.

          // Regola 7: se il DB e la copia locale non hanno assegnazioni, il team è vuoto.
          // Il ripiego `[1, 2]` faceva comparire due persone mai assegnate sul modulo.
          const assignedTeam = localMod?.team || m.team || [];
          const avM = avModuli.get(m.id);

          return {
            // `id` resta l'indice sintetico perché tutta la pagina confronta numeri
            // (`m.id === modId`); `dbId` è l'identificativo vero, quello che il salvataggio usa.
            id: mIdx + 100,
            dbId: m.id,
            n: m.nome,
            // Regola 7: se la categoria manca si dichiara l'assenza — il ripiego
            // 'Societario' etichettava il modulo con una pratica mai indicata.
            cat: (m.categoria as CategoriaModulo) ?? ('Senza categoria' as CategoriaModulo),
            st: avM?.stato || m.stato || 'in_progress',
            pct: avM?.percentuale ?? 0,
            // Ore e prezzo come stanno a database. I ripieghi `|| 20` ore e `: 3500` euro
            // facevano comparire un preventivo che nessuno aveva formulato: 0 è il dato vero.
            h: m.orePreventivate || microvociList.reduce((sum, v) => sum + v.hE, 0) || 0,
            a: m.oreConsuntivate || 0,
            p: m.prezzo ? m.prezzo / 100 : 0,
            team: assignedTeam,
            delay: avM ? avM.stato === 'delayed' || avM.stato === 'blocked' : false,
            // §16.1 — lo stesso segnale che la Dashboard mostra nel banner: se lì un modulo
            // risulta in allarme per ore sforate, qui deve risultarlo pure, altrimenti chi
            // apre il progetto per capire perché non trova nulla.
            rischio: Boolean(avM?.segnaleRischio),
            oreExtra: avM?.oreExtra ?? 0,
            v: microvociList,
          };
        });

        // Se i moduli DB sono vuoti, cerca un ripiego nei progetti custom salvati in locale
        if (finalMods.length === 0) {
          const localStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
          const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
          const match = localProjs.find(p => String(p.id) === String(id) || p.cl === dbRes.cliente?.nome || p.n === dbRes.nome);
          if (match && match.mods && match.mods.length > 0) {
            finalMods = match.mods;
          }
          // Nessun modulo di ripiego. Prima, quando nemmeno il locale aveva niente, la pagina
          // fabbricava un "Modulo Iniziale Incarico Advisory" da 15 ore e 3.500 € con tre
          // micro-voci, id 101, assegnato al membro 1: era il caso NORMALE, non il caso limite —
          // sette progetti su dieci non hanno moduli a database — e compariva identico su
          // progetti diversi dello stesso cliente. Un progetto senza moduli è un progetto senza
          // moduli: `finalMods` resta vuoto e il dettaglio lo dichiara.
        }

        // Nessuna "sanificazione": un modulo senza micro-voci resta senza micro-voci. Prima qui
        // ogni modulo con `v` vuoto veniva riempito pescando da MLIB — per nome, per inclusione
        // del nome e infine per indice, quindi SEMPRE qualcosa — oppure con tre righe generiche.
        // Era la rete che rendeva invisibile il caso "modulo vuoto" su tutta la pagina, anche
        // dove i moduli arrivavano davvero dal database.

        // Valore del progetto: somma dei moduli, altrimenti il valore a database. Il ripiego
        // finale `: 3500` mostrava un importo inventato su un progetto senza moduli e senza
        // valore in riga — e finiva anche nella redditività.
        const calculatedVal = finalMods.reduce((acc: number, m: any) => acc + (m.p || 0), 0) || (dbRes.valoreCentesimi ? dbRes.valoreCentesimi / 100 : 0);

        setProject({
          id: dbRes.id,
          n: dbRes.nome,
          cl: dbRes.cliente?.nome || 'Cliente Studio',
          ct: dbRes.cliente?.tipo === 'company' ? 'company' : 'individual',
          st: av?.stato || dbRes.stato || 'in_progress',
          // Prima qui c'era `dbRes.percentualeAvanzamento`, un campo che il backend non ha mai
          // prodotto: la barra di avanzamento del progetto è stata ferma a 0 da sempre.
          pct: av?.percentuale ?? 0,
          start: new Date(dbRes.createdAt).toLocaleDateString(),
          due: '30 giorni',
          val: calculatedVal,
          delay:
            (av?.moduli || []).some((m: any) => m.stato === 'delayed' || m.stato === 'blocked') ||
            Boolean(av?.segnaleRischio),
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
        const localStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
        const localProjs: Progetto[] = localStr ? JSON.parse(localStr) : [];
        let match = localProjs.find(p => String(p.id) === String(id))
                 || localProjs.find(p => String(p.id).includes(String(id)));

        if (match) {
          // Nessuna sanificazione: i moduli del progetto locale si mostrano come sono. Prima un
          // modulo con `v` vuoto veniva riempito pescando da MLIB — per nome, per inclusione del
          // nome e infine per indice, quindi sempre qualcosa — oppure con tre righe generiche.
          const modsLocali = match.mods || [];

          const modValSum = modsLocali.reduce((acc: number, m: any) => acc + (m.p || 0), 0);
          const finalVal = modValSum > 0 ? modValSum : match.val;

          const updatedMatch = {
            ...match,
            mods: modsLocali,
            val: finalVal,
          };

          setProject(updatedMatch);
          if (modsLocali.length > 0) {
            setExpanded(new Set(modsLocali.map(m => m.id)));
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
    const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));

    // Persistenza remota server DB per multi-postazione
    void salvaSuDatabase(updatedProject);

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

  const handleSavePassaggiModal = (modId: number, mvIdx: number, nextSteps: any[], nextNotes?: any[], updatedDocCount?: number) => {
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
              d: updatedDocCount !== undefined ? updatedDocCount : mv.d,
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

    const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
    localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));

    if (nextNotes) {
      localStorage.setItem(getTenantStorageKey(`bluman_notes_${project.id}_${modId}_${mvIdx}`), JSON.stringify(nextNotes));
    }

    // Persistenza remota server DB per multi-postazione
    void salvaSuDatabase(updatedProject);
  };

  return (
    <div className={styles.wrapper}>
      {/* Salvataggio non riuscito: resta in cima finché il successivo non va a buon fine, perché
          quello che si vede sotto è la copia locale e non quello che il database contiene. */}
      {erroreSalvataggio && (
        <div style={{ background: '#2d0d0d', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: 12, lineHeight: 1.5, marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Modifiche non salvate a database</div>
            {erroreSalvataggio}
          </div>
          <button
            onClick={() => setErroreSalvataggio(null)}
            style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14 }}
            title="Chiudi"
          >
            ✕
          </button>
        </div>
      )}

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
                  const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
                  const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
                  const updatedArr = [updated, ...savedArr.filter(p => String(p.id) !== String(project.id))];
                  localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));
                  await salvaSuDatabase(updated);
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
                  const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
                  const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
                  const updatedArr = [updated, ...savedArr.filter(p => String(p.id) !== String(project.id))];
                  localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));
                  await salvaSuDatabase(updated);
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
            {/* §16 — Ricalcolo dell'avanzamento. Le letture mostrano già i valori calcolati in
                memoria: questo pulsante li PERSISTE, scrivendo solo le righe divergenti (stati e
                segnali di rischio; le percentuali derivano e non hanno colonna). Serve quando lo
                stato a database si è disallineato da quello che il motore calcola. */}
            {puoRicalcolare && (
              <button
                disabled={ricalcolando}
                onClick={async () => {
                  if (!confirm('Ricalcolare l\'avanzamento di questo progetto?\n\nScrive a database gli stati dei moduli e delle micro-voci che risultano divergenti da quelli calcolati (§16). Le righe già allineate non vengono toccate.')) return;
                  setRicalcolando(true);
                  try {
                    // La rotta restituisce l'avanzamento ricalcolato (stato, percentuale, moduli),
                    // non un conteggio: si riferisce quello, senza inventare un numero di righe.
                    const esito: any = await ricalcolaProgettoApi(String(project.id));
                    const pctEsito = typeof esito?.percentuale === 'number' ? `${esito.percentuale}%` : 'n.d.';
                    alert(`Ricalcolo eseguito.\n\nStato progetto: ${esito?.stato ?? 'n.d.'}\nAvanzamento: ${pctEsito}\nModuli valutati: ${Array.isArray(esito?.moduli) ? esito.moduli.length : 0}`);
                    await loadDetail();
                  } catch (e: any) {
                    alert('Ricalcolo non eseguito: ' + (e?.message || 'errore sconosciuto'));
                  } finally {
                    setRicalcolando(false);
                  }
                }}
                title="Persiste a database gli stati calcolati dal motore §16, solo dove divergono"
                style={{ background: '#1a2e1f', border: '1px solid #2f5d3a', color: '#6ee7a0', padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: ricalcolando ? 'wait' : 'pointer', marginLeft: 8, opacity: ricalcolando ? 0.6 : 1 }}
              >
                {ricalcolando ? '⏳ Ricalcolo…' : '🔄 Ricalcola avanzamento'}
              </button>
            )}
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
            {/* Stato vuoto sincero. Prima qui c'era "Inizializzazione Moduli Operativi in
                Corso..." con un pulsante "Istanzia Subito" che scriveva tre moduli cablati
                (Analisi/Societario/Trust, 23.500 € complessivi) con ore GIÀ consuntivate e una
                micro-voce `s: 'done'` — e li salvava nel solo localStorage, mai a database:
                sparivano cambiando browser e la Dashboard non li vedeva. Dichiarava anche "Il
                preventivo è stato accettato dal cliente" senza saperlo. I moduli si aggiungono
                dalla Libreria, che passa dall'API. */}
            {(!project.mods || project.mods.length === 0) ? (
              <div className={styles.emptyMods} style={{ padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🗂</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Nessun modulo a database per questo progetto</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 520, margin: '0 auto 16px' }}>
                  Il progetto esiste ma non ha ancora moduli operativi: non c'è niente da mostrare —
                  né ore, né avanzamento, né importi. I moduli si aggiungono dalla Libreria e vengono
                  salvati sul database.
                </div>
                <button
                  onClick={() => setTab('grafo')}
                  style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  + Aggiungi Modulo da Libreria
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
                  onOpenAssignMod={() => setAssignModalTarget({ modId: mod.id, name: `Modulo: ${mod.n}`, currentAssigned: mod.team || [], categoria: mod.cat })}
                  onOpenAssignMv={(vidx) => setAssignModalTarget({ modId: mod.id, mvIdx: vidx, name: `Microvoce: ${mod.v[vidx]?.n || 'Microvoce'}`, currentAssigned: mod.v[vidx]?.as != null ? [mod.v[vidx]!.as!] : [], categoria: mod.cat })}
                  onOpenCalendarMv={(vidx) => setCalendarModalTarget({ modId: mod.id, mvIdx: vidx, name: mod.v[vidx]?.n || 'Microvoce' })}
                  onDeleteMod={async () => {
                    const confirmDel = window.confirm(`Sei sicuro di voler eliminare il modulo "${mod.n}" dal progetto?`);
                    if (!confirmDel) return;

                    // Il modulo deve esistere a DB — senza dbId non c'è nulla da eliminare
                    // e il modulo orfano non dovrebbe esistere (Regola 7).
                    const dbModuloId = rawDbProject?.moduli?.[mIdx]?.id;
                    if (!dbModuloId) {
                      alert('⚠️ Questo modulo non risulta salvato a database e non può essere eliminato. Ricrea il progetto correttamente.');
                      return;
                    }

                    try {
                      await eliminaModuloApi(String(project.id), dbModuloId);
                    } catch (err: any) {
                      alert(`❌ Eliminazione non riuscita: ${err?.message ?? 'Errore sconosciuto'}`);
                      return;
                    }

                    // Aggiorna state e localStorage solo dopo conferma dal server
                    const newMods = project.mods.filter(m => m.id !== mod.id);
                    const updatedVal = newMods.reduce((acc, m) => acc + (m.p || 0), 0);
                    const updatedProject = { ...project, mods: newMods, val: updatedVal };
                    setProject(updatedProject);
                    const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
                    const savedArr: Progetto[] = savedStr ? JSON.parse(savedStr) : [];
                    const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
                    localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));
                    // Rilegge dal DB per sincronizzare rawDbProject
                    loadDetail();
                  }}
                />
              ))
            )}
          </div>
        )}
        {tab === 'grafo' && (
          <GrafoModuliProgettoView
            project={project}
            onAddModule={async (modello) => {
              // Aggiungere un modulo a un progetto è un atto contrattuale: la riga nasce da un
              // preventivo accettato, che congela modello e versione (§15.3) e genera le
              // micro-voci dalla distinta. Prima qui si costruiva il modulo nel browser e si
              // chiamava `stato-completo`, che aggiorna righe esistenti e non ne crea: il modulo
              // compariva sullo schermo dell'operatore e non esisteva da nessun'altra parte.
              const clienteId = currentClient?.id || rawDbProject?.clienteId || rawDbProject?.cliente?.id;
              if (!clienteId) {
                setErroreSalvataggio('Modulo non aggiunto: il cliente di questo progetto non risulta a database.');
                return;
              }
              try {
                await creaPreventivoEAccettaApi({
                  clienteId: String(clienteId),
                  progettoId: String(project.id),
                  righe: [{ moduloTemplateId: modello.id, moduloTemplateVersione: modello.versione }],
                });
                setErroreSalvataggio(null);
                // Il modulo si rilegge da database, con l'identificativo e le micro-voci vere.
                await loadDetail();
              } catch (err: any) {
                setErroreSalvataggio(`Modulo «${modello.nome}» non aggiunto: ${err?.message || 'errore sconosciuto'}.`);
              }
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

            {/* Richieste addendum dal portale cliente (§2.5) */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Richieste d'Integrazione ricevute dal Portale Cliente:</div>
              <RichiesteAddendumTab progettoId={String(project.id)} />
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
      {procV && (() => {
        // Recupera l'id DB della microvoce dal rawDbProject per passarla al modal
        const rawMod = rawDbProject?.moduli?.find((m: any) => m.id === rawDbProject?.moduli?.[
          project.mods.findIndex(pm => pm.id === procV.mid)
        ]?.id) ?? rawDbProject?.moduli?.[project.mods.findIndex(pm => pm.id === procV.mid)];
        const rawMv = rawMod?.microvoci?.[procV.vidx];
        return (
          <PassaggioModal
            project={project}
            mid={procV.mid}
            vidx={procV.vidx}
            onClose={() => setProcV(null)}
            onSaveVoce={(steps, notes) => handleSavePassaggiModal(procV.mid, procV.vidx, steps, notes)}
            progettoDbId={rawDbProject?.id || (project as any)?.dbId || (project as any)?.id}
            microvoceDbId={rawMv?.id}
          />
        );
      })()}

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
                  <option key={u.id} value={idMembro(u)}>{u.n || (u as any).name} — {u.r || (u as any).role}</option>
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
                  // §Blocco 7 (fix) — prima l'accesso veniva assegnato SEMPRE a uno
                  // userId fisso hardcoded ('11111111-…', Joe Disabato) ignorando la
                  // scelta fatta nella tendina. Ora si usa il membro selezionato e,
                  // in caso di errore, l'errore viene mostrato invece di un finto "salvato".
                  try {
                    const membro = teamList.find(u => idMembro(u) === selectedUser);
                    if (!rawDbProject?.id) {
                      alert('⚠️ Progetto non ancora salvato sul database: impossibile assegnare accessi.');
                      return;
                    }
                    if (!membro?.dbId) {
                      alert('⚠️ Seleziona un collaboratore caricato dal database dello studio.');
                      return;
                    }
                    await assegnaAccessoProgettoApi(rawDbProject.id, membro.dbId, livello);
                    alert(`✓ Accesso "${livello}" assegnato a ${membro.n} sul progetto.`);
                    setAccessiModalOpen(false);
                    loadDetail();
                  } catch (err) {
                    console.error(err);
                    alert('❌ Assegnazione accesso non riuscita. Riprova.');
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
          categoria={assignModalTarget.categoria}
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
            // onSchedule arriva in ordine (data, operatore, priorità, email, tipo, ora, note, luogo);
            // handleSaveCalendarEvent li vuole in ordine diverso (data, ora, operatore, tipo, priorità, email, note, luogo).
            handleSaveCalendarEvent(dt, tm ?? '', opId, actType ?? 'doc', prio, sendE, nts ?? '', loc);
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
          const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
          if (savedStr) {
            const savedArr: Progetto[] = JSON.parse(savedStr);
            const updatedArr = savedArr.filter(p => String(p.id) !== String(project.id));
            localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));
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

  // Micro-voci reali del modulo. Nessun ripiego: era l'ultimo fabbricatore della pagina e il
  // più insidioso, perché agiva in fase di render — anche con i dati corretti a monte, un modulo
  // senza micro-voci ne mostrava tre pescate da MLIB (per nome, per inclusione del nome e infine
  // `MLIB[0]`, quindi sempre qualcosa) o generate col nome del modulo interpolato. Erano righe
  // cliccabili con ore preventivate, indistinguibili da quelle vere: si potevano consuntivare, e
  // `consuntivaMicrovoceApi` sarebbe stata chiamata con l'id di una micro-voce che a database non
  // esiste. È anche la ragione per cui i due moduli senza micro-voci di "Struttura Holding —
  // Famiglia Ricci" (debito noto di Fase 1) risultavano pieni. Un modulo senza micro-voci si
  // dichiara vuoto.
  const displayMicrovoci: MicroVoce[] = mod.v || [];

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
          {/* §16.1 — sforamento ore: il modulo avanza, ma sta costando oltre il preventivo.
              Non è il ritardo di `dn`, ed è lo stesso segnale che la Dashboard mostra nel banner. */}
          {mod.rischio && (
            <div className={styles.modNote} style={{ color: 'var(--amber)' }}>
              ⚠ Ore sforate{mod.oreExtra ? ` — +${mod.oreExtra}h oltre il preventivo` : ''}
            </div>
          )}
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
              {displayMicrovoci.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 18, fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
                    Questo modulo non ha micro-voci a database.<br />
                    Nessuna ora preventivata né consuntivata: non c'è avanzamento da calcolare finché non vengono istanziate.
                  </td>
                </tr>
              )}
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
                        {/* `as` è opzionale (voci seed non assegnate): Avatar gestisce l'id vuoto. */}
                        <Avatar id={v.as ?? ''} size={22} />
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

        const savedStr = localStorage.getItem(getTenantStorageKey('bluman_custom_projects'));
        const savedArr: any[] = savedStr ? JSON.parse(savedStr) : [];
        const updatedArr = [updatedProject, ...savedArr.filter(p => String(p.id) !== String(project.id))];
        localStorage.setItem(getTenantStorageKey('bluman_custom_projects'), JSON.stringify(updatedArr));
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
                    Fattura N. <strong>FT-2026-00{i + 1}</strong> · Canale: <strong>SDI (invio manuale)</strong> · Stato: <span style={{ color: 'var(--indigo-l)' }}>Emessa · pronta per invio</span>
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
              {(() => {
                const studio = getStudioInfoForTenant();
                const isBC = getCurrentTenantId() === BLUECODE_TENANT_ID;
                const rawLogo = localStorage.getItem(getTenantStorageKey('bluman_logo_url')) || (isBC ? '/logo.png' : '');
                const logo = rawLogo ? getFormattedLogoUrl(rawLogo) : '';
                return (
                  <div>
                    {logo ? (
                      <img
                        src={logo}
                        alt="Logo Studio"
                        style={{ maxHeight: 60, maxWidth: 220, objectFit: 'contain', marginBottom: 8, display: 'block' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div style={{ fontSize: 18, fontWeight: 800, color: '#1e1b4b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🏛 {studio.ragioneSociale.toUpperCase()}
                      </div>
                    )}
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#1e1b4b' }}>
                      {studio.ragioneSociale}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                      {studio.sedeLegale}{studio.sedeLegale ? <br /> : null}
                      {studio.piva ? `P.IVA/VAT: ${studio.piva}` : ''}{studio.iban ? ` · IBAN: ${studio.iban}` : ''}
                    </div>
                  </div>
                );
              })()}
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
                  const studio = getStudioInfoForTenant();
                  const isBC = getCurrentTenantId() === BLUECODE_TENANT_ID;
                  const rawLogoUrl = localStorage.getItem(getTenantStorageKey('bluman_logo_url')) || (isBC ? '/logo.png' : '');
                  const logoUrl = rawLogoUrl ? getFormattedLogoUrl(rawLogoUrl) : '';
                  const logoHtml = logoUrl
                    ? `<img src="${logoUrl}" style="max-height:60px;max-width:220px;object-fit:contain;margin-bottom:8px;display:block;" />`
                    : `<div style="font-size:18px;font-weight:800;color:#1e1b4b;margin-bottom:8px;">🏛 ${studio.ragioneSociale.toUpperCase()}</div>`;
                  const htmlContent = `
                    <div style="border-bottom:2px solid #0f172a;padding-bottom:15px;display:flex;justify-content:space-between;align-items:flex-start;">
                      <div>
                        ${logoHtml}
                        <div style="font-size:20px;font-weight:800;color:#1e1b4b;">${studio.ragioneSociale}</div>
                        <div style="font-size:11px;color:#475569;margin-top:2px;">${studio.sedeLegale}${studio.sedeLegale ? '<br/>' : ''}${studio.piva ? `VAT: ${studio.piva}` : ''}${studio.iban ? ` · IBAN: ${studio.iban}` : ''}</div>
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
                  // Qui veniva passato un blocco firma con nome dell'advisor e un IP fisso
                  // ('83.211.12.94'): il generatore lo stampa sotto la dicitura «✓ FIRMATO
                  // DIGITALMENTE (eIDAS UE 910/2014)», quindi ogni fattura esportata usciva
                  // con un sigillo che nessuno aveva apposto e una provenienza inventata. La
                  // fattura è un documento contabile: si esporta senza sigillo, e se un
                  // giorno andrà firmata passerà dal flusso di firma vero.
                  await downloadRealPdf(`BluMan_Fattura_${previewFattura.numero}`, htmlContent);
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
  /**
   * Aggiunge al progetto un modulo della libreria. Passa il modello, non un modulo già
   * costruito: l'istanza — righe di distinta, versioni congelate (§15.3), micro-voci — la crea
   * il backend dal preventivo. Costruirla qui produceva un modulo che esisteva solo nel browser.
   */
  onAddModule: (modello: { id: string; versione: number; nome: string; prezzo: number }) => void;
  onSelectMod: (modId: number) => void;
}) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [dbModTemplates, setDbModTemplates] = useState<Array<{ id: string; ver: number; n: string; cat: string; h: number; p: number; righe: any[] }>>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [erroreLibreria, setErroreLibreria] = useState<string | null>(null);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const [mods, arts] = await Promise.all([fetchModuliLibreria(), fetchArticoli()]);
        if (!mods || !Array.isArray(mods)) {
          setErroreLibreria('Libreria moduli non raggiungibile: non è possibile aggiungere moduli.');
          return;
        }
        if (mods.length === 0) {
          setErroreLibreria('La libreria moduli di questo studio è vuota: creane uno in Libreria prima di aggiungerlo a un progetto.');
          return;
        }
        const mapped = mods.map((m: any) => {
          const righeResolved = (m.righeDistinta || []).map((r: any) => {
            const art = (arts || []).find((a: any) => a.id === r.articoloId) || r.articolo;
            const quantita = r.quantita || 1;
            return {
              n: art ? art.nome : 'Articolo non trovato in libreria',
              hE: (r.overrideOre != null ? r.overrideOre : (art?.oreDefault || 0)) * quantita,
              prezzo: (r.overridePrezzo != null ? r.overridePrezzo : (art?.prezzoDefault || 0)) * quantita,
              hA: 0,
              s: 'pending',
              // Regola 7: nessun assegnatario fittizio — l'assegnazione avviene solo
              // dopo che un membro reale del team viene scelto sul modulo/micro-voce.
              d: 0,
            };
          });
          // Ore e prezzo del modulo sono la somma di quello che la distinta contiene davvero.
          // Prima c'erano tre invenzioni in tre righe: `|| 10` ore, `|| 1500` euro e una tariffa
          // di 150 €/ora applicata alle ore quando il pacchetto non aveva prezzo. Un modulo
          // senza distinta risultava così da 10 ore e 1.500 €, cifre che nessuno aveva stimato
          // e che finivano nel valore dell'incarico e nella redditività.
          return {
            id: m.id,
            ver: m.versione || 1,
            n: m.nome,
            cat: m.categoria,
            h: righeResolved.reduce((acc: number, x: any) => acc + x.hE, 0),
            p: m.prezzoPacchetto != null
              ? m.prezzoPacchetto / 100
              : righeResolved.reduce((acc: number, x: any) => acc + x.prezzo, 0) / 100,
            // Nessuna micro-voce inventata: un modulo di libreria senza distinta è un modulo
            // senza distinta, e l'elenco lo dichiara vuoto.
            righe: righeResolved,
          };
        });
        setDbModTemplates(mapped);
        setErroreLibreria(null);
        if (mapped.length > 0) setSelectedTemplate(mapped[0].id);
      } catch (err: any) {
        setErroreLibreria(`Libreria moduli non caricata: ${err?.message || 'errore di rete'}.`);
      }
    }
    loadTemplates();
  }, []);

  // I moduli disponibili sono quelli della libreria dello studio. Qui c'era un elenco fisso di
  // tre voci — «Trust & Asset Protection» 30h/4.500 €, «IP Licensing» 22h/3.800 €, «Licenza MFSA
  // VASP» 50h/9.500 € — che compariva ogni volta che la libreria non rispondeva: nomi, ore e
  // prezzi di uno studio immaginario, aggiungibili a un progetto vero con un clic.
  const allAvailableTemplates = dbModTemplates;

  const handleAddModuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tmpl = allAvailableTemplates.find(t => t.id === selectedTemplate);
    if (!tmpl) return;
    onAddModule({ id: tmpl.id, versione: tmpl.ver, nome: tmpl.n, prezzo: tmpl.p });
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

            {erroreLibreria && (
              <div style={{ background: '#2d0d0d', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '9px 12px', borderRadius: 10, fontSize: 11, lineHeight: 1.5 }}>
                {erroreLibreria}
              </div>
            )}

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Modulo Template Libreria *</label>
              <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{ padding: 10, fontSize: 12 }} disabled={allAvailableTemplates.length === 0}>
                {allAvailableTemplates.length === 0 && <option value="">— nessun modulo in libreria —</option>}
                {allAvailableTemplates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.n} ({t.cat}) — {t.h}h — {fmt(t.p)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 11, color: 'var(--muted)' }}>
              ℹ️ Il modulo viene istanziato a database da un preventivo accettato: modello e versione restano congelati (§15.3) e le micro-voci nascono dalla distinta del modello.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setAddModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" disabled={!selectedTemplate} style={{ background: selectedTemplate ? 'var(--indigo)' : 'var(--card2)', color: selectedTemplate ? '#fff' : 'var(--hint)', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: selectedTemplate ? 'pointer' : 'not-allowed' }}>✓ Aggiungi al Progetto</button>
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
                // Valori come stanno a database. I ripieghi precedenti (`|| 3500` di prezzo,
                // `|| 10` ore stimate) producevano una riga di conto economico completa — ricavo,
                // costo, margine, resa oraria e verdetto "In Target" — su un modulo che a
                // database non ha né prezzo né ore. Le ore reali venivano inoltre INTERPOLATE
                // dalla percentuale (`modH_Stima * pct/100`) e mostrate nella colonna "Ore
                // Reali": ore che nessuno aveva consuntivato, usate poi per calcolare il costo
                // interno dello studio. Ora la riga senza dati si dichiara non calcolabile.
                const modP = m.p || 0;
                const modH_Stima = m.h || 0;
                const modH_Reali = m.a || 0;
                const defaultOp = (m.team && m.team[0]) || 1;
                const opRate = OPERATOR_RATES[defaultOp]?.rate || 95;
                const modCostoStudio = modH_Reali * opRate;
                const modMargine = modP - modCostoStudio;
                // La resa oraria esiste solo con ore consuntivate: senza, non è "prezzo pieno
                // all'ora", è indeterminata.
                const modResa: number | null = modH_Reali > 0 ? modP / modH_Reali : null;
                const isProfit = modResa !== null && modResa >= 200;
                const calcolabile = modP > 0 || modH_Reali > 0;

                return (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)', opacity: calcolabile ? 1 : 0.55 }}>
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
                      {calcolabile ? fmt(modMargine) : '—'}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 800, color: '#fbbf24' }}>
                      {modResa !== null ? `${fmt(modResa)} / h` : '—'}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {modResa === null ? (
                        <span style={{ fontSize: 9.5, background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
                          ⚪ Nessuna ora consuntivata
                        </span>
                      ) : (
                        <span style={{ fontSize: 9.5, background: isProfit ? '#0d2d22' : '#2d1a05', color: isProfit ? '#34d399' : '#f59e0b', border: `1px solid ${isProfit ? '#059669' : '#d97706'}`, padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
                          {isProfit ? '🟢 In Utile Extra' : '🟡 In Target'}
                        </span>
                      )}
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

// §2.9 — converte una riga della tabella `documento` (API GET /documenti) nella forma
// usata dalla griglia del vault (nome/cat/formato/url).
/**
 * §2.5 — richieste di addendum inviate dal cliente dal portale.
 *
 * Lo studio le prende in carico, prepara l'addendum e ne aggiorna lo stato; il cliente
 * vede ogni passaggio sul portale. Prima la "cronologia addendum" viveva nel
 * localStorage del browser del cliente: invisibile qui e persa al cambio dispositivo.
 */
function RichiesteAddendumTab({ progettoId }: { progettoId: string }) {
  const [richieste, setRichieste] = useState<RichiestaAddendum[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState<string | null>(null);
  const [inAzione, setInAzione] = useState<string | null>(null);
  const [rispostaBozza, setRispostaBozza] = useState<Record<string, string>>({});

  const carica = async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      setRichieste(await richiesteAddendumStudioApi({ progettoId }));
    } catch (err: any) {
      setErrore(err?.message || 'Errore nel caricamento delle richieste di addendum.');
    } finally {
      setCaricamento(false);
    }
  };

  useEffect(() => { void carica(); }, [progettoId]);

  const aggiornaStato = async (r: RichiestaAddendum, stato: RichiestaAddendum['stato']) => {
    setInAzione(r.id);
    setErrore(null);
    try {
      await aggiornaStatoAddendumApi(r.id, {
        stato,
        rispostaStudio: (rispostaBozza[r.id] || '').trim() || undefined,
      });
      await carica();
    } catch (err: any) {
      setErrore(err?.message || 'Errore durante l\'aggiornamento della richiesta.');
    } finally {
      setInAzione(null);
    }
  };

  const badge: Record<RichiestaAddendum['stato'], { testo: string; sfondo: string; colore: string }> = {
    richiesta: { testo: '📨 RICEVUTA', sfondo: 'var(--amber)', colore: '#000' },
    in_preparazione: { testo: '⚙️ IN PREPARAZIONE', sfondo: 'var(--indigo)', colore: '#fff' },
    pronta: { testo: '✅ PRONTA PER LA FIRMA', sfondo: '#34d399', colore: '#000' },
    rifiutata: { testo: '⛔ RIFIUTATA', sfondo: '#b91c1c', colore: '#fff' },
  };

  if (caricamento) {
    return <div style={{ fontSize: 11, color: 'var(--muted)', padding: 12 }}>Caricamento richieste…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {errore && (
        <div style={{ background: '#2d1516', border: '1px solid #7f1d1d', color: '#fca5a5', borderRadius: 8, padding: 10, fontSize: 11 }}>
          ⚠️ {errore}
        </div>
      )}
      {richieste.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--card2)', padding: 12, borderRadius: 8 }}>
          Nessuna richiesta di addendum ricevuta dal portale per questo progetto.
        </div>
      ) : (
        richieste.map((r) => {
          const b = badge[r.stato] ?? badge.richiesta;
          return (
            <div key={r.id} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ background: b.sfondo, color: b.colore, fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 10 }}>{b.testo}</span>
                  {r.cliente && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{r.cliente.nome}</span>}
                </div>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {new Date(r.createdAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>

              <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'pre-wrap', marginBottom: 10 }}>{r.testoRichiesta}</div>

              {(r.stato === 'richiesta' || r.stato === 'in_preparazione') ? (
                <>
                  <textarea
                    value={rispostaBozza[r.id] ?? r.rispostaStudio ?? ''}
                    onChange={(e) => setRispostaBozza({ ...rispostaBozza, [r.id]: e.target.value })}
                    placeholder="Risposta / nota per il cliente (facoltativa, visibile sul portale)…"
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontSize: 11, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {r.stato === 'richiesta' && (
                      <>
                        <button
                          onClick={() => void aggiornaStato(r, 'in_preparazione')}
                          disabled={inAzione === r.id}
                          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: inAzione === r.id ? 'default' : 'pointer' }}
                        >
                          ⚙️ Prendi in carico
                        </button>
                        <button
                          onClick={() => void aggiornaStato(r, 'rifiutata')}
                          disabled={inAzione === r.id}
                          style={{ background: '#450a0a', border: '1px solid #b91c1c', color: '#fecaca', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: inAzione === r.id ? 'default' : 'pointer' }}
                        >
                          ⛔ Rifiuta
                        </button>
                      </>
                    )}
                    {r.stato === 'in_preparazione' && (
                      <button
                        onClick={() => void aggiornaStato(r, 'pronta')}
                        disabled={inAzione === r.id}
                        style={{ background: '#14532d', border: '1px solid #16a34a', color: '#bbf7d0', padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: inAzione === r.id ? 'default' : 'pointer' }}
                      >
                        ✅ Addendum pronto (avvisa il cliente)
                      </button>
                    )}
                  </div>
                </>
              ) : (
                r.rispostaStudio && (
                  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 11, color: 'var(--muted)' }}>
                    <b style={{ color: 'var(--text)' }}>Risposta inviata al cliente:</b>{' '}
                    <span style={{ whiteSpace: 'pre-wrap' }}>{r.rispostaStudio}</span>
                  </div>
                )
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function documentoApiAVista(d: any, projectId: string): any {
  // Il prefisso `${Date.now()}_` aggiunto dall'archivio per evitare omonimie non va mostrato.
  const nome = decodeURIComponent((d.fileUrl || '').split('?')[0].split('/').pop() || 'Documento').replace(/^\d{13}_/, '');
  const dataFmt = d.createdAt ? new Date(d.createdAt).toLocaleDateString('it-IT') : '';
  return {
    id: d.id,
    dbDoc: true,
    nome,
    titolo: nome.replace(/\.[^/.]+$/, ''),
    cat: d.categoriaDoc && d.categoriaDoc !== 'generico' ? d.categoriaDoc : 'Allegati Progetto',
    data: dataFmt,
    dataCaricamento: dataFmt,
    progettoId: projectId,
    firmato: Boolean(d.firmato),
    formato: /\.png$|\.jpe?g$/i.test(nome) ? 'immagine' : 'pdf',
    url: d.fileUrl,
  };
}

function DocumentiTab({ project }: { project: Progetto }) {
  const navigate = useNavigate();
  const [docCategory, setDocCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [uploading, setUploading] = useState(false);
  const [selectedPreviewDoc, setSelectedPreviewDoc] = useState<any | null>(null);

  // Caricamento Documenti dal Vault Locale e Cloud (Sincronizzati 1-a-1 con i Modelli Word Studio)
  const [docList, setDocList] = useState<any[]>(() => {
    const isBluecode = getCurrentTenantId() === BLUECODE_TENANT_ID;
    const isDemoProj = String(project.id) === 'proj-001' || String(project.id) === 'proj-002' || String(project.id) === '1' || String(project.id) === '2';
    const studio = getStudioInfoForTenant();
    
    const defaultDocs = (isBluecode && isDemoProj) ? PREBUILT_TEMPLATES.map(t => {
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
        nome: `${t.titolo} — ${project.cl}.pdf`,
        titolo: t.titolo,
        cat: catLabel,
        dimensione: '54 KB',
        data: '15/08/2026',
        dataCaricamento: '15/08/2026',
        firmato: isSigned,
        formato: 'pdf',
        contenutoHtml: resolveDocumentTemplateHtml(t.contenutoHtml, {
          cliente: { nome: project.cl, ragione_sociale: project.cl },
          progetto: { titolo: project.n, importo_totale: fmt(project.val) },
          studio: { ragioneSociale: studio.ragioneSociale, sedeLegale: studio.sedeLegale, piva: studio.piva },
          isForPrintOrExport: false,
          tagMode: 'plain',
        }),
      };
    }) : [];

    try {
      const storageKey = getTenantStorageKey(`bluman_project_documents_${project.id}`);
      const savedProjDocsStr = localStorage.getItem(storageKey);
      const savedProjDocs: any[] = savedProjDocsStr ? JSON.parse(savedProjDocsStr) : [];

      const allVaultStr = localStorage.getItem(getTenantStorageKey('bluman_all_vault_documents'));
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

  // §2.9 — i file caricati dallo studio vivono nella tabella `documento`, agganciati al
  // progetto: qui li leggiamo dal database e li aggiungiamo alla lista (i template Word
  // generati in locale restano, i doppioni eventualmente già presenti vengono vinti dal DB).
  useEffect(() => {
    let attivo = true;
    listaDocumentiProgetto(String(project.id))
      .then((dbDocs) => {
        if (!attivo) return;
        const vista = dbDocs.map((d) => documentoApiAVista(d, String(project.id)));
        setDocList((prev) => {
          const idsDb = new Set(vista.map((d) => d.id));
          return [...vista, ...prev.filter((d) => !idsDb.has(d.id))];
        });
      })
      .catch((err) => console.warn('Lettura documenti progetto non riuscita', err));
    return () => { attivo = false; };
  }, [project.id]);

  // Helper per scaricare localmente copia VERA in PDF A4 con Header/Footer Studio
  const handleDownloadDocument = async (doc: any) => {
    // §2.9 — i file caricati nel fascicolo sono già il file vero: si scarica l'originale,
    // non una copia PDF generata dal contenuto HTML.
    if (doc.dbDoc && doc.url && doc.url !== '#') {
      window.open(doc.url, '_blank');
      return;
    }
    const studio = getStudioInfoForTenant();
    const rawContent = doc.contenutoHtml || `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.6; font-size: 11pt; padding: 10px;">
        <h1 style="color: #1e1b4b; text-align: center; text-transform: uppercase; font-size: 18pt; border-bottom: 2px solid #4338ca; padding-bottom: 10px; margin-bottom: 20px;">
          ${doc.titolo || doc.nome}
        </h1>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 10pt;">
          <strong>Studio Professionale:</strong> ${studio.ragioneSociale}<br/>
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
            <div style="font-size: 16pt; font-weight: 800; color: #1e1b4b;">${studio.ragioneSociale.toUpperCase()} — ADVISORY SERVICES</div>
            <div style="font-size: 9pt; color: #64748b;">${studio.sedeLegale} · P.IVA ${studio.piva}</div>
          </div>
          <div style="text-align: right; font-size: 8.5pt; color: #64748b;">
            Rif. Incarico: #${project.id}<br/>Data: ${doc.data || doc.dataCaricamento || '2026'}
          </div>
        </div>
        <div>${rawContent}</div>
        <div style="margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #94a3b8;">
          <span>${studio.ragioneSociale} • Pratica: ${project.n}</span>
          <span>Sigillo eIDAS Documentale • Validità Giuridica UE</span>
        </div>
      </div>
    `;

    const safePdfName = `${(doc.titolo || doc.nome || 'Documento').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    await downloadRealPdf(safePdfName, fullPrintHtml);
  };

  // Caricamento File da Disco nel Vault Progetto
  // §2.9 — il file va nel fascicolo del progetto a database (tabella `documento`): prima
  // la scansione lato server (§28), poi la riga visibile al portale cliente e agli altri
  // operatori. Niente più localStorage, che era invisibile a chiunque altro.
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(((reader.result as string) || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Lettura del file non riuscita'));
        reader.readAsDataURL(file);
      });

      const salvato = await salvaDocumentoApi({
        progettoId: String(project.id),
        filename: file.name,
        contentBase64: base64,
        categoriaDoc: 'Allegati Progetto',
      });

      setDocList((prev) => [documentoApiAVista(salvato, String(project.id)), ...prev]);
      alert(`✓ File "${file.name}" archiviato nel fascicolo del progetto con successo!`);
    } catch (err) {
      console.error(err);
      const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
      alert(`Caricamento non riuscito${motivo}`);
    } finally {
      setUploading(false);
      e.target.value = ''; // permette di ricaricare lo stesso file
    }
  };

  // Eliminazione Documento dal Vault
  // §2.9 — le riga a database passano da DELETE /documenti/:id; i template generati in
  // locale (demo) si rimuovono solo dalla lista a schermo come prima.
  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Vuoi rimuovere questo documento dal Vault del progetto?')) return;
    const doc = docList.find(d => d.id === docId);
    try {
      if (doc?.dbDoc) await eliminaDocumentoApi(docId);
      const updated = docList.filter(d => d.id !== docId);
      setDocList(updated);
      if (!doc?.dbDoc) {
        localStorage.setItem(getTenantStorageKey(`bluman_project_documents_${project.id}`), JSON.stringify(updated.filter(d => !d.dbDoc)));
      }
      if (selectedPreviewDoc?.id === docId) setSelectedPreviewDoc(null);
    } catch (err) {
      console.error(err);
      const motivo = err instanceof Error && err.message ? `: ${err.message}` : '';
      alert(`Eliminazione non riuscita${motivo}`);
    }
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
              const studio = getStudioInfoForTenant();
              const indiceText = `================================================================================
${studio.ragioneSociale.toUpperCase()} — ADVISORY PLATFORM
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
                ) : selectedPreviewDoc.dbDoc && selectedPreviewDoc.url && selectedPreviewDoc.url !== '#' ? (
                  // §2.9 — file reale archiviato nel fascicolo: anteprima del PDF/immagine caricato
                  <div style={{ fontFamily: 'sans-serif' }}>
                    {/\.(png|jpe?g)$/i.test(selectedPreviewDoc.nome || '') ? (
                      <img src={selectedPreviewDoc.url} alt={selectedPreviewDoc.nome} style={{ maxWidth: '100%', borderRadius: 6 }} />
                    ) : (
                      <iframe src={selectedPreviewDoc.url} title={selectedPreviewDoc.nome || 'Documento'} style={{ width: '100%', height: 480, border: '1px solid #cbd5e1', borderRadius: 6, background: '#f1f5f9' }} />
                    )}
                    <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12 }}>
                      <a href={selectedPreviewDoc.url} target="_blank" rel="noreferrer" style={{ color: '#0284c7', fontWeight: 700 }}>↗ Apri il file originale</a>
                    </div>
                  </div>
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
                📥 Scarica Documento PDF A4
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
