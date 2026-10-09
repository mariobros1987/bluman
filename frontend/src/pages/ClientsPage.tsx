import React, { useState, useEffect, useRef } from 'react';
import { fetchClienti, fetchCliente, creaClienteApi, resetPasswordClienteApi } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey, getTenantSeedData, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Cliente } from '../types';
import styles from './ClientsPage.module.css';
import { AnagraficaErpModal } from '../components/clients/AnagraficaErpModal';
import { MagicLinkExplainModal } from '../components/clients/MagicLinkExplainModal';
import { CredentialsExplainModal } from '../components/clients/CredentialsExplainModal';
import { Paginatore } from '../components/ui/Paginatore';
import { isRispostaPaginata, type MetaPaginazione } from '../api/paginazione';

const META_INIZIALE: MetaPaginazione = { page: 1, limit: 50, totale: 0, pagine: 0 };

import { useSearchParams } from 'react-router-dom';
import { useToast } from '../components/ui/ToastProvider';
import { Modal } from '../components/ui/Modal';

// ─── Preferenza di vista (elenco / schede) ────────────────────────────────────
// Stesso schema di `utils/theme.ts`: chiave semplice in localStorage, lettura difensiva.
// È una preferenza **per browser**, non per account: su una postazione condivisa due operatori
// la condividono, esattamente come già accade per il tema. Se servisse per account basterebbe
// aggiungere l'id utente alla chiave.
const CHIAVE_VISTA = 'bluman_clienti_vista';
type Vista = 'elenco' | 'schede';

function leggiVistaSalvata(): Vista {
  // L'elenco è la vista predefinita: serve proprio quando i clienti diventano tanti, che è la
  // ragione per cui l'interruttore esiste. Un valore assente o corrotto ricade qui.
  if (typeof localStorage === 'undefined') return 'elenco';
  try {
    return localStorage.getItem(CHIAVE_VISTA) === 'schede' ? 'schede' : 'elenco';
  } catch {
    return 'elenco';
  }
}

function salvaVista(v: Vista) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CHIAVE_VISTA, v);
  } catch {
    // Storage non disponibile (navigazione privata, quota): la vista resta quella scelta in
    // memoria e semplicemente non si ricorda al prossimo accesso. Non è un motivo per rompere.
  }
}

