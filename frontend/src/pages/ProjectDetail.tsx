import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PassaggioModal } from '../components/PassaggioModal';
import { progressColor } from '../utils';
import { ComunicazioniTab } from '../components/ComunicazioniTab';
import { AssignOperatorModal } from '../components/AssignOperatorModal';
import { CalendarPreviewModal } from '../components/CalendarPreviewModal';
import { ConfirmDeleteModal } from '../components/ConfirmDeleteModal';
import { ModuliTab } from '../components/projectDetail/ModuliTab';
import { FatturazioneTab } from '../components/projectDetail/FatturazioneTab';
import { GrafoModuliProgettoView } from '../components/projectDetail/GrafoModuliProgettoView';
import { RedditivitaTab } from '../components/projectDetail/RedditivitaTab';
import { StoricoContrattiTab } from '../components/projectDetail/StoricoContrattiTab';
import { DocumentiTab } from '../components/projectDetail/DocumentiTab';
import { CalendarioProgettoTab } from '../components/projectDetail/CalendarioProgettoTab';
import { HeaderProgetto } from '../components/projectDetail/HeaderProgetto';
import { ModalAccessiProgetto } from '../components/projectDetail/ModalAccessiProgetto';
import { fetchProgettoDettaglio, assegnaAccessoProgettoApi, salvaProgettoDettaglioApi, archiviaProgettoApi, eliminaProgettoApi, eliminaModuloApi, inviaComunicazioneApi, ricalcolaProgettoApi, creaPreventivoEAccettaApi } from '../api/client';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { getCurrentTenantId, getTenantStorageKey, BLUECODE_TENANT_ID } from '../utils/tenant';
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
                // Il database enumera il tipo con i valori Prisma («documento», «verifica»);
                // la UI parla «doc»/«check». La traduzione avviene qui al confine, così il
                // rendering (bottone allegato, etichette, colori) riconosce la riga.
                type: p.tipo === 'documento' ? 'doc' : p.tipo === 'verifica' ? 'check' : p.tipo,
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

  const handleRinominaProgetto = async () => {
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
  };

  const handleModificaValore = async () => {
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
  };

  const handleRicalcolaAvanzamento = async () => {
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
  };

  const handleArchiviaRipristina = async () => {
    const isArchived = project.st === 'archived';
    if (confirm(isArchived ? 'Vuoi ripristinare questo progetto?' : 'Vuoi archiviare questo progetto?')) {
      try {
        await archiviaProgettoApi(String(project.id), !isArchived);
        setProject({ ...project, st: isArchived ? 'in_progress' : 'archived' });
      } catch (e: any) {
        alert('Errore archiviazione: ' + e.message);
      }
    }
  };

  const handleEliminaModulo = async (mod: ModuloProgetto, mIdx: number) => {
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
  };

  const handleAssegnaAccessoProgetto = async () => {
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
      <HeaderProgetto
        project={project}
        color={color}
        puoRicalcolare={puoRicalcolare}
        ricalcolando={ricalcolando}
        onBack={() => navigate(-1)}
        onRinomina={handleRinominaProgetto}
        onApriCliente={() => navigate(`/clients?client=${encodeURIComponent(project.cl)}`)}
        onModificaValore={handleModificaValore}
        onApriAccessi={() => setAccessiModalOpen(true)}
        onRicalcola={handleRicalcolaAvanzamento}
        onArchivia={handleArchiviaRipristina}
        onElimina={() => setDeleteModalOpen(true)}
      />

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
          <ModuliTab
            project={project}
            expanded={expanded}
            rawDbProject={rawDbProject}
            onVaiAGrafo={() => setTab('grafo')}
            onToggle={toggleMod}
            onOpenProc={(modId, vidx) => setProcV({ mid: modId, vidx })}
            onRefresh={() => loadDetail()}
            onToggleMv={handleToggleMicrovoce}
            onOpenAssignMod={(mod) => setAssignModalTarget({ modId: mod.id, name: `Modulo: ${mod.n}`, currentAssigned: mod.team || [], categoria: mod.cat })}
            onOpenAssignMv={(mod, vidx) => setAssignModalTarget({ modId: mod.id, mvIdx: vidx, name: `Microvoce: ${mod.v[vidx]?.n || 'Microvoce'}`, currentAssigned: mod.v[vidx]?.as != null ? [mod.v[vidx]!.as!] : [], categoria: mod.cat })}
            onOpenCalendarMv={(mod, vidx) => setCalendarModalTarget({ modId: mod.id, mvIdx: vidx, name: mod.v[vidx]?.n || 'Microvoce' })}
            onDeleteMod={handleEliminaModulo}
          />
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
        {tab === 'storico' && <StoricoContrattiTab project={project} />}
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
        const currentMod = project.mods.find(pm => pm.id === procV.mid);
        const currentMv = currentMod?.v?.[procV.vidx];
        const rawMod = rawDbProject?.moduli?.find((m: any) => m.id === currentMod?.dbId || m.nome?.trim().toLowerCase() === currentMod?.n?.trim().toLowerCase()) ?? rawDbProject?.moduli?.[project.mods.findIndex(pm => pm.id === procV.mid)];
        const rawMv = rawMod?.microvoci?.find((rmv: any) => rmv.id === currentMv?.dbId || rmv.nome?.trim().toLowerCase() === currentMv?.n?.trim().toLowerCase()) ?? rawMod?.microvoci?.[procV.vidx];
        const resolvedMicrovoceDbId = currentMv?.dbId || rawMv?.id;
        const resolvedProgettoDbId = rawDbProject?.id || (project as any)?.dbId || (project as any)?.id;
        return (
          <PassaggioModal
            project={project}
            mid={procV.mid}
            vidx={procV.vidx}
            onClose={() => setProcV(null)}
            onSaveVoce={(steps, notes, docCount) => handleSavePassaggiModal(procV.mid, procV.vidx, steps, notes, docCount)}
            progettoDbId={resolvedProgettoDbId}
            microvoceDbId={resolvedMicrovoceDbId}
          />
        );
      })()}

      {/* Modal Accessi Progetto (§19) */}
      {accessiModalOpen && (
        <ModalAccessiProgetto
          teamList={teamList}
          selectedUser={selectedUser}
          onSelectedUserChange={setSelectedUser}
          livello={livello}
          onLivelloChange={setLivello}
          idMembro={idMembro}
          onChiudi={() => setAccessiModalOpen(false)}
          onAssegna={handleAssegnaAccessoProgetto}
        />
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

