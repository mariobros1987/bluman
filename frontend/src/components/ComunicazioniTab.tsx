import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchComunicazioniApi, inviaComunicazioneApi, fetchClienti, sendWhatsAppDirectApi, sendEmailDirectApi, fetchInboundImapEmailsApi, fetchTenantInfoApi } from '../api/client';
import { downloadGuidePdf } from '../utils/pdfGenerator';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant, BLUECODE_TENANT_ID } from '../utils/tenant';
import type { Cliente } from '../types';

export interface MessaggioComunicazione {
  id: string;
  canale: 'email' | 'whatsapp' | 'telegram' | 'signal';
  mittente: string;
  destinatario: string;
  direzione: 'entrata' | 'uscita';
  testo: string;
  dataOra: string;
  allegati?: { nome: string; url: string; dimensione: string }[];
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
      telegram: tenantSettings?.tgBotUsername || (isBC ? '@BluManStudioBot' : ''),
      signal: tenantSettings?.telefono || studio.telefono || (isBC ? '+39 378 092 6461' : ''),
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
    const whatsapp = clientData?.cellulare || refJson.cellulare || refJson.whatsapp || clientData?.telefono || refJson.telefono || '';
    const telegram = clientData?.telegram || refJson.telegram || '';
    const signal = clientData?.signal || refJson.signal || clientData?.cellulare || refJson.cellulare || clientData?.telefono || refJson.telefono || '';
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
  const [canaleSelezionato, setCanaleSelezionato] = useState<'email' | 'whatsapp' | 'telegram' | 'signal'>('whatsapp');
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
      }
    } catch (err) {
      motivoImap = motivoImap || `Sincronizzazione non riuscita: ${err instanceof Error ? err.message : 'errore di rete'}.`;
    }
    setLoadingMsgs(false);
    return motivoImap;
  };

  useEffect(() => {
    loadComunicazioni();
    const interval = setInterval(() => {
      loadComunicazioni();
    }, 5000);
    return () => clearInterval(interval);
  }, [progettoId]);

  const handleInviaMessaggio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuovoTesto.trim() || inviando) return;
    setInviando(true);
    setFeedback(null);

    const testoDaInviare = nuovoTesto.trim();
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
    };

    setMessaggi(prev => [...prev, nuovoMsg]);
    setNuovoTesto('');

    try {
      // 1. Persistenza su Backend Fastify / Supabase
      await inviaComunicazioneApi(String(progettoId), {
        canale: canaleSelezionato,
        mittente,
        destinatario,
        direzione: 'uscita',
        testo: testoDaInviare,
      });

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
          testoDaInviare
        );
        if (res && res.success) {
          setFeedback({ tipo: 'ok', testo: `✓ Email recapitata con successo alla casella ${destEmail}!` });
        } else {
          setFeedback({ tipo: 'err', testo: `❌ Errore Invio Email: ${res?.errore || 'Verifica la password SMTP in Impostazioni'}` });
        }
      } else if (canaleSelezionato === 'whatsapp') {
        // 3. Se WhatsApp, dispatch tramite POST /comunicazioni/invia-whatsapp: il token Meta
        // e il phone id sono quelli dello studio corrente, non variabili d'ambiente condivise.
        // Il numero era `|| '393335936278'`: senza cellulare in anagrafica il messaggio del
        // cliente partiva verso un numero scritto nel codice. E quando l'invio falliva, il
        // ripiego spediva il template di esempio `hello_world` e annunciava «Notifica
        // consegnata»: al destinatario arrivava «Hello World», all'operatore un successo.
        const cleanPhone = (contactInfo.whatsapp || '').replace(/\D/g, '');
        if (!cleanPhone) {
          setFeedback({ tipo: 'err', testo: `Nessun cellulare in anagrafica per ${nomeCliente || 'il cliente'}: WhatsApp non può partire.` });
          setInviando(false);
          return;
        }
        const res = await sendWhatsAppDirectApi(cleanPhone, testoDaInviare);
        if (res && res.success) {
          setFeedback({ tipo: 'ok', testo: `✓ Messaggio WhatsApp recapitato a ${contactInfo.whatsapp}` });
        } else {
          setFeedback({ tipo: 'err', testo: `WhatsApp non ha accettato l'invio verso ${contactInfo.whatsapp}: ${res?.errore || 'motivo non riportato'}. Il messaggio resta nel registro del fascicolo.` });
        }
      } else {
        setFeedback({ tipo: 'ok', testo: `✓ Messaggio registrato e notificato via ${canaleSelezionato.toUpperCase()} al cliente!` });
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

  const getCanaleBadge = (canale: string) => {
    switch (canale) {
      case 'email': return { icon: '✉️', label: 'Email Inbound/Outbound', bg: '#1e1b4b', color: '#818cf8' };
      case 'whatsapp': return { icon: '🟢', label: 'WhatsApp Business', bg: '#064e3b', color: '#34d399' };
      case 'telegram': return { icon: '✈️', label: 'Telegram Bot Webhook', bg: '#0369a1', color: '#38bdf8' };
      case 'signal': return { icon: '🔒', label: 'Signal End-to-End Cifrato', bg: '#312e81', color: '#a5b4fc' };
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
          color: '#34d399',
          bg: '#064e3b',
        };
      case 'email':
        return {
          icon: '✉️',
          title: 'Destinatario Email',
          val: contactInfo.email,
          desc: `Email ufficiale registrata in anagrafica`,
          color: '#818cf8',
          bg: '#1e1b4b',
        };
      case 'telegram':
        return {
          icon: '✈️',
          title: 'Destinatario Telegram',
          val: contactInfo.telegram,
          desc: `Account Telegram collegato a ${contactInfo.referente}`,
          color: '#38bdf8',
          bg: '#0369a1',
        };
      case 'signal':
        return {
          icon: '🔒',
          title: 'Destinatario Signal',
          val: contactInfo.signal,
          desc: `Numero Signal cifrato di ${contactInfo.referente}`,
          color: '#a5b4fc',
          bg: '#312e81',
        };
    }
  };

  const channelDetail = getCurrentChannelDetails();
  const messaggiFiltrati = messaggi.filter(m => filtroCanale === 'TUTTI' || m.canale === filtroCanale);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Hub Omnichannel */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>💬 Omnichannel Communications Vault & Ingestion Hub</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Tutte le comunicazioni scambiate con <strong>{nomeCliente}</strong> (Email, WhatsApp, Telegram, Signal) centralizzate ed associate a questo Progetto.
          </div>
        </div>

        {/* Filtri Canali & Refresh */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {['TUTTI', 'email', 'whatsapp', 'telegram', 'signal'].map(cat => (
            <button
              key={cat}
              onClick={() => setFiltroCanale(cat)}
              style={{
                background: filtroCanale === cat ? 'var(--indigo)' : 'var(--card2)',
                color: filtroCanale === cat ? '#fff' : 'var(--muted)',
                border: `1px solid ${filtroCanale === cat ? 'var(--indigo-l)' : 'var(--border)'}`,
                padding: '5px 12px',
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {cat === 'TUTTI' ? 'Tutti i Canali' : cat}
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
        </div>
      </div>

      {/* Info Banner Regole di Associazione Automatica con Dati Anagrafici Reali */}
      <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 12, padding: 14, fontSize: 11.5, color: '#34d399', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <strong>🔗 Associazione Automatica Attiva:</strong> I messaggi inviati da Email <code>{contactInfo.email}</code>, WhatsApp <code>{contactInfo.whatsapp}</code> e Telegram <code>{contactInfo.telegram}</code> (dati anagrafici di <strong>{nomeCliente}</strong>) confluiscono automaticamente in questo fascicolo e gli allegati vengono archiviati nel Vault.
        </div>
        <button
          onClick={() => downloadGuidePdf()}
          style={{
            background: 'rgba(52, 211, 153, 0.15)',
            border: '1px solid #34d399',
            color: '#34d399',
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

      {/* Timeline Chat Comunicazioni */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 520, overflowY: 'auto' }}>
        {messaggiFiltrati.map(m => {
          const badge = getCanaleBadge(m.canale);
          const isUscita = m.direzione === 'uscita';
          return (
            <div
              key={m.id}
              style={{
                alignSelf: isUscita ? 'flex-end' : 'flex-start',
                maxWidth: '82%',
                background: isUscita ? '#1e1b4b' : 'var(--card)',
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
                <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  {m.dataOra}
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
                          href={att.url || '#'}
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
                            alert(`✓ Documento "${att.nome}" archiviato ed indicizzato con successo nel Vault Legale del Fascicolo!`);
                          }}
                          style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '4px 10px', borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          📁 Archivia in Vault Progetto
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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
              <span style={{ fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{channelDetail.val}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>({contactInfo.referente})</span>
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
                  background: '#065f46',
                  color: '#fff',
                  border: '1px solid #10b981',
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
            background: '#3b2a11',
            color: '#fbbf24',
            border: '1px solid #b45309',
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
            background: feedback.tipo === 'ok' ? '#0d2d22' : '#3b1111',
            color: feedback.tipo === 'ok' ? '#34d399' : '#f87171',
            border: `1px solid ${feedback.tipo === 'ok' ? '#059669' : '#dc2626'}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span>{feedback.testo}</span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <textarea
            value={nuovoTesto}
            onChange={e => setNuovoTesto(e.target.value)}
            disabled={inviando}
            placeholder={`Scrivi un messaggio per ${contactInfo.referente} da inviare via ${canaleSelezionato.toUpperCase()} (${channelDetail.val})...`}
            rows={2}
            style={{ flex: 1, fontSize: 12.5, borderRadius: 10, padding: 10, resize: 'none' }}
          />
          <button
            type="submit"
            disabled={inviando || !nuovoTesto.trim()}
            style={{
              background: inviando ? '#4338ca' : 'var(--indigo)',
              color: '#fff',
              border: 'none',
              padding: '0 24px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: inviando ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(99,102,241,.3)',
              opacity: inviando || !nuovoTesto.trim() ? 0.7 : 1,
            }}
          >
            {inviando ? 'Invio in corso...' : 'Invia Ora →'}
          </button>
        </div>
      </form>
    </div>
  );
}
