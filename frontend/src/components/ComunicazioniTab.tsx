import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchComunicazioniApi, inviaComunicazioneApi, segnaComunicazioniLetteApi, fetchClienti, sendWhatsAppDirectApi, sendEmailDirectApi, sendSignalDirectApi, sendTelegramDirectApi, fetchInboundImapEmailsApi, fetchInboundImapAllegatiApi, fetchTenantInfoApi, uploadFileApi, urlDocumentoAssoluto } from '../api/client';
import { downloadGuidePdf } from '../utils/pdfGenerator';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, BLUECODE_TENANT_ID } from '../utils/tenant';
import { SpunteStato } from './SpunteStato';
import type { Cliente } from '../types';
import { useToast } from './ui/ToastProvider';

export interface MessaggioComunicazione {
  id: string;
  canale: 'email' | 'whatsapp' | 'telegram' | 'signal' | 'portal';
  mittente: string;
  destinatario: string;
  direzione: 'entrata' | 'uscita';
  testo: string;
  dataOra: string;
  allegati?: { nome: string; url: string; dimensione: string }[];
  /**
   * Lo stato di recapito, quello vero.
   *
   * `null` è un valore legittimo e significa «la riga non lo dichiara». Prima non c'era: il
   * ripiego era `'consegnato'`, quindi una riga muta diventava una consegna dichiarata, e la
   * timeline disegnava le spunte blu su messaggi che nessun canale aveva accettato.
   */
  stato?: 'da-inviare' | 'inviato' | 'consegnato' | 'letto' | 'non-inviato' | null;
  inviatoAt?: string | null;
  lettoAt?: string | null;
  consegnatoAt?: string | null;
  /** Il motivo del rifiuto, quando `stato` è `non-inviato`. */
  errore?: string | null;
}

export interface ComunicazioniTabProps {
  progettoId: string | number;
  nomeCliente: string;
  emailCliente?: string;
  cliente?: Cliente | null;
}

export function cleanDisplayEmailText(raw: string): string {
  if (!raw) return '';
  let str = raw;

  if (str.includes('Content-Type: text/plain') || str.includes('Content-Type:text/plain')) {
    const plainSection = str.split(/Content-Type:\s*text\/plain[^\r\n]*/i)[1];
    if (plainSection) {
      const beforeBoundary = plainSection.split(/\r?\n--/)[0];
      str = beforeBoundary.replace(/^[\s\S]*?\r?\n\r?\n/, '');
    }
  } else if (str.includes('Content-Type: text/html') || str.includes('Content-Type:text/html')) {
    const htmlSection = str.split(/Content-Type:\s*text\/html[^\r\n]*/i)[1];
    if (htmlSection) {
      const beforeBoundary = htmlSection.split(/\r?\n--/)[0];
      str = beforeBoundary.replace(/^[\s\S]*?\r?\n\r?\n/, '').replace(/<[^>]+>/g, ' ');
    }
  }

  str = str
    .replace(/=\r?\n/g, '')
    .replace(/=3D/gi, '=')
    .replace(/=20/g, ' ')
    .replace(/=E2=80=99/g, "'")
    .replace(/=E2=80=94/g, "—")
    .replace(/=E2=80=A2/g, "•")
    .replace(/=C3=A0/g, "à")
    .replace(/=C3=A8/g, "è")
    .replace(/=C3=A9/g, "é")
    .replace(/=C3=AC/g, "ì")
    .replace(/=C3=B2/g, "ò")
    .replace(/=C3=B9/g, "ù");

  str = str.replace(/--[a-zA-Z0-9_-]{10,}/g, '');
  str = str.replace(/Content-Transfer-Encoding:[^\r\n]*/gi, '');
  str = str.replace(/Content-Type:[^\r\n]*/gi, '');

  const lines = str.split(/\r?\n/);
  const cleanLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>') || trimmed.startsWith('&gt;')) continue;
    if (/^Il giorno .+ ha scritto:?$/i.test(trimmed)) break;
    if (/^On .+ wrote:?$/i.test(trimmed)) break;
    if (/^In data .+ ha scritto:?$/i.test(trimmed)) break;
    if (trimmed.includes('--- Messaggio Originale ---')) break;
    if (trimmed.includes('________________________________')) break;
    cleanLines.push(line);
  }

  const result = cleanLines.join('\n').trim();
  return result || raw;
}