export function ClientsPage() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const targetClientQuery = searchParams.get('client') || '';
  // `?client=<id>` da solo apre il modale del Magic Link (ci arrivano Dashboard e ProjectDetail,
  // che passano il **nome** del cliente). L'avviso «messaggio non instradabile» vuole un'altra
  // cosa — l'anagrafica — e passa l'**id**, perché il nome può ripetersi fra due clienti e
  // aprire la scheda sbagliata sarebbe peggio che non aprire niente. Da qui il parametro in più.
  const apriAnagrafica = searchParams.get('azione') === 'anagrafica';

  const [clienti, setClienti] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [meta, setMeta] = useState<MetaPaginazione>(META_INIZIALE);
  const [riepilogo, setRiepilogo] = useState({ societa: 0, persone: 0, senzaPortale: 0 });
  const [search, setSearch] = useState(targetClientQuery);
  const [searchDebounced, setSearchDebounced] = useState(targetClientQuery);
  const [filterType, setFilterType] = useState<'all' | 'individual' | 'company'>('all');
  const [filterPortale, setFilterPortale] = useState<'all' | 'con' | 'senza'>('all');
  const [vista, setVista] = useState<Vista>(leggiVistaSalvata);
  // `createdAt desc` è l'ordine che la pagina aveva cablato: resta il predefinito, così chi non
  // tocca le intestazioni vede esattamente quello di prima.
  const [sortBy, setSortBy] = useState<'createdAt' | 'nome' | 'tipo'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [editClientModal, setEditClientModal] = useState<Cliente | null>(null);
  const [, setEditClientName] = useState('');
  const [, setEditClientType] = useState<'individual' | 'company'>('company');

  const openEditModal = (c: Cliente) => {
    setEditClientModal(c);
    setEditClientName(c.nome);
    setEditClientType(c.tipo);
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [magicLinkModal, setMagicLinkModal] = useState<Cliente | null>(null);
  const [credentialsModal, setCredentialsModal] = useState<{
    cliente: Cliente;
    passwordChiaro: string;
    email: string;
    emailInviata: boolean;
    erroreInvioEmail?: string;
  } | null>(null);
  const [generatingCredentials, setGeneratingCredentials] = useState<string | null>(null);

  const handleGenerateCredentials = async (c: Cliente) => {
    setGeneratingCredentials(c.id);
    try {
      const res = await resetPasswordClienteApi(c.id);
      if (res && res.ok) {
        setCredentialsModal({
          cliente: c,
          passwordChiaro: res.passwordChiaro,
          email: res.email || c.email || '',
          emailInviata: res.emailInviata,
          erroreInvioEmail: res.erroreInvioEmail,
        });
        setClienti(prev => prev.map(item => item.id === c.id ? { ...item, hasPassword: true } : item));
      }
    } catch (err: any) {
      toast.errore(`Errore generazione credenziali: ${err.message}`);
    } finally {
      setGeneratingCredentials(null);
    }
  };

  // Form state
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<'individual' | 'company'>('individual');
  const [submitting, setSubmitting] = useState(false);
  // Errore mostrato DENTRO la modale di creazione: la banda `errore` di pagina resta dietro
  // l'overlay e l'operatore non la vedrebbe. Serve a non chiudere la modale come per un
  // successo quando la creazione a database è invece fallita.
  const [erroreModale, setErroreModale] = useState('');

  const cambiaVista = (v: Vista) => {
    setVista(v);
    salvaVista(v);
  };

  // Click su una colonna nuova → crescente; un secondo click sulla stessa → inverte. Si torna a
  // pagina 1 perché restando a pagina 3 si guarderebbe un insieme diverso da quello ordinato.
  const ordinaPer = (campo: 'nome' | 'tipo') => {
    if (sortBy === campo) setSortOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(campo); setSortOrder('asc'); }
    setPage(1);
  };

  // `isCancelled` chiude la race: se una ricerca/pagina più recente parte prima che questa
  // finisca, la risposta lenta precedente non deve sovrascrivere i risultati nuovi. Pattern
  // preso da useMicrovociProgetto. Le chiamate one-shot (dopo create/azioni) non lo passano.
  const loadClienti = async (isCancelled: () => boolean = () => false) => {
    setLoading(true);
    setErrore('');
    const currentTenantId = getCurrentTenantId();
    let apiList: Cliente[] = [];
    let apiDisponibile = false;
    try {
      const res = await fetchClienti({
        page,
        limit,
        search: searchDebounced,
        sortBy,
        sortOrder,
        tipo: filterType === 'all' ? undefined : filterType,
        portale: filterPortale === 'all' ? undefined : filterPortale,
      });
      if (isCancelled()) return; // risposta stantia: una richiesta più recente è in corso
      if (!isRispostaPaginata<Cliente>(res)) throw new Error('Risposta clienti non valida');
      apiList = res.data.filter((c: any) => !c.tenantId || c.tenantId === currentTenantId);
      apiDisponibile = true;
      setMeta(res.meta);
      if (res.meta.pagine > 0 && page > res.meta.pagine) setPage(res.meta.pagine);
      setRiepilogo((res.riepilogo as { societa: number; persone: number; senzaPortale: number } | undefined) || { societa: 0, persone: 0, senzaPortale: 0 });
    } catch (err) {
      if (isCancelled()) return;
      setErrore(err instanceof Error ? err.message : 'Errore caricamento clienti');
      console.warn('Errore fetch clienti DB:', err);
    }

    // Estrai clienti dai progetti del tenant
    const projStorageKey = getTenantStorageKey('bluman_custom_projects', currentTenantId);
    const localProjStr = localStorage.getItem(projStorageKey);
    // JSON.parse protetto: uno storage corrotto non deve far uscire la funzione prima di
    // setLoading(false), lasciando lo spinner bloccato per sempre.
    let localProjs: any[] = [];
    try { localProjs = localProjStr ? JSON.parse(localProjStr) : []; } catch { localProjs = []; }
    const extractedClients: Cliente[] = [];

    localProjs.forEach((p: any) => {
      if (p.cl) {
        extractedClients.push({
          id: `cl-proj-${p.id}`,
          nome: p.cl,
          tipo: p.ct || 'company',
          // Campi vuoti quando il progetto non li porta, non valori inventati. Qui c'erano
          // una P.IVA, un codice fiscale, una sede a Milano, un codice SDI, un telefono e
          // un'email (`client@holdingbeta.advisory`) scritti nel codice: comparivano
          // nell'anagrafica di ogni cliente ricavato da un progetto, e quell'email finiva
          // precompilata nella finestra del Magic Link — cioè il link di accesso al portale
          // partiva verso una casella che non esiste.
          piva: p.piva || '',
          codiceFiscale: p.codFisc || '',
          sedeLegale: p.sede || '',
          codiceSdi: p.codiceSdi || '',
          email: p.email || '',
          telefono: p.telefono || '',
          isAttivo: true,
        });
      }
    });

    // Includi clienti demo SOLO se è il tenant demo Bluecode Ltd
    const defaultClients: Cliente[] = currentTenantId === BLUECODE_TENANT_ID ? getTenantSeedData(currentTenantId).clients : [];

    const clientStorageKey = getTenantStorageKey('bluman_custom_clients', currentTenantId);
    const localClientsStr = localStorage.getItem(clientStorageKey);
    let localClients: Cliente[] = [];
    try { localClients = localClientsStr ? JSON.parse(localClientsStr) : []; } catch { localClients = []; }

    const mergedMap = new Map();
    // Una pagina DB valida resta una pagina DB: i fallback locali si usano solo se l'API non è disponibile.
    const fontiLocali = !apiDisponibile
      ? [...defaultClients, ...extractedClients, ...localClients]
      : [];
    [...fontiLocali, ...apiList].forEach(c => {
      if (c && c.nome) {
        const key = c.nome.toLowerCase().trim();
        const existing = mergedMap.get(key) || {};
        mergedMap.set(key, { ...existing, ...c });
      }
    });

    const finalClients = Array.from(mergedMap.values()) as Cliente[];
    let visibleClients = finalClients;
    if (!apiDisponibile) {
      const filtroLocale = searchDebounced.toLowerCase();
      visibleClients = finalClients.filter(c => {
        const corrispondeRicerca = !filtroLocale || c.nome.toLowerCase().includes(filtroLocale);
        const corrispondeTipo = filterType === 'all' || c.tipo === filterType;
        return corrispondeRicerca && corrispondeTipo;
      });
      const totale = visibleClients.length;
      const pagine = totale === 0 ? 0 : Math.ceil(totale / limit);
      const paginaEffettiva = pagine === 0 ? 1 : Math.min(page, pagine);
      if (paginaEffettiva !== page) setPage(paginaEffettiva);
      setMeta({ page: paginaEffettiva, limit, totale, pagine });
      setRiepilogo({
        societa: visibleClients.filter(c => c.tipo === 'company').length,
        persone: visibleClients.filter(c => c.tipo === 'individual').length,
        senzaPortale: visibleClients.filter(c => !c.hasPassword).length,
      });
      visibleClients = visibleClients.slice((paginaEffettiva - 1) * limit, paginaEffettiva * limit);
    }
    setClienti(visibleClients);

    // Il Magic Link è il comportamento di `?client=` quando non c'è `azione=anagrafica`.
    if (targetClientQuery && !apriAnagrafica) {
      const found = visibleClients.find(c => c.nome.toLowerCase().includes(targetClientQuery.toLowerCase()) || c.id.includes(targetClientQuery));
      if (found) {
        setMagicLinkModal(found);
      }
    }
    setLoading(false);
  };

  // ── Voce 6 (09/10/2026): l'avviso «messaggio non instradabile» apre l'anagrafica ──────────
  // Si legge **quel** cliente per id (`GET /clienti/:id`), non lo si cerca dentro la lista
  // caricata: il cliente può stare in un'altra pagina, o essere escluso dai filtri attivi, e in
  // quel caso il modale non si aprirebbe proprio — cioè il clic resterebbe un vicolo cieco, che
  // è esattamente il difetto che questa voce chiude. Per lo stesso motivo l'id e non il nome:
  // due clienti possono chiamarsi uguale, e aprire la scheda sbagliata è peggio che non aprire.
  //
  // `apriAnagraficaFatta` è un guardiano, non uno stato: senza, un re-render o un ritorno sulla
  // pagina riaprirebbe il modale che l'operatore ha appena chiuso.
  const apriAnagraficaFatta = useRef(false);
  useEffect(() => {
    if (!apriAnagrafica || !targetClientQuery || apriAnagraficaFatta.current) return;
    apriAnagraficaFatta.current = true;

    let annullato = false;
    fetchCliente(targetClientQuery)
      .then(cliente => {
        if (annullato) return;
        if (cliente) {
          openEditModal(cliente as Cliente);
          return;
        }
        // Il cliente è stato cancellato, o l'id non è di questo tenant (le policy RLS lo
        // nascondono, ed è giusto così). Non si apre un modale vuoto e non si inventa un
        // cliente: si dice che non c'è più, che è l'unica cosa vera.
        toast.attenzione('Il cliente di questo avviso non esiste più: potrebbe essere stato cancellato.');
      })
      .catch(err => {
        if (annullato) return;
        console.warn('Apertura anagrafica da avviso fallita:', err);
        // Il caso più probabile è che il cliente non ci sia più: la rotta risponde 404 quando
        // l'id non esiste **o** quando è di un altro tenant (RLS lo nasconde, giustamente). Non
        // si distingue, perché dal client non si può: si dice che potrebbe non esserci più
        // invece di affermarlo, e non si apre un modale vuoto.
        toast.attenzione("Non è stato possibile aprire l'anagrafica: il cliente potrebbe non esistere più.");
      });

    return () => { annullato = true; };
    // `openEditModal` e `toast` sono ricreati a ogni render e non sono memoizzati: metterli fra
    // le dipendenze farebbe ripartire l'effetto a ogni render. Il guardiano rende comunque
    // l'esecuzione una sola volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apriAnagrafica, targetClientQuery]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setSearchDebounced(search.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let annullato = false;
    loadClienti(() => annullato);
    return () => {
      annullato = true;
    };
  }, [targetClientQuery, page, limit, searchDebounced, filterType, filterPortale, sortBy, sortOrder]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    setSubmitting(true);
    setErroreModale('');
    const newClientObj: Cliente = {
      id: `cl-${Date.now()}`,
      nome: nome.trim(),
      tipo,
      piva: '',
      codiceFiscale: '',
      sedeLegale: '',
      // 'SUBM70N' era il codice destinatario SDI di un'altra azienda, assegnato a ogni nuovo
      // cliente creato: una fattura elettronica indirizzata lì sarebbe finita a loro.
      codiceSdi: '',
      email: '',
      telefono: '',
      isAttivo: true,
    };
    // La creazione DEVE andare a buon fine sul database: se la POST fallisce non si conferma
    // nulla. Prima l'errore veniva solo loggato e la modale si chiudeva salvando in
    // localStorage, così l'operatore credeva di aver creato un cliente che a database non
    // esisteva (compariva solo dal fallback locale).
    try {
      const res = await creaClienteApi({ nome: nome.trim(), tipo });
      if (res && res.id) newClientObj.id = res.id;
    } catch (err) {
      console.error('Errore creazione cliente:', err);
      setErroreModale(
        err instanceof Error ? err.message : 'Impossibile creare il cliente. Riprova.',
      );
      setSubmitting(false);
      return; // modale aperta, nessun salvataggio locale: niente falsa conferma
    }

    // Solo dopo la conferma del database: aggiorna la copia locale, chiudi e ricarica.
    const currentTenantId = getCurrentTenantId();
    const clientStorageKey = getTenantStorageKey('bluman_custom_clients', currentTenantId);
    let savedArr: any[] = [];
    try {
      const savedStr = localStorage.getItem(clientStorageKey);
      savedArr = savedStr ? JSON.parse(savedStr) : [];
    } catch {
      savedArr = []; // storage corrotto: non deve impedire di registrare il nuovo cliente
    }
    localStorage.setItem(clientStorageKey, JSON.stringify([newClientObj, ...savedArr]));

    setNome('');
    setModalOpen(false);
    setSubmitting(false);
    loadClienti();
  };

  const filtered = clienti;

  const totalCompanies = riepilogo.societa;
  const totalIndividuals = riepilogo.persone;

  return (
    <div className={styles.wrapper}>
      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiIcon} style={{ background: 'var(--surface-1)' }}>👥</div>
          <div className={styles.kpiValue}>{meta.totale}</div>
          <div className={styles.kpiLabel}>Totale Clienti in Anagrafica</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiIcon} style={{ background: 'var(--pill-indigo-bg)' }}>🏢</div>
          <div className={styles.kpiValue}>{totalCompanies}</div>
          <div className={styles.kpiLabel}>Società & Entities</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiIcon} style={{ background: 'var(--pill-green-bg)' }}>👤</div>
          <div className={styles.kpiValue}>{totalIndividuals}</div>
          <div className={styles.kpiLabel}>Persone Fisiche / UBO</div>
        </div>
        {/* Cliccabile: è il modo più diretto per arrivare al filtro nuovo, e dice subito quanto
            lavoro resta sulle credenziali. È un <button> e non un <div> perché chi usa la
            tastiera deve poterlo attivare come tutti gli altri comandi. */}
        <button
          type="button"
          className={`${styles.kpiCard} ${styles.kpiCardBtn} ${filterPortale === 'senza' ? styles.kpiCardAttivo : ''}`}
          onClick={() => { setFilterPortale(p => (p === 'senza' ? 'all' : 'senza')); setPage(1); }}
          aria-pressed={filterPortale === 'senza'}
          title="Mostra solo i clienti a cui non è ancora stata assegnata una password del portale"
        >
          <div className={styles.kpiIcon} style={{ background: 'var(--surface-1)' }}>🔑</div>
          <div className={styles.kpiValue} style={{ color: 'var(--amber)' }}>{riepilogo.senzaPortale}</div>
          <div className={styles.kpiLabel}>Senza accesso al portale</div>
        </button>
      </div>

      {/* Toolbar & Search */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <span>🔍</span>
          <input
            type="text"
            placeholder="Cerca cliente per nome o ragione sociale..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className={styles.filterGroup}>
            <button
              className={`${styles.filterBtn} ${filterType === 'all' ? styles.filterBtnActive : ''}`}
              onClick={() => { setFilterType('all'); setPage(1); }}
            >
              Tutti
            </button>
            <button
              className={`${styles.filterBtn} ${filterType === 'individual' ? styles.filterBtnActive : ''}`}
              onClick={() => { setFilterType('individual'); setPage(1); }}
            >
              👤 Persone Fisiche
            </button>
            <button
              className={`${styles.filterBtn} ${filterType === 'company' ? styles.filterBtnActive : ''}`}
              onClick={() => { setFilterType('company'); setPage(1); }}
            >
              🏢 Società
            </button>
          </div>

          {/* La prima etichetta porta il nome del gruppo: senza, un secondo «Tutti» accanto a
              quello dei tipi non direbbe a cosa si riferisce. */}
          <div className={styles.filterGroup}>
            <button
              className={`${styles.filterBtn} ${filterPortale === 'all' ? styles.filterBtnActive : ''}`}
              onClick={() => { setFilterPortale('all'); setPage(1); }}
            >
              Portale: tutti
            </button>
            <button
              className={`${styles.filterBtn} ${filterPortale === 'con' ? styles.filterBtnActive : ''}`}
              onClick={() => { setFilterPortale('con'); setPage(1); }}
            >
              🟢 Con accesso
            </button>
            <button
              className={`${styles.filterBtn} ${filterPortale === 'senza' ? styles.filterBtnActive : ''}`}
              onClick={() => { setFilterPortale('senza'); setPage(1); }}
            >
              ⚪ Senza accesso
            </button>
          </div>

          <div className={styles.viewToggle} role="group" aria-label="Come mostrare i clienti">
            <button
              type="button"
              className={`${styles.viewBtn} ${vista === 'elenco' ? styles.viewBtnAttivo : ''}`}
              aria-pressed={vista === 'elenco'}
              onClick={() => cambiaVista('elenco')}
            >
              ☰ Elenco
            </button>
            <button
              type="button"
              className={`${styles.viewBtn} ${vista === 'schede' ? styles.viewBtnAttivo : ''}`}
              aria-pressed={vista === 'schede'}
              onClick={() => cambiaVista('schede')}
            >
              ▦ Schede
            </button>
          </div>

          <button
            onClick={() => { setErroreModale(''); setModalOpen(true); }}
            className="btn btn-primary"
            style={{ whiteSpace: 'nowrap' }}
          >
            + Nuovo Cliente
          </button>
        </div>
      </div>

      {/* Elenco clienti — due viste sulla stessa lista, la scelta è dell'operatore */}
      {errore && <div style={{ padding: 12, borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)' }}>{errore}</div>}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>Caricamento anagrafica clienti...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div>Nessun cliente trovato con i filtri correnti ({meta.totale} totali in anagrafica).</div>
          <button
            onClick={() => { setSearch(''); setFilterType('all'); setFilterPortale('all'); }}
            className="btn btn-primary"
          >
            ✖ Azzera Filtro Ricerca
          </button>
        </div>
      ) : vista === 'elenco' ? (
        <div className={styles.tableView}>
          <table className={styles.table} aria-label="Elenco clienti">
            <thead>
              <tr>
                <th
                  className={styles.th}
                  aria-sort={sortBy === 'nome' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className={`${styles.thBtn} ${sortBy === 'nome' ? styles.thBtnAttivo : ''}`}
                    onClick={() => ordinaPer('nome')}
                  >
                    Cliente <span className={styles.freccia}>{sortBy === 'nome' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
                <th
                  className={styles.th}
                  aria-sort={sortBy === 'tipo' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className={`${styles.thBtn} ${sortBy === 'tipo' ? styles.thBtnAttivo : ''}`}
                    onClick={() => ordinaPer('tipo')}
                  >
                    Tipo <span className={styles.freccia}>{sortBy === 'tipo' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>
                  </button>
                </th>
                <th className={styles.th}>Accesso Portale</th>
                <th className={styles.th}>Email</th>
                <th className={styles.th}>Telefono</th>
                <th className={styles.th}>P.IVA / C.F.</th>
                <th className={`${styles.th} ${styles.colSede}`}>Sede</th>
                <th className={`${styles.th} ${styles.thAzioni}`}>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                // `cellulare` è la colonna a database, ma `serializzaCliente` distende anche
                // `referentiJson`: il recapito può arrivare da lì, come `telefono`.
                const telefono = c.cellulare || c.telefono || '';
                const piva = c.piva || c.partitaIva || '';
                return (
                  <tr
                    key={c.id}
                    className={styles.tableRow}
                    onClick={() => openEditModal(c)}
                    title="Apri l'anagrafica del cliente"
                  >
                    <td className={styles.td}>
                      <div className={styles.cellNomeBox}>
                        <div className={styles.miniAvatar} style={{ background: c.tipo === 'company' ? 'var(--pill-indigo-bg)' : 'var(--surface-1)', color: c.tipo === 'company' ? 'var(--purple)' : 'var(--indigo-l)' }}>
                          {c.tipo === 'company' ? '🏢' : '👤'}
                        </div>
                        <span className={styles.cellNome}>{c.nome}</span>
                      </div>
                    </td>
                    <td className={styles.td}>
                      <span className={`${styles.pill} ${c.tipo === 'company' ? styles.pillCompany : styles.pillIndividual}`}>
                        {c.tipo === 'company' ? 'Società' : 'Persona'}
                      </span>
                    </td>
                    <td className={styles.td}>
                      {c.hasPassword
                        ? <span className={`${styles.pill} ${styles.pillOn}`}>🟢 Attivo</span>
                        : <span className={`${styles.pill} ${styles.pillOff}`}>⚪ Da assegnare</span>}
                    </td>
                    <td className={styles.td}>{c.email || <span className={styles.vuoto}>—</span>}</td>
                    <td className={styles.td}>{telefono || <span className={styles.vuoto}>—</span>}</td>
                    <td className={styles.td}>
                      {piva || c.codiceFiscale ? (
                        <>
                          <div className={styles.mono}>{piva || '—'}</div>
                          {c.codiceFiscale && c.codiceFiscale !== piva && (
                            <div className={`${styles.mono} ${styles.secondario}`}>{c.codiceFiscale}</div>
                          )}
                        </>
                      ) : <span className={styles.vuoto}>—</span>}
                    </td>
                    <td className={`${styles.td} ${styles.colSede}`}>{c.sedeLegale || <span className={styles.vuoto}>—</span>}</td>
                    {/* Un click qui non deve aprire l'anagrafica: è lo stesso stopPropagation che
                        le schede usavano già. */}
                    <td className={styles.td} onClick={e => e.stopPropagation()}>
                      <div className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => handleGenerateCredentials(c)}
                          disabled={generatingCredentials === c.id}
                          title="Genera username e password per il portale cliente"
                          aria-label={`Genera le credenziali del portale per ${c.nome}`}
                        >
                          {generatingCredentials === c.id ? '⏳' : '🔑'}
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() => setMagicLinkModal(c)}
                          title="Genera un Magic Link di accesso"
                          aria-label={`Genera un Magic Link per ${c.nome}`}
                        >
                          🔗
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.clientGrid}>
          {filtered.map(c => (
            <div
              key={c.id}
              className={styles.clientCard}
              onClick={() => openEditModal(c)}
              style={{ cursor: 'pointer', transition: 'all .2s ease' }}
            >
              <div>
                <div className={styles.clientHeader}>
                  <div className={styles.avatarBox} style={{ background: c.tipo === 'company' ? 'var(--pill-indigo-bg)' : 'var(--surface-1)', color: c.tipo === 'company' ? 'var(--purple)' : 'var(--indigo-l)' }}>
                    {c.tipo === 'company' ? '🏢' : '👤'}
                  </div>
                  <div className={styles.clientHeaderMain}>
                    <div className={styles.clientName} style={{ color: 'var(--indigo-l)' }} title={c.nome}>{c.nome}</div>
                    <span className={styles.clientTypeBadge} style={{ background: c.tipo === 'company' ? 'var(--pill-indigo-bg)' : 'var(--surface-1)', color: c.tipo === 'company' ? 'var(--purple)' : 'var(--indigo-l)' }}>
                      {c.tipo === 'company' ? 'Società / Entity' : 'Persona Fisica'}
                    </span>
                  </div>
                  {/* Era una riga dentro un riquadro bordato, con sopra l'UUID del cliente. Qui sta
                      in alto a destra e porta anche il TESTO, così si legge senza dover
                      distinguere i colori. */}
                  <span className={`${styles.pill} ${c.hasPassword ? styles.pillOn : styles.pillOff}`}>
                    {c.hasPassword ? '🟢 Attivo' : '⚪ Da assegnare'}
                  </span>
                </div>

                {/* Solo i dati che ci sono: una scheda con tre trattini è peggio di una scheda più
                    corta. L'UUID del cliente non compare: a un operatore non serve a niente. */}
                {(c.email || c.cellulare || c.telefono || c.piva || c.partitaIva) && (
                  <div className={styles.clientMeta}>
                    {c.email && (
                      <div className={styles.metaItem}><span>✉️</span><span title={c.email}>{c.email}</span></div>
                    )}
                    {(c.cellulare || c.telefono) && (
                      <div className={styles.metaItem}><span>☎</span><span>{c.cellulare || c.telefono}</span></div>
                    )}
                    {(c.piva || c.partitaIva) && (
                      <div className={styles.metaItem}><span>P.IVA</span><span className={styles.mono}>{c.piva || c.partitaIva}</span></div>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.clientActions} onClick={e => e.stopPropagation()}>
                <button className={styles.btnAction} onClick={() => openEditModal(c)} style={{ background: 'var(--pill-indigo-bg)', borderColor: 'var(--indigo-d)', color: 'var(--pill-indigo-fg)', fontWeight: 700 }} title="Apri Fascicolo Anagrafica & Commesse">
                  📂 Apri
                </button>
                <button
                  className={styles.btnAction}
                  onClick={() => handleGenerateCredentials(c)}
                  disabled={generatingCredentials === c.id}
                  style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  title="Genera username e password per il portale cliente"
                >
                  {generatingCredentials === c.id ? '⏳ ...' : '🔑 Portale'}
                </button>
                <button className={styles.btnAction} onClick={() => setMagicLinkModal(c)} title="Genera un Magic Link di accesso">
                  🔗 Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Paginatore
        meta={meta}
        onPageChange={setPage}
        onLimitChange={(nuovoLimite) => { setLimit(nuovoLimite); setPage(1); }}
      />

      {/* Modal Nuovo Cliente */}
      {modalOpen && (
        <Modal onClose={() => { setModalOpen(false); setErroreModale(''); }} overlayBackground="rgba(0,0,0,.7)" zIndex={100} labelledBy="titolo-nuovo-cliente">
          {(richiediChiusura) => (
          <form onSubmit={handleCreate} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div id="titolo-nuovo-cliente" style={{ fontSize: 15, fontWeight: 600 }}>Nuovo Cliente Anagrafica</div>
            <div>
              <label htmlFor="clip-nome" style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Nome / Ragione Sociale *</label>
              <input id="clip-nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="es. Giuseppe Rossi / Acme S.r.l." required />
            </div>
            <div>
              <label id="clip-tipo-label" style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tipo Cliente *</label>
              <div role="group" aria-labelledby="clip-tipo-label" style={{ display: 'flex', gap: 8 }}>
                {(['individual', 'company'] as const).map(t => (
                  <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)} style={{ flex: 1, padding: 8, borderRadius: 8, border: `1px solid ${tipo === t ? 'var(--indigo)' : 'var(--border)'}`, background: tipo === t ? 'var(--surface-1)' : 'var(--card)', color: tipo === t ? 'var(--indigo-l)' : 'var(--muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                    {t === 'individual' ? '👤 Persona fisica' : '🏢 Società'}
                  </button>
                ))}
              </div>
            </div>
            {erroreModale && (
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--pill-red-bg)', color: 'var(--pill-red-fg)', fontSize: 12 }}>
                {erroreModale}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={richiediChiusura} className="btn btn-secondary">Annulla</button>
              <button type="submit" disabled={submitting} className="btn btn-primary">{submitting ? 'Salvataggio...' : '✓ Salva Cliente'}</button>
            </div>
          </form>
          )}
        </Modal>
      )}

      {/* Modal Anagrafica Completa Cliente ERP (§Gestionale) */}
      {editClientModal && (
        <AnagraficaErpModal
          client={editClientModal}
          onClose={() => setEditClientModal(null)}
          onSaved={() => {
            setEditClientModal(null);
            loadClienti();
          }}
        />
      )}

      {/* Modal Magic Link & Accettazione Cliente */}
      {magicLinkModal && (
        <MagicLinkExplainModal client={magicLinkModal} onClose={() => setMagicLinkModal(null)} />
      )}

      {/* Modal Credenziali Portale Cliente (Email + Password) */}
      {credentialsModal && (
        <CredentialsExplainModal
          data={credentialsModal}
          onClose={() => setCredentialsModal(null)}
        />
      )}
    </div>
  );
}

