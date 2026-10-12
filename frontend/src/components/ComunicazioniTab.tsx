import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchComunicazioniApi, inviaComunicazioneApi, segnaComunicazioniLetteApi, fetchClienti, sendWhatsAppDirectApi, fetchInboundImapEmailsApi, fetchInboundImapAllegatiApi, urlDocumentoAssoluto } from '../api/client';
import {
  abbinaComunicazioneMicrovoceApi,
  fetchMicrovociProgettoApi,
  slegaComunicazioneMicrovoceApi,
  type AbbinamentoMicrovoce,
  type MicrovoceDellaPratica,
} from '../api/progetti';
import { downloadGuidePdf } from '../utils/pdfGenerator';
import { useInvioComunicazione, type CanaleInvio } from '../hooks/useInvioComunicazione';
import { useCanaliStudio } from '../hooks/useCanaliStudio';
import { ComposerComunicazione } from './ComposerComunicazione';
import { SpunteStato } from './SpunteStato';
import { etichettaOrigine } from '../utils/origineAbbinamento';
import { recapitiDaAnagrafica } from '../utils/recapitiCliente';
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
   * Le micro-voci a cui questo messaggio è abbinato, e **perché**.
   *
   * Arriva dal server insieme al messaggio e non da una chiamata a parte: la bolla deve poter dire
   * subito di cosa parla, e un secondo giro di rete per un'etichetta farebbe comparire la chat senza
   * etichette e poi con — che è peggio di non mostrarle affatto.
   */
  microvoci?: AbbinamentoMicrovoce[];
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

  // Le linee dello studio (numero, casella, bot) arrivano da `useCanaliStudio`: le legge anche il
  // compositore della micro-voce, e due letture darebbero due etichette per lo stesso numero.
  const studioChannels = useCanaliStudio();

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

  // I recapiti dall'anagrafica cliente ERP. La lettura sta in `utils/recapitiCliente.ts` perché ora
  // la fanno in due — questa chat e il compositore dentro la micro-voce — e due copie darebbero due
  // pareri diversi sullo stesso cliente: il canale disponibile in una vista e non nell'altra.
  const contactInfo = useMemo(
    () => recapitiDaAnagrafica(clientData, nomeCliente, emailCliente),
    [clientData, nomeCliente, emailCliente],
  );

  const [messaggi, setMessaggi] = useState<MessaggioComunicazione[]>(() => {
    const saved = localStorage.getItem(`bluman_msgs_${progettoId}`);
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    // §7 — qui c'era un messaggio di benvenuto **inventato**: mittente il numero WhatsApp
    // reale del cliente con il nome del suo referente, destinatario «Studio Advisory
    // (+356 79001122)», testo «Buongiorno Studio, confermiamo l'avvio delle attività…»,
    // direzione «entrata». Non era riconoscibile come esempio: assomigliava a un messaggio
    // ricevuto davvero. E restava a schermo, perché più sotto `setMessaggi` viene chiamato
    // solo se la lista non è vuota: con zero comunicazioni a database la chat mostrava quel
    // messaggio al posto del vuoto.
    //
    // Una chat vuota è un'informazione vera; una conversazione inventata no. Quando il
    // database ha messaggi veri è il ramo sotto a riempirla.
    return [];
  });

  const [filtroCanale, setFiltroCanale] = useState<string>('TUTTI');

  // ── Abbinamento alle micro-voci ─────────────────────────────────────────────────────
  //
  // È il livello «a mano»: la rete che non fallisce mai, e l'unico modo per correggere un
  // abbinamento che il contesto ha dedotto e che era sbagliato. Per questo la selezione è esplicita
  // e l'azione dice cosa fa — non c'è nessun automatismo che indovina di cosa parla un messaggio.
  const [selezionati, setSelezionati] = useState<string[]>([]);
  const [microvociPratica, setMicrovociPratica] = useState<MicrovoceDellaPratica[]>([]);
  const [erroreMicrovoci, setErroreMicrovoci] = useState<string | null>(null);
  const [microvoceScelta, setMicrovoceScelta] = useState('');
  const [abbinando, setAbbinando] = useState(false);
  const [abbinamentiInCorso, setAbbinamentiInCorso] = useState<string[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'ok' | 'err'; testo: string } | null>(null);
  // §35 — la lettura IMAP passa dal backend e apre una connessione alla casella dello studio:
  // farla a ogni giro del polling da 5 s significherebbe una sessione IMAP ogni 5 secondi per
  // ogni scheda aperta. I messaggi già salvati si rileggono a 5 s, la posta in arrivo a 60 s.
  const ultimaLetturaImap = useRef(0);
  const [erroreImap, setErroreImap] = useState<string | null>(null);
  const [sincronizzandoAllegati, setSincronizzandoAllegati] = useState(false);

  // L'invio — canale, testo, allegato, consegna — sta in un hook, non qui: il compositore della
  // micro-voce monta lo stesso hook, e due copie di questa procedura sarebbero due verità su una
  // cosa sola. Vedi `useInvioComunicazione`.
  const invio = useInvioComunicazione({
    progettoId: String(progettoId),
    nomeCliente,
    emailCliente,
    contatto: contactInfo,
    onFeedback: setFeedback,
    // La riga compare subito, prima che il server risponda: la si è appena scritta, e aspettare il
    // giro di rete per vederla farebbe sembrare l'invio non partito.
    onInviato: (m) => setMessaggi(prev => [...prev, m]),
    // E l'esito del dispatch si scrive sulla riga che si sta guardando: senza, l'operatore vedrebbe
    // «in attesa» finché non ricarica il fascicolo, anche quando l'invio è già fallito.
    onEsito: (idLocale, esito) => setMessaggi(prev =>
      prev.map(x =>
        x.id === idLocale
          ? { ...x, stato: esito.stato, errore: esito.stato === 'inviato' ? null : esito.errore || 'motivo non riportato' }
          : x,
      ),
    ),
  });

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
      const targetEmail = invio.customDestEmail.trim() || contactInfo.email;
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
      const targetEmail = invio.customDestEmail.trim() || contactInfo.email;
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

  // L'invio non è più scritto qui: sta in `useInvioComunicazione`, montato sopra. Qui restano i
  // due pezzi che appartengono a **questa** scheda — la riga ottimistica e l'esito sulla riga che
  // si sta guardando — passati all'hook come `onInviato` e `onEsito`.


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

  const messaggiFiltrati = messaggi.filter(m => filtroCanale === 'TUTTI' || m.canale === filtroCanale);

  // ── Abbinare i messaggi alle micro-voci ─────────────────────────────────────────────

  const toggleSelezione = (id: string) =>
    setSelezionati(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  // Le micro-voci si chiedono **solo quando servono**: chi apre la chat per leggere non paga una
  // richiesta in più, e chi seleziona la paga una volta sola. Chiedere l'elenco all'apertura della
  // scheda sarebbe un giro di rete per un menu che forse nessuno apre.
  useEffect(() => {
    if (selezionati.length === 0 || microvociPratica.length > 0 || erroreMicrovoci) return;
    let annullato = false;
    void fetchMicrovociProgettoApi(String(progettoId))
      .then((voci) => { if (!annullato) setMicrovociPratica(voci); })
      .catch((err) => {
        if (!annullato) {
          setErroreMicrovoci(err instanceof Error ? err.message : 'Elenco delle micro-voci non disponibile.');
        }
      });
    return () => { annullato = true; };
  }, [selezionati.length, microvociPratica.length, erroreMicrovoci, progettoId]);

  const abbinaSelezionati = async () => {
    const mvId = microvoceScelta || microvociPratica[0]?.id;
    if (!mvId) {
      setFeedback({ tipo: 'err', testo: 'Questa pratica non ha micro-voci: non c\'è niente a cui abbinare.' });
      return;
    }
    setAbbinando(true);
    try {
      // Gli esiti si raccolgono tutti invece di fermarsi al primo errore: sono righe indipendenti,
      // e dire «3 su 5» è più utile che dire «non riuscito» dopo averne salvate due.
      const falliti = (await Promise.all(
        selezionati.map(async (id) => {
          try {
            await abbinaComunicazioneMicrovoceApi(String(progettoId), id, mvId);
            return null;
          } catch {
            return id;
          }
        }),
      )).filter((x): x is string => x !== null);

      const nome = microvociPratica.find(v => v.id === mvId)?.nome ?? 'la micro-voce';
      const riusciti = selezionati.length - falliti.length;
      setFeedback(falliti.length === 0
        ? { tipo: 'ok', testo: `✓ ${riusciti} ${riusciti === 1 ? 'messaggio abbinato' : 'messaggi abbinati'} a «${nome}».` }
        : { tipo: 'err', testo: `${riusciti} abbinati a «${nome}», ${falliti.length} no: riprova sui restanti.` });
      setSelezionati(falliti);
      await loadComunicazioni();
    } finally {
      setAbbinando(false);
    }
  };

  const slega = async (m: MessaggioComunicazione, mv: AbbinamentoMicrovoce) => {
    setAbbinamentiInCorso(prev => [...prev, m.id]);
    try {
      await slegaComunicazioneMicrovoceApi(String(progettoId), m.id, mv.microvoceId);
      await loadComunicazioni();
    } catch (err) {
      setFeedback({ tipo: 'err', testo: err instanceof Error ? err.message : 'Rimozione non riuscita.' });
    } finally {
      setAbbinamentiInCorso(prev => prev.filter(x => x !== m.id));
    }
  };

  const microvociPerModulo = useMemo(() => {
    const gruppi = new Map<string, MicrovoceDellaPratica[]>();
    for (const v of microvociPratica) {
      const elenco = gruppi.get(v.moduloNome) ?? [];
      elenco.push(v);
      gruppi.set(v.moduloNome, elenco);
    }
    return [...gruppi.entries()];
  }, [microvociPratica]);
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
                  invio.setCanale(cat as CanaleInvio);
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

      {/* Barra d'azione dell'abbinamento: compare solo con una selezione attiva, perché prima non
          c'è niente da fare e un pannello sempre aperto occuperebbe spazio per un'azione rara. */}
      {selezionati.length > 0 && (
        <div
          style={{
            background: 'var(--pill-indigo-bg)',
            border: '1px solid var(--indigo-d)',
            borderRadius: 12,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: 11.5,
            color: 'var(--pill-indigo-fg)',
          }}
        >
          <strong>{selezionati.length} {selezionati.length === 1 ? 'messaggio selezionato' : 'messaggi selezionati'}</strong>
          {erroreMicrovoci ? (
            <span style={{ color: 'var(--amber)' }}>{erroreMicrovoci}</span>
          ) : (
            <>
              <select
                value={microvoceScelta || microvociPratica[0]?.id || ''}
                onChange={e => setMicrovoceScelta(e.target.value)}
                disabled={microvociPratica.length === 0}
                style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontSize: 11.5, maxWidth: 280 }}
              >
                {microvociPratica.length === 0 && <option value="">Carico le micro-voci…</option>}
                {microvociPerModulo.map(([modulo, voci]) => (
                  <optgroup key={modulo} label={modulo}>
                    {voci.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void abbinaSelezionati()}
                disabled={abbinando || microvociPratica.length === 0}
                style={{
                  background: 'var(--indigo)',
                  color: '#fff',
                  border: '1px solid var(--indigo-l)',
                  borderRadius: 8,
                  padding: '5px 12px',
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: abbinando || microvociPratica.length === 0 ? 'default' : 'pointer',
                  opacity: abbinando || microvociPratica.length === 0 ? 0.6 : 1,
                }}
              >
                {abbinando ? '⏳ Abbino…' : '🔗 Abbina a micro-voce'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => { setSelezionati([]); setFeedback(null); }}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            Annulla selezione
          </button>
        </div>
      )}

      {/* Timeline Chat Comunicazioni con Smart Scroll e Ricevute di Stato */}
      <div style={{ position: 'relative' }}>
        <div
          ref={chatContainerRef}
          onScroll={handleChatScroll}
          style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 520, overflowY: 'auto' }}
        >
          {messaggiFiltrati.length === 0 && (
            <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--muted)', fontSize: 12 }}>
              <div style={{ fontSize: 22, marginBottom: 6 }} aria-hidden="true">💬</div>
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Nessun messaggio in questa pratica</div>
              <div>Qui compaiono le comunicazioni scambiate con il cliente su WhatsApp, Telegram ed email. Quelle in entrata arrivano dai canali configurati in Impostazioni → Canali.</div>
            </div>
          )}

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
                      {/* La casella è sempre visibile, non solo al passaggio del mouse: su un tablet
                          un comando che compare solo con l'hover non esiste, e il selettore è
                          l'unico modo per abbinare a mano — non può dipendere dal puntatore. */}
                      <input
                        type="checkbox"
                        checked={selezionati.includes(m.id)}
                        onChange={() => toggleSelezione(m.id)}
                        title="Seleziona per abbinare a una micro-voce"
                        style={{ cursor: 'pointer', accentColor: 'var(--indigo)', opacity: selezionati.length > 0 ? 1 : 0.5 }}
                      />
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

              {/* Micro-voci a cui il messaggio è abbinato, con il motivo dell'abbinamento.
                  Il motivo è metà dell'informazione: «contesto» vuol dire che il cliente ha toccato
                  il link di quella voce, «manuale» che l'ha deciso l'operatore. Un abbinamento
                  dedotto e sbagliato si corregge solo se si sa che era dedotto — e il colore lo dice
                  a colpo d'occhio, invece di essere verde per tutte e tre (vedi
                  `utils/origineAbbinamento.ts`). */}
              {m.microvoci && m.microvoci.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {m.microvoci.map((mv) => {
                    const origine = etichettaOrigine(mv.origine);
                    return (
                    <span
                      key={mv.microvoceId}
                      title={origine.motivo}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 12,
                        background: origine.sfondo,
                        color: origine.colore,
                        border: `1px solid ${origine.bordo}`,
                      }}
                    >
                      <span>
                        {origine.icona} {mv.nome}
                      </span>
                      <button
                        type="button"
                        disabled={abbinamentiInCorso.includes(m.id)}
                        onClick={() => void slega(m, mv)}
                        title="Togli l'abbinamento: il messaggio resta nel fascicolo, smette di essere collegato a questa voce"
                        style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: 0 }}
                      >
                        ×
                      </button>
                    </span>
                    );
                  })}
                </div>
              )}

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

      {/* Il compositore è **lo stesso** della scheda della micro-voce: qui non c'è nessuna logica di
          invio, solo le due cose che appartengono a questa chat — il test WhatsApp e la casella
          IMAP muta — passate come slot. Il giorno in cui la consegna cambia, cambia in un posto. */}
      <ComposerComunicazione
        invio={invio}
        contatto={contactInfo}
        studioChannels={studioChannels}
        feedback={feedback}
        avvisi={erroreImap ? (
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
        ) : null}
        azioniExtra={invio.canale === 'whatsapp' ? (
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
        ) : null}
      />
    </div>
  );
}