export function ComunicazioniTab({ progettoId, nomeCliente, emailCliente, cliente }: ComunicazioniTabProps) {
  const toast = useToast();
  const [clientData, setClientData] = useState<Cliente | null>(cliente || null);
  const [tenantSettings, setTenantSettings] = useState<any>(null);

  // Carica i dati delle impostazioni Studio (Canali di Invio Ufficiali Admin)
  useEffect(() => {
    const loadTenant = async () => {
      const dbTenant = await fetchTenantInfoApi();
      if (dbTenant) {
        setTenantSettings(dbTenant);
      } else {
        const local = localStorage.getItem(getTenantStorageKey('bluman_tenant_info'));
        if (local) {
          try { setTenantSettings(JSON.parse(local)); } catch {}
        }
      }
    };
    loadTenant();
  }, []);

  const studioChannels = useMemo(() => {
    const currentTenantId = getCurrentTenantId();
    const isBC = currentTenantId === BLUECODE_TENANT_ID;
    const studio = getStudioInfoForTenant(currentTenantId);
    return {
      whatsapp: tenantSettings?.telefono || studio.telefono || (isBC ? '+39 378 092 6461' : ''),
      email: tenantSettings?.smtpFromEmail || tenantSettings?.email || studio.email || (isBC ? 'comunicazioni@bluecode.advisory' : ''),
      // Niente ripiego scritto in duro: qui c'era `'@BluManStudioBot'`, e quel nome su Telegram **non
      // esiste** (verificato: `t.me/BluManStudioBot` non risolve). L'etichetta della tendina lo
      // mostrava come se fosse il bot dello studio, e un operatore che lo legge può dettarlo a un
      // cliente: è la stessa bugia del link rotto, un passo prima. Se lo studio non ha lo username
      // salvato, la riga resta vuota — che è la verità (regola 7).
      telegram: tenantSettings?.tgBotUsername || '',
      signal: tenantSettings?.telefono || studio.telefono || (isBC ? '+39 378 092 6461' : ''),
      portal: 'portal',
    };
  }, [tenantSettings]);

  // Carica i dati dell'anagrafica cliente (DB, localStorage o mock)
  useEffect(() => {
    if (cliente) {
      setClientData(cliente);
      return;
    }

    const resolveClient = async () => {
      // 1. Cerca nei clienti custom locali
      const localStr = localStorage.getItem('bluman_custom_clients');
      const localClients: Cliente[] = localStr ? JSON.parse(localStr) : [];
      let found = localClients.find(c =>
        c.nome.toLowerCase().trim() === (nomeCliente || '').toLowerCase().trim() ||
        c.id === (cliente as any)?.id
      );

      // 2. Cerca via API Fastify / PostgreSQL
      if (!found) {
        try {
          const apiList = await fetchClienti();
          if (Array.isArray(apiList)) {
            found = apiList.find(c =>
              c.nome.toLowerCase().trim() === (nomeCliente || '').toLowerCase().trim()
            );
          }
        } catch (e) {
          console.warn('Fallback caricamento cliente anagrafica:', e);
        }
      }

      if (found) {
        setClientData(found);
      }
    };

    resolveClient();
  }, [cliente, nomeCliente, emailCliente]);

  // Estrazione dinamica recapiti dall'anagrafica cliente ERP
  const contactInfo = useMemo(() => {
    const refJson: any = clientData?.referentiJson && typeof clientData.referentiJson === 'object' ? clientData.referentiJson : {};

    // Nessun recapito inventato. Qui c'erano un'email (`client@holdingbeta...`), un numero
    // di cellulare (+39 333 59...) usato sia per WhatsApp sia per Signal e un handle Telegram
    // costruito dal nome del cliente: quando l'anagrafica era incompleta il messaggio partiva
    // verso quei recapiti, cioè verso persone estranee al fascicolo, e l'interfaccia diceva
    // «recapitato con successo». Un recapito che non c'è resta vuoto e blocca l'invio.
    const email = clientData?.email || refJson.email || emailCliente || '';
    // Gli stessi recapiti che legge il backend, o il canale risulta disponibile qui e non là.
    // `telefono` non è un numero WhatsApp — può essere un fisso, e il backend lo rifiuta per
    // questo: lasciarlo passare qui significava offrire un canale che Meta avrebbe respinto.
    const whatsapp = clientData?.cellulare || refJson.cellulare || refJson.whatsapp || '';
    // La chat id, non `@username`: è quello che `sendMessage` vuole, ed è il campo che
    // l'anagrafica ha davvero (`telegramChatId`).
    const telegram = clientData?.telegramChatId || refJson.telegramChatId || '';
    // Signal non ha una colonna sua: il recapito vive in `referentiJson.signal`, come legge
    // `recapitiCliente` lato server. Non ricade su cellulare e telefono: il numero deve avere un
    // account Signal, e presumere che ce l'abbia manda il messaggio nel vuoto — o a chi quel
    // numero lo ha come normale SIM.
    const signal = refJson.signal || '';
    const referente = clientData?.referenteNome || refJson.referenteNome || refJson.referente || clientData?.ubo || nomeCliente || 'Referente Incarico';

    return {
      email,
      whatsapp,
      telegram,
      signal,
      referente,
    };
  }, [clientData, nomeCliente, emailCliente]);

  const [messaggi, setMessaggi] = useState<MessaggioComunicazione[]>(() => {
    const saved = localStorage.getItem(`bluman_msgs_${progettoId}`);
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return [
      {
        id: `msg-welcome-${progettoId}`,
        canale: 'whatsapp',
        mittente: `${contactInfo.whatsapp} (${contactInfo.referente})`,
        destinatario: 'Studio Advisory (+356 79001122)',
        direzione: 'entrata',
        testo: `Buongiorno Studio, confermiamo l'avvio delle attività per la pratica ${nomeCliente || 'Incarico'}. Restiamo a disposizione per i dettagli.`,
        dataOra: new Date().toLocaleDateString('it-IT'),
      }
    ];
  });

  const [nuovoTesto, setNuovoTesto] = useState('');
  const [canaleSelezionato, setCanaleSelezionato] = useState<'email' | 'whatsapp' | 'telegram' | 'signal' | 'portal'>('whatsapp');
  const [filtroCanale, setFiltroCanale] = useState<string>('TUTTI');
  const [customDestEmail, setCustomDestEmail] = useState('');
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [inviando, setInviando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'err'; testo: string } | null>(null);
  // §35 — la lettura IMAP passa dal backend e apre una connessione alla casella dello studio:
  // farla a ogni giro del polling da 5 s significherebbe una sessione IMAP ogni 5 secondi per
  // ogni scheda aperta. I messaggi già salvati si rileggono a 5 s, la posta in arrivo a 60 s.
  const ultimaLetturaImap = useRef(0);
  const [erroreImap, setErroreImap] = useState<string | null>(null);
  const [fileAllegato, setFileAllegato] = useState<{ nome: string; base64: string; sizeStr: string; mime: string } | null>(null);
  const [caricandoFile, setCaricandoFile] = useState(false);
  const [sincronizzandoAllegati, setSincronizzandoAllegati] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Smart Chat Scroll & Unread Marker
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unreadMarkerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [initialScrollDone, setInitialScrollDone] = useState(false);

  const loadComunicazioni = async (opzioni: { conImap?: boolean } = {}): Promise<string | null> => {
    // Restituisce il motivo per cui la posta in arrivo non è stata letta (null se tutto ok):
    // il chiamante non può leggerlo dallo stato, che nella sua closure è ancora quello vecchio.
    let motivoImap: string | null = null;
    setLoadingMsgs(true);
    try {
      // 1. Recupero messaggi già salvati su DB Fastify / Supabase
      const dbMsgs = await fetchComunicazioniApi(String(progettoId));
      let currentList: MessaggioComunicazione[] = [];
      if (dbMsgs && Array.isArray(dbMsgs) && dbMsgs.length > 0) {
        currentList = dbMsgs.map((m: any) => ({
          ...m,
          dataOra: m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : (m.dataOra || 'Oggi'),
          allegati: m.allegatiJson ? (typeof m.allegatiJson === 'string' ? JSON.parse(m.allegatiJson) : m.allegatiJson) : m.allegati,
          // `?? null` e non `|| 'consegnato'`: una riga che non dichiara lo stato non ne riceve
          // uno dal browser. Era questo il punto in cui la consegna veniva inventata (regola 7).
          stato: m.stato ?? null,
          inviatoAt: m.inviatoAt || null,
          lettoAt: m.lettoAt || null,
          consegnatoAt: m.consegnatoAt || null,
          errore: m.errore || null,
        }));
      } else {
        const saved = localStorage.getItem(`bluman_msgs_${progettoId}`);
        if (saved) {
          try { currentList = JSON.parse(saved); } catch {}
        }
      }

      // 2. Ingestion Live IMAP: Controlla risposte reali arrivate alla casella di posta
      const targetEmail = customDestEmail.trim() || contactInfo.email;
      const adesso = Date.now();
      const imapDaFare = opzioni.conImap !== false && adesso - ultimaLetturaImap.current >= 60000;
      if (imapDaFare) {
        ultimaLetturaImap.current = adesso;
        // La rotta risponde `{ ok, email, errore }`: quando la casella non è configurata o il
        // login fallisce il motivo si mostra, non si finge una casella vuota (regola 7).
        const esito = await fetchInboundImapEmailsApi(targetEmail);
        motivoImap = esito.ok ? null : (esito.errore || 'Lettura della posta in arrivo non riuscita.');
        setErroreImap(motivoImap);
        const inboundEmails = Array.isArray(esito.email) ? esito.email : [];
        for (const mail of inboundEmails) {
          const alreadyExists = currentList.some(
            m => m.testo?.trim() === mail.text?.trim() || m.id === mail.id
          );

          if (!alreadyExists) {
            const newInboundMsg: MessaggioComunicazione = {
              id: mail.id || `msg-inbound-${Date.now()}`,
              canale: 'email',
              mittente: mail.from,
              destinatario: (mail as any).to || targetEmail || "Casella dello studio",
              direzione: 'entrata',
              testo: mail.text,
              dataOra: mail.date,
              stato: 'consegnato',
            };

            currentList.push(newInboundMsg);

            // Persiste automaticamente l'email in entrata a database
            inviaComunicazioneApi(String(progettoId), {
              canale: 'email',
              mittente: mail.from,
              destinatario: (mail as any).to || targetEmail || "Casella dello studio",
              direzione: 'entrata',
              testo: mail.text,
            }).catch(() => {});
          }
        }
      }

      if (currentList.length > 0) {
        setMessaggi(currentList);
        localStorage.setItem(`bluman_msgs_${progettoId}`, JSON.stringify(currentList));

        // Segna automaticamente come letti i messaggi in entrata visualizzati dall'operatore
        const haDaLeggere = currentList.some(m => m.direzione === 'entrata' && m.stato !== 'letto');
        if (haDaLeggere) {
          segnaComunicazioniLetteApi(String(progettoId), 'entrata').catch(() => {});
        }
      }
    } catch (err) {
      motivoImap = motivoImap || `Sincronizzazione non riuscita: ${err instanceof Error ? err.message : 'errore di rete'}.`;
    }
    setLoadingMsgs(false);
    return motivoImap;
  };

  useEffect(() => {
    loadComunicazioni();
    // Polling portato da 5s a 30s (audit 21/09/2026): ogni giro è una query sulla tabella
    // comunicazione_progetto — che ora ha un indice, ma con la RLS resta cara — moltiplicata
    // per ogni chat aperta. 30s riduce di 6× il carico mantenendo l'aggiornamento percepito.
    // TODO: sostituire il polling con la sottoscrizione all'SSE /stream già esposto dal backend.
    const interval = setInterval(() => {
      loadComunicazioni();
    }, 30000);
    return () => clearInterval(interval);
  }, [progettoId]);

  useEffect(() => {
    if (!chatContainerRef.current || messaggi.length === 0) return;
    if (!initialScrollDone) {
      if (unreadMarkerRef.current) {
        unreadMarkerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }
      setInitialScrollDone(true);
    } else {
      const el = chatContainerRef.current;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distFromBottom < 160) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messaggi.length]);

  const handleChatScroll = () => {
    if (!chatContainerRef.current) return;
    const el = chatContainerRef.current;
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 140;
    setShowScrollBottom(isUp);
  };

  const sincronizzaAllegatiImap = async () => {
    setSincronizzandoAllegati(true);
    try {
      const targetEmail = customDestEmail.trim() || contactInfo.email;
      const esito = await fetchInboundImapAllegatiApi(targetEmail);
      if (!esito.ok) {
        setFeedback({ tipo: 'err', testo: `Allegati IMAP: ${esito.errore || 'lettura non riuscita'}` });
        setTimeout(() => setFeedback(null), 5000);
        return;
      }
      if (!esito.email || esito.email.length === 0) {
        setFeedback({ tipo: 'ok', testo: 'Nessuna nuova email con allegati trovata nella casella.' });
        setTimeout(() => setFeedback(null), 3500);
        return;
      }
      let contatoreNuovi = 0;
      for (const item of esito.email) {
        const alreadyExists = messaggi.some(
          m => m.testo?.trim() === item.text?.trim() || m.id === item.id
        );
        if (!alreadyExists && item.allegati?.length) {
          await inviaComunicazioneApi(String(progettoId), {
            canale: 'email',
            mittente: item.from,
            destinatario: item.to || targetEmail || "Casella dello studio",
            direzione: 'entrata',
            testo: item.text,
            allegatiJson: item.allegati,
          });
          contatoreNuovi++;
        }
      }
      await loadComunicazioni({ conImap: false });
      setFeedback({ tipo: 'ok', testo: `✓ Sincronizzazione allegati: ${contatoreNuovi} email con allegati importate!` });
      setTimeout(() => setFeedback(null), 4000);
    } catch (e: any) {
      setFeedback({ tipo: 'err', testo: `Errore allegati IMAP: ${e?.message || 'errore imprevisto'}` });
      setTimeout(() => setFeedback(null), 5000);
    } finally {
      setSincronizzandoAllegati(false);
    }
  };

  const handleInviaMessaggio = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!nuovoTesto.trim() && !fileAllegato) || inviando || caricandoFile) return;
    setInviando(true);
    setFeedback(null);

    let allegatiCaricati: any[] | undefined;
    if (fileAllegato) {
      setCaricandoFile(true);
      try {
        const resUpload = await uploadFileApi(fileAllegato.nome, fileAllegato.base64);
        if (resUpload && resUpload.url) {
          allegatiCaricati = [{
            nome: resUpload.name || fileAllegato.nome,
            url: resUpload.url,
            dimensione: resUpload.size || fileAllegato.sizeStr,
            mime: fileAllegato.mime,
          }];
        }
      } catch (errUp) {
        console.warn('Errore upload allegato:', errUp);
      } finally {
        setCaricandoFile(false);
      }
    }

    const testoDaInviare = nuovoTesto.trim() || (allegatiCaricati ? `[Allegato: ${allegatiCaricati[0].nome}]` : '');
    // Chi ha fatto l'accesso, non 'Joe Disabato (Senior Advisor)' scritto nel codice: il
    // registro delle comunicazioni attribuiva a lui ogni messaggio, da qualunque operatore.
    const utenteStr = typeof window !== 'undefined' ? localStorage.getItem('bluman_user') : null;
    const utente = utenteStr ? (() => { try { return JSON.parse(utenteStr); } catch { return null; } })() : null;
    const mittente = utente?.nome ? `${utente.nome}${utente.email ? ` (${utente.email})` : ''}` : (utente?.email || 'Studio');
    let destinatario = '';
    switch (canaleSelezionato) {
      case 'whatsapp':
        destinatario = `${contactInfo.referente} (${contactInfo.whatsapp})`;
        break;
      case 'email':
        destinatario = customDestEmail.trim() || contactInfo.email;
        break;
      case 'telegram':
        destinatario = `${contactInfo.telegram} (${contactInfo.referente})`;
        break;
      case 'signal':
        destinatario = `${contactInfo.referente} (${contactInfo.signal})`;
        break;
      case 'portal':
        destinatario = contactInfo.referente || nomeCliente;
        break;
      default:
        destinatario = `Cliente (${nomeCliente})`;
    }

    const nuovoMsg: MessaggioComunicazione = {
      id: `msg-${Date.now()}`,
      canale: canaleSelezionato,
      mittente,
      destinatario,
      direzione: 'uscita',
      testo: testoDaInviare,
      dataOra: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      allegati: allegatiCaricati || [],
      // Il portale è l'unico canale che non ha un passo di consegna dopo la scrittura: il
      // messaggio è «arrivato» nell'istante in cui compare nel portale del cliente. Per tutti gli
      // altri la riga nasce in attesa, ed è il dispatch a dire com'è finita.
      stato: canaleSelezionato === 'portal' ? 'consegnato' : 'da-inviare',
    };

    setMessaggi(prev => [...prev, nuovoMsg]);
    setNuovoTesto('');
    setFileAllegato(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // L'esito del dispatch, per il messaggio che si sta guardando: senza, l'operatore vedrebbe
    // «in attesa» finché non ricarica il fascicolo, anche quando l'invio è già fallito.
    let esitoInvio: { stato: 'inviato' | 'non-inviato'; errore?: string } | null = null;

    try {
      // 1. Persistenza su Backend Fastify / Supabase
      const riga = await inviaComunicazioneApi(String(progettoId), {
        canale: canaleSelezionato,
        mittente,
        destinatario,
        direzione: 'uscita',
        testo: testoDaInviare,
        ...(allegatiCaricati ? { allegatiJson: allegatiCaricati } : {}),
      });

      // L'id della riga appena creata accompagna ogni dispatch: è ciò che permette al backend di
      // annotare sul fascicolo com'è andata, invece di lasciarlo per sempre in attesa.
      const comunicazioneId: string | undefined = riga?.id ? String(riga.id) : undefined;

      // 2. Se Email, invio reale tramite la rotta autenticata POST /comunicazioni/invia-email
      //    (§35: le credenziali SMTP le legge il backend dalla riga Tenant, il browser non le vede)
      if (canaleSelezionato === 'email') {
        // Qui il ripiego era la casella dello studio: senza email in anagrafica il messaggio
        // destinato al cliente arrivava allo studio stesso, e il riscontro diceva «recapitata
        // con successo alla casella support@...». Meglio fermarsi e dirlo.
        const destEmail = (customDestEmail || contactInfo.email || emailCliente || '').trim();
        if (!destEmail) {
          setFeedback({ tipo: 'err', testo: `Nessuna email per ${nomeCliente || 'il cliente'}: scrivila nel campo destinatario o compila l'anagrafica.` });
          setInviando(false);
          return;
        }
        const res = await sendEmailDirectApi(
          destEmail,
          `💬 Comunicazione Studio BlueCode Advisory — Fascicolo ${nomeCliente || 'Pratica'}`,
          testoDaInviare,
          undefined,
          comunicazioneId
        );
        if (res && res.success) {
          esitoInvio = { stato: 'inviato' };
          setFeedback({ tipo: 'ok', testo: `✓ Email recapitata con successo alla casella ${destEmail}!` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: res?.errore };
          setFeedback({ tipo: 'err', testo: `❌ Errore Invio Email: ${res?.errore || 'Verifica la password SMTP in Impostazioni'}` });
        }
      } else if (canaleSelezionato === 'whatsapp') {
        // 3. Se WhatsApp, dispatch tramite POST /comunicazioni/invia-whatsapp: il token Meta
        // e il phone id sono quelli dello studio corrente, non variabili d'ambiente condivise.
        // Il numero era `|| '<un numero scritto nel codice>'`: senza cellulare in anagrafica il
        // messaggio del cliente partiva verso il telefono personale del titolare. E quando l'invio
        // falliva, il ripiego spediva il template di esempio `hello_world` e annunciava «Notifica
        // consegnata»: al destinatario arrivava «Hello World», all'operatore un successo.
        const cleanPhone = (contactInfo.whatsapp || '').replace(/\D/g, '');
        if (!cleanPhone) {
          setFeedback({ tipo: 'err', testo: `Nessun cellulare in anagrafica per ${nomeCliente || 'il cliente'}: WhatsApp non può partire.` });
          setInviando(false);
          return;
        }
        const res = await sendWhatsAppDirectApi(cleanPhone, testoDaInviare, undefined, comunicazioneId);
        if (res && res.success) {
          esitoInvio = { stato: 'inviato' };
          // «Accettato da Meta», non «recapitato»: la consegna al telefono la conferma il webhook
          // di stato, ed è quello che fa comparire le due spunte. Qui Meta ha solo preso in carico.
          setFeedback({ tipo: 'ok', testo: `✓ WhatsApp ha accettato il messaggio per ${contactInfo.whatsapp}: la consegna al telefono arriva dopo.` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: res?.errore };
          setFeedback({ tipo: 'err', testo: `WhatsApp non ha accettato l'invio verso ${contactInfo.whatsapp}: ${res?.errore || 'motivo non riportato'}. Il messaggio resta nel registro del fascicolo.` });
        }
      } else if (canaleSelezionato === 'signal') {
        // 4. Signal: dispatch tramite POST /comunicazioni/invia-signal, col demone dello studio.
        // Questo ramo non c'era, e la sua assenza era il difetto peggiore della chat: Signal era
        // una voce dell'elenco e sceglierlo faceva cadere il flusso nell'`else` finale, che
        // rispondeva «Messaggio registrato e notificato via SIGNAL al cliente!». Nessun demone
        // veniva contattato: il cliente non riceveva niente e l'operatore credeva di sì.
        const destSignal = (contactInfo.signal || '').trim();
        if (!destSignal) {
          setFeedback({ tipo: 'err', testo: `Nessun numero Signal per ${nomeCliente || 'il cliente'}: indicane uno in forma internazionale fra i referenti dell'anagrafica.` });
          setInviando(false);
          return;
        }
        if (!/^(\+|00)[1-9][\d\s.\-()]{6,}$/.test(destSignal)) {
          // Il backend rifiuta comunque un numero senza prefisso, ma qui si dice *prima*: senza
          // il `+39`, `3351234567` diventerebbe `+3351234567`, cioè un numero francese.
          setFeedback({ tipo: 'err', testo: `Il numero Signal ${destSignal} non è in forma internazionale: serve il prefisso, per esempio +393351234567.` });
          setInviando(false);
          return;
        }
        const resSignal = await sendSignalDirectApi(
          destSignal,
          testoDaInviare,
          fileAllegato ? [{ nome: fileAllegato.nome, base64: fileAllegato.base64 }] : undefined,
          comunicazioneId,
        );
        if (resSignal && resSignal.success) {
          esitoInvio = { stato: 'inviato' };
          setFeedback({ tipo: 'ok', testo: `✓ Il demone Signal ha accettato il messaggio per ${destSignal}.` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: resSignal?.errore };
          setFeedback({ tipo: 'err', testo: `Signal non ha accettato l'invio verso ${destSignal}: ${resSignal?.errore || 'motivo non riportato'}. Il messaggio resta nel registro del fascicolo.` });
        }
      } else if (canaleSelezionato === 'telegram') {
        // 5. Telegram: stessa storia di Signal. La chiamata al Bot API era privata dentro
        // `otpDispatch.ts`, quindi non raggiungibile da qui, e il ramo mancante finiva nell'`else`
        // che annunciava la consegna. Ora la chiamata sta in `telegramService.ts` e c'è una rotta.
        const destTelegram = (contactInfo.telegram || '').trim();
        if (!destTelegram) {
          setFeedback({ tipo: 'err', testo: `Nessuna chat Telegram per ${nomeCliente || 'il cliente'}: il cliente deve prima scrivere al bot dello studio, poi la chat id va in anagrafica.` });
          setInviando(false);
          return;
        }
        if (!/^-?\d{5,20}$/.test(destTelegram)) {
          setFeedback({ tipo: 'err', testo: `«${destTelegram}» non è una chat Telegram: serve l'identificativo numerico, quello che il bot riceve quando il cliente gli scrive.` });
          setInviando(false);
          return;
        }
        const resTelegram = await sendTelegramDirectApi(destTelegram, testoDaInviare, comunicazioneId);
        if (resTelegram && resTelegram.success) {
          esitoInvio = { stato: 'inviato' };
          setFeedback({ tipo: 'ok', testo: `✓ Telegram ha accettato il messaggio per la chat ${destTelegram}.` });
        } else {
          esitoInvio = { stato: 'non-inviato', errore: resTelegram?.errore };
          setFeedback({ tipo: 'err', testo: `Telegram non ha accettato l'invio: ${resTelegram?.errore || 'motivo non riportato'}. Il messaggio resta nel registro del fascicolo.` });
        }
      } else if (canaleSelezionato === 'portal') {
        // 6. Portale Riservato: il messaggio è già stato persistito a database al punto 1.
        // Non serve nessun dispatch esterno: il polling del TabContatti (5 s) lo mostrerà
        // al cliente senza che ricarichi la pagina. Il badge del canale lo distingue dagli
        // altri nella timeline.
        setFeedback({ tipo: 'ok', testo: `✓ Messaggio inviato sul Portale Riservato di ${contactInfo.referente || nomeCliente}: visibile al cliente entro 5 secondi.` });
      }

      // L'esito vero sul messaggio che si sta guardando: senza questo la riga appena spedita
      // resterebbe «in attesa» fino al prossimo caricamento del fascicolo.
      if (esitoInvio) {
        const esito = esitoInvio;
        setMessaggi(prev =>
          prev.map(x =>
            x.id === nuovoMsg.id
              ? { ...x, stato: esito.stato, errore: esito.stato === 'inviato' ? null : esito.errore || 'motivo non riportato' }
              : x,
          ),
        );
      }
    } catch (err) {
      // Prima ogni errore diventava «✓ Messaggio salvato nel registro del progetto!»: il
      // riscontro verde compariva anche quando la richiesta non era mai arrivata al server.
      console.warn('Errore invio comunicazione:', err);
      setFeedback({ tipo: 'err', testo: `Invio non riuscito: ${err instanceof Error ? err.message : 'errore di rete'}. Il messaggio è visibile qui ma potrebbe non essere stato registrato.` });
    } finally {
      setInviando(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  // Il segno di recapito non si disegna qui: sta in `SpunteStato`, condiviso con il portale.
  // Prima le due chat ne avevano una copia ciascuna, con la stessa bugia nel ramo finale.
  const getCanaleBadge = (canale: string) => {    switch (canale) {
      case 'email': return { icon: '✉️', label: 'Email Inbound/Outbound', bg: 'var(--pill-indigo-bg)', color: 'var(--indigo-l)' };
      case 'whatsapp': return { icon: '🟢', label: 'WhatsApp Business', bg: 'var(--pill-green-bg)', color: 'var(--pill-green-fg)' };
      case 'telegram': return { icon: '✈️', label: 'Telegram Bot Webhook', bg: 'var(--pill-sky-bd)', color: 'var(--cat-societario)' };
      case 'signal': return { icon: '🔒', label: 'Signal End-to-End Cifrato', bg: 'var(--pill-indigo-bg)', color: 'var(--pill-indigo-fg)' };
      case 'portal': return { icon: '🌐', label: 'Portale Riservato', bg: 'var(--surface-1)', color: 'var(--indigo)' };
      default: return { icon: '💬', label: canale, bg: 'var(--card2)', color: 'var(--muted)' };
    }
  };

  const getCurrentChannelDetails = () => {
    switch (canaleSelezionato) {
      case 'whatsapp':
        return {
          icon: '🟢',
          title: 'Destinatario WhatsApp',
          val: contactInfo.whatsapp,
          desc: `Cellulare registrato per ${contactInfo.referente}`,
          color: 'var(--pill-green-fg)',
          bg: 'var(--pill-green-bg)',
        };
      case 'email':
        return {
          icon: '✉️',
          title: 'Destinatario Email',
          val: contactInfo.email,
          desc: `Email ufficiale registrata in anagrafica`,
          color: 'var(--indigo-l)',
          bg: 'var(--pill-indigo-bg)',
        };
      case 'telegram':
        return {
          icon: '✈️',
          title: 'Destinatario Telegram',
          val: contactInfo.telegram,
          desc: `Account Telegram collegato a ${contactInfo.referente}`,
          color: 'var(--cat-societario)',
          bg: 'var(--pill-sky-bd)',
        };
      case 'signal':
        return {
          icon: '🔒',
          title: 'Destinatario Signal',
          val: contactInfo.signal,
          desc: `Numero Signal cifrato di ${contactInfo.referente}`,
          color: 'var(--pill-indigo-fg)',
          bg: 'var(--pill-indigo-bg)',
        };
      case 'portal':
        return {
          icon: '🌐',
          title: 'Portale Riservato Studio (portal)',
          val: contactInfo.referente || 'portal',
          desc: `Messaggio diretto sul Portale Cliente sicuro (portal)`,
          color: 'var(--indigo)',
          bg: 'var(--surface-1)',
        };
    }
  };

  const channelDetail = getCurrentChannelDetails();
  const messaggiFiltrati = messaggi.filter(m => filtroCanale === 'TUTTI' || m.canale === filtroCanale);
  const primoNonLettoId = useMemo(() => {
    const primo = messaggiFiltrati.find(m => m.direzione === 'entrata' && m.stato !== 'letto');
    return primo ? primo.id : null;
  }, [messaggiFiltrati]);
  const nuoviNonLettiCount = useMemo(() => {
    return messaggi.filter(m => m.direzione === 'entrata' && m.stato !== 'letto').length;
  }, [messaggi]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Hub Omnichannel */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>💬 Omnichannel Communications Vault & Ingestion Hub</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Tutte le comunicazioni scambiate con <strong>{nomeCliente}</strong> (Email, WhatsApp, Telegram, Signal, Portale Riservato) centralizzate ed associate a questo Progetto.
          </div>
        </div>

        {/* Filtri Canali & Refresh */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {['TUTTI', 'email', 'whatsapp', 'telegram', 'signal', 'portal'].map(cat => (
            <button
              key={cat}
              onClick={() => {
                setFiltroCanale(cat);
                if (cat !== 'TUTTI') {
                  setCanaleSelezionato(cat as any);
                }
              }}
              style={{
                background: filtroCanale === cat ? 'var(--indigo)' : 'var(--card2)',
                color: filtroCanale === cat ? '#fff' : 'var(--muted)',
                border: `1px solid ${filtroCanale === cat ? 'var(--indigo-l)' : 'var(--border)'}`,
                padding: '5px 12px',
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {cat === 'TUTTI' ? 'Tutti i Canali' : cat === 'portal' ? '🌐 portal' : cat.toUpperCase()}
            </button>
          ))}
          <button
            onClick={async () => {
              // Il pulsante manuale forza la lettura della casella (azzera la finestra dei
              // 60 s) e riporta l'esito vero: prima diceva sempre «sincronizzazione
              // completata», anche quando la posta in arrivo non era stata letta (regola 7).
              ultimaLetturaImap.current = 0;
              const motivo = await loadComunicazioni({ conImap: true });
              if (motivo) {
                setFeedback({ tipo: 'err', testo: `Messaggi del fascicolo aggiornati, posta in arrivo no: ${motivo}` });
              } else {
                setFeedback({ tipo: 'ok', testo: '✓ Sincronizzazione completata: registro del fascicolo e posta in arrivo aggiornati.' });
              }
              setTimeout(() => setFeedback(null), 3500);
            }}
            disabled={loadingMsgs}
            style={{
              background: 'var(--card2)',
              color: 'var(--indigo-l)',
              border: '1px solid var(--border)',
              padding: '5px 12px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {loadingMsgs ? '⏳ Sincronizzazione...' : '🔄 Sincronizza Live'}
          </button>
          <button
            onClick={sincronizzaAllegatiImap}
            disabled={sincronizzandoAllegati}
            title="Scarica gli allegati email via IMAP e li associa al fascicolo"
            style={{
              background: 'var(--card2)',
              color: 'var(--cat-societario)',
              border: '1px solid var(--border)',
              padding: '5px 12px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {sincronizzandoAllegati ? '⏳ Scarico Allegati...' : '📎 Sincronizza Allegati Email'}
          </button>
        </div>
      </div>

      {/* Info Banner Regole di Associazione Automatica con Dati Anagrafici Reali */}
      <div style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', borderRadius: 12, padding: 14, fontSize: 11.5, color: 'var(--green)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <strong>🔗 Associazione Automatica Attiva:</strong> I messaggi scambiati via Portale Riservato (<code>portal</code>), Email <code>{contactInfo.email}</code>, WhatsApp <code>{contactInfo.whatsapp}</code> e Telegram <code>{contactInfo.telegram}</code> (dati anagrafici di <strong>{nomeCliente}</strong>) confluiscono automaticamente in questo fascicolo e gli allegati vengono archiviati nel Vault.
        </div>
        <button
          onClick={() => downloadGuidePdf()}
          style={{
            background: 'rgba(52, 211, 153, 0.15)',
            border: '1px solid var(--green)',
            color: 'var(--green)',
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          📄 Scarica Guida Ufficiale PDF A4
        </button>
      </div>

      {/* Timeline Chat Comunicazioni con Smart Scroll e Ricevute di Stato */}
      <div style={{ position: 'relative' }}>
        <div
          ref={chatContainerRef}
          onScroll={handleChatScroll}
          style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 520, overflowY: 'auto' }}
        >
          {messaggiFiltrati.map(m => {
            const badge = getCanaleBadge(m.canale);
            const isUscita = m.direzione === 'uscita';
            const isFirstUnread = m.id === primoNonLettoId;
            return (
              <React.Fragment key={m.id}>
                {isFirstUnread && (
                  <div ref={unreadMarkerRef} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0', opacity: 0.95 }}>
                    <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--indigo))' }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--pill-indigo-fg)', background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', padding: '3px 12px', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>🔔</span>
                      <span>Nuovi messaggi non letti</span>
                    </span>
                    <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--indigo), transparent)' }} />
                  </div>
                )}
                <div
                  style={{
                    alignSelf: isUscita ? 'flex-end' : 'flex-start',
                    maxWidth: '82%',
                    background: isUscita ? 'var(--pill-indigo-bg)' : 'var(--card)',
                    border: `1px solid ${isUscita ? 'var(--indigo)' : 'var(--border)'}`,
                    borderRadius: 14,
                    padding: 14,
                    boxShadow: '0 4px 14px rgba(0,0,0,.2)',
                  }}
                >
                  {/* Info Messaggio Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: badge.bg, color: badge.color }}>
                        {badge.icon} {badge.label}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                        {m.mittente}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{m.dataOra}</span>
                      {isUscita && (
                        <SpunteStato
                          stato={m.stato}
                          inviatoAt={m.inviatoAt}
                          consegnatoAt={m.consegnatoAt}
                          lettoAt={m.lettoAt}
                          errore={m.errore}
                          contesto="operatore"
                        />
                      )}
                    </span>
                  </div>

              {/* Destinatario Info */}
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>A:</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{m.destinatario}</span>
              </div>

              {/* Testo Messaggio */}
              <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {cleanDisplayEmailText(m.testo)}
              </div>

              {/* Allegati Messaggio */}
              {m.allegati && m.allegati.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>📎 File & Documenti Ricevuti ({m.allegati.length}):</span>
                  </div>
                  {m.allegati.map((att, idx) => (
                    <div key={idx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>📄</span>
                        <div>
                          <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 11.5 }}>{att.nome}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{att.dimensione || '1.2 MB'} • File Sicuro Verificato</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <a
                          href={urlDocumentoAssoluto(att.url || '#')}
                          download={att.nome}
                          target="_blank"
                          rel="noreferrer"
                          style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          📥 Scarica
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            const vaultKey = `bluman_vault_docs_${progettoId}`;
                            const existing = JSON.parse(localStorage.getItem(vaultKey) || '[]');
                            existing.push({ id: `doc-${Date.now()}`, nome: att.nome, url: att.url, data: new Date().toLocaleDateString('it-IT'), categoria: 'Da Comunicazione Cliente' });
                            localStorage.setItem(vaultKey, JSON.stringify(existing));
                            toast.successo(`Documento "${att.nome}" archiviato ed indicizzato con successo nel Vault Legale del Fascicolo!`);
                          }}
                          style={{ background: 'var(--pill-green-bg)', border: '1px solid var(--pill-green-bg)', color: 'var(--green)', padding: '4px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          📁 Archivia in Vault Progetto
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
              </React.Fragment>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {showScrollBottom && (
          <button
            type="button"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            style={{
              position: 'absolute',
              bottom: 16,
              right: 24,
              background: 'var(--indigo)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 24,
              padding: '7px 16px',
              fontSize: 11.5,
              fontWeight: 700,
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              zIndex: 10,
            }}
          >
            <span>⬇️ Scorri all'ultimo</span>
            {nuoviNonLettiCount > 0 && (
              <span style={{ background: 'var(--red)', color: '#fff', borderRadius: '50%', fontSize: 9.5, padding: '1px 6px', fontWeight: 800 }}>
                {nuoviNonLettiCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Form Invio Messaggio Multicanale con Dati Anagrafica Live */}
      <form onSubmit={handleInviaMessaggio} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>📤 Rispondi al Cliente dal Progetto</span>
          </div>

          {/* Selettore Canale e Dati Anagrafica Dinamici */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Linea / Canale Studio (Admin):</label>
              <select
                value={canaleSelezionato}
                onChange={e => setCanaleSelezionato(e.target.value as any)}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
              >
                <option value="whatsapp">🟢 WhatsApp Business Studio ({studioChannels.whatsapp})</option>
                <option value="email">✉️ Email Ufficiale Studio ({studioChannels.email})</option>
                <option value="telegram">✈️ Telegram Bot Studio ({studioChannels.telegram})</option>
                <option value="signal">🔒 Signal Studio Cifrato ({studioChannels.signal})</option>
                <option value="portal">🌐 Portale Riservato Studio ({studioChannels.portal})</option>
              </select>
            </div>

            {/* Dati Dinamici del Destinatario Presi dall'Anagrafica Cliente ERP */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: channelDetail.bg,
              border: `1px solid ${channelDetail.color}40`,
              padding: '4px 12px',
              borderRadius: 8,
              fontSize: 11,
              color: channelDetail.color,
            }}>
              <span style={{ fontWeight: 800 }}>🎯 Destinatario Cliente:</span>
              <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{channelDetail.val}</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>({contactInfo.referente})</span>
              <span style={{
                background: 'rgba(255,255,255,0.15)',
                padding: '1px 6px',
                borderRadius: 4,
                fontSize: 9.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}>
                ✓ Anagrafica ERP
              </span>
            </div>

            {canaleSelezionato === 'email' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>📧 Destinatario:</span>
                <input
                  type="email"
                  value={customDestEmail || contactInfo.email}
                  onChange={e => setCustomDestEmail(e.target.value)}
                  placeholder="destinatario@email.com"
                  style={{
                    background: 'rgba(0,0,0,0.35)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 11.5,
                    minWidth: 240,
                    fontWeight: 600,
                  }}
                />
              </div>
            )}

            {canaleSelezionato === 'whatsapp' && (
              <button
                type="button"
                onClick={async () => {
                  // Il ripiego era un numero scritto nel codice: premendo «Test» senza cellulare
                  // in anagrafica, il messaggio di prova partiva verso quel numero.
                  const cleanPhone = (contactInfo.whatsapp || '').replace(/\D/g, '');
                  if (!cleanPhone) {
                    setFeedback({ tipo: 'err', testo: 'Nessun cellulare in anagrafica: non c\'è un numero verso cui fare il test.' });
                    setTimeout(() => setFeedback(null), 4000);
                    return;
                  }
                  setFeedback({ tipo: 'ok', testo: `Invio notifica WhatsApp in corso verso ${contactInfo.whatsapp}...` });
                  const res = await sendWhatsAppDirectApi(cleanPhone, '', 'hello_world');
                  if (res && res.success) {
                    setFeedback({ tipo: 'ok', testo: `✓ Template di prova «hello_world» accettato da Meta per il numero ${contactInfo.whatsapp}.` });
                  } else {
                    setFeedback({ tipo: 'err', testo: `Test WhatsApp non riuscito verso ${contactInfo.whatsapp}: ${res?.errore || 'motivo non riportato'}` });
                  }
                  setTimeout(() => setFeedback(null), 4000);
                }}
                style={{
                  background: 'var(--green)',
                  color: '#fff',
                  border: '1px solid var(--green)',
                  padding: '5px 12px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                📲 Test Notifica WhatsApp 1-Click
              </button>
            )}
          </div>
        </div>

        {erroreImap && (
          <div style={{
            padding: '9px 14px',
            borderRadius: 8,
            fontSize: 11.5,
            fontWeight: 600,
            background: 'var(--pill-amber-bg)',
            color: 'var(--amber)',
            border: '1px solid var(--pill-amber-bd)',
          }}>
            ⚠️ Posta in arrivo non leggibile: {erroreImap} Le risposte del cliente potrebbero non comparire in questo registro finché la casella IMAP non è configurata in Impostazioni Studio.
          </div>
        )}

        {feedback && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 600,
            background: feedback.tipo === 'ok' ? 'var(--pill-green-bg)' : 'var(--pill-red-bg)',
            color: feedback.tipo === 'ok' ? 'var(--green)' : 'var(--pill-red-fg)',
            border: `1px solid ${feedback.tipo === 'ok' ? 'var(--green)' : 'var(--red)'}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span>{feedback.testo}</span>
          </div>
        )}

        {fileAllegato && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', borderRadius: 8, padding: '6px 12px', fontSize: 11, color: 'var(--pill-indigo-fg)', width: 'fit-content' }}>
            <span>📎 {fileAllegato.nome}</span>
            <span style={{ fontSize: 9.5, opacity: 0.8 }}>({fileAllegato.sizeStr})</span>
            <button
              type="button"
              onClick={() => {
                setFileAllegato(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              style={{ background: 'transparent', border: 'none', color: 'var(--pill-red-fg)', cursor: 'pointer', fontWeight: 700, padding: '0 4px', fontSize: 12 }}
            >
              ✕
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            value={nuovoTesto}
            onChange={e => setNuovoTesto(e.target.value)}
            disabled={inviando || caricandoFile}
            placeholder={`Scrivi un messaggio per ${contactInfo.referente} da inviare via ${canaleSelezionato.toUpperCase()} (${channelDetail.val})...`}
            rows={2}
            style={{ flex: 1, fontSize: 12.5, borderRadius: 10, padding: 10, resize: 'none' }}
          />

          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 15 * 1024 * 1024) {
                toast.attenzione('Il file selezionato supera il limite di 15 MB.');
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                setFileAllegato({
                  nome: file.name,
                  base64: reader.result as string,
                  sizeStr: `${(file.size / 1024).toFixed(0)} KB`,
                  mime: file.type || 'application/octet-stream',
                });
              };
              reader.readAsDataURL(file);
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Allega un documento o file"
            style={{
              background: 'var(--card)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              padding: '8px 12px',
              borderRadius: 10,
              fontSize: 14,
              cursor: 'pointer',
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            📎
          </button>

          <button
            type="submit"
            disabled={inviando || caricandoFile || (!nuovoTesto.trim() && !fileAllegato)}
            style={{
              background: inviando || caricandoFile ? 'var(--indigo-d)' : 'var(--indigo)',
              color: '#fff',
              border: 'none',
              padding: '0 24px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              height: 44,
              cursor: inviando || caricandoFile ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(99,102,241,.3)',
              opacity: inviando || caricandoFile || (!nuovoTesto.trim() && !fileAllegato) ? 0.7 : 1,
            }}
          >
            {inviando || caricandoFile ? 'Invio in corso...' : 'Invia Ora →'}
          </button>
        </div>
      </form>
    </div>
  );
}
