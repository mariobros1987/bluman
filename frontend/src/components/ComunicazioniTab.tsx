import React, { useState, useEffect, useMemo } from 'react';
import { fetchComunicazioniApi, inviaComunicazioneApi, fetchClienti } from '../api/client';
import { downloadGuidePdf } from '../utils/pdfGenerator';
import { PROJECTS } from '../store/mockData';
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

interface ComunicazioniTabProps {
  progettoId: string;
  nomeCliente: string;
  emailCliente?: string;
  cliente?: Cliente | null;
}

export function ComunicazioniTab({ progettoId, nomeCliente, emailCliente, cliente }: ComunicazioniTabProps) {
  const [clientData, setClientData] = useState<Cliente | null>(cliente || null);

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

      // 3. Fallback ai default di mockData
      if (!found) {
        const mockProj = PROJECTS.find(p => p.cl?.toLowerCase().trim() === (nomeCliente || '').toLowerCase().trim());
        if (mockProj) {
          found = {
            id: `cl-${mockProj.id}`,
            nome: mockProj.cl,
            tipo: mockProj.ct || 'company',
            email: emailCliente || 'client@holdingbeta.advisory',
            telefono: '+39 335 1234567',
            cellulare: '+39 335 1234567',
            telegram: `@${mockProj.cl.replace(/[^a-zA-Z0-9]/g, '')}`,
            signal: '+39 335 1234567',
            referenteNome: mockProj.cl,
          };
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

    const email = clientData?.email || refJson.email || emailCliente || 'client@holdingbeta.advisory';
    const whatsapp = clientData?.cellulare || refJson.cellulare || refJson.whatsapp || clientData?.telefono || refJson.telefono || '+39 335 1234567';
    const telegram = clientData?.telegram || refJson.telegram || `@${(nomeCliente || 'Cliente').replace(/[^a-zA-Z0-9]/g, '')}`;
    const signal = clientData?.signal || refJson.signal || clientData?.cellulare || refJson.cellulare || clientData?.telefono || refJson.telefono || '+39 335 1234567';
    const referente = clientData?.referenteNome || refJson.referenteNome || refJson.referente || clientData?.ubo || nomeCliente || 'Referente Incarico';

    return {
      email,
      whatsapp,
      telegram,
      signal,
      referente,
    };
  }, [clientData, nomeCliente, emailCliente]);

  const [messaggi, setMessaggi] = useState<MessaggioComunicazione[]>([
    {
      id: 'msg-001',
      canale: 'email',
      mittente: contactInfo.email,
      destinatario: 'joe@bluecode.advisory',
      direzione: 'entrata',
      testo: 'Buongiorno Joe, vi ho inviato a mezzo pec la delibera di approvazione bilancio 2025. In allegato la bozza preliminare per il deposito EUIPO.',
      dataOra: '14/08/2026 10:15',
      allegati: [
        { nome: `Bozza_Marchio_EUIPO_${(nomeCliente || 'Holding').replace(/\s+/g, '_')}.pdf`, url: '#', dimensione: '1.4 MB' },
      ],
    },
    {
      id: 'msg-002',
      canale: 'whatsapp',
      mittente: `${contactInfo.whatsapp} (${contactInfo.referente})`,
      destinatario: 'BluMan WhatsApp Studio (+356 79001122)',
      direzione: 'entrata',
      testo: 'Ciao Joe! Ho appena completato la registrazione sul Portale Cliente ed effettuato la Firma 1-Click della Proposta d\'Ordine. Procediamo con il deposito?',
      dataOra: '14/08/2026 11:30',
    },
    {
      id: 'msg-003',
      canale: 'whatsapp',
      mittente: 'Joe Disabato (Senior Advisor)',
      destinatario: `${contactInfo.whatsapp} (${contactInfo.referente})`,
      direzione: 'uscita',
      testo: `Perfetto ${contactInfo.referente}! Confermo ricezione firma ed allegati. L'operatore ha avviato la microvoce per il deposito marchio. Ti aggiorniamo sul portale.`,
      dataOra: '14/08/2026 11:45',
    },
    {
      id: 'msg-004',
      canale: 'telegram',
      mittente: contactInfo.telegram,
      destinatario: '@BluManBot',
      direzione: 'entrata',
      testo: 'Invio copia della ricevuta di versamento tasse di deposito per il dossier IP.',
      dataOra: '14/08/2026 15:20',
      allegati: [
        { nome: 'Ricevuta_Versamento_F24_EUIPO.pdf', url: '#', dimensione: '450 KB' },
      ],
    },
    {
      id: 'msg-005',
      canale: 'signal',
      mittente: `${contactInfo.signal} (Signal Cifrato)`,
      destinatario: 'Studio Malta Secure Vault',
      direzione: 'entrata',
      testo: 'Messaggio con crittografia end-to-end: Confermo approvazione struttura holding partecipata Malta.',
      dataOra: '14/08/2026 16:50',
    },
  ]);

  const [nuovoTesto, setNuovoTesto] = useState('');
  const [canaleSelezionato, setCanaleSelezionato] = useState<'email' | 'whatsapp' | 'telegram' | 'signal'>('whatsapp');
  const [filtroCanale, setFiltroCanale] = useState<string>('TUTTI');
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const loadComunicazioni = async () => {
    setLoadingMsgs(true);
    const dbMsgs = await fetchComunicazioniApi(progettoId);
    if (dbMsgs && Array.isArray(dbMsgs) && dbMsgs.length > 0) {
      setMessaggi(dbMsgs.map((m: any) => ({
        ...m,
        dataOra: m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : (m.dataOra || 'Oggi'),
        allegati: m.allegatiJson ? (typeof m.allegatiJson === 'string' ? JSON.parse(m.allegatiJson) : m.allegatiJson) : m.allegati,
      })));
    }
    setLoadingMsgs(false);
  };

  useEffect(() => {
    loadComunicazioni();
  }, [progettoId]);

  const handleInviaMessaggio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuovoTesto.trim()) return;

    const mittente = 'Joe Disabato (Senior Advisor)';
    let destinatario = '';
    switch (canaleSelezionato) {
      case 'whatsapp':
        destinatario = `${contactInfo.referente} (${contactInfo.whatsapp})`;
        break;
      case 'email':
        destinatario = contactInfo.email;
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
      testo: nuovoTesto.trim(),
      dataOra: new Date().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    };

    setMessaggi(prev => [...prev, nuovoMsg]);
    await inviaComunicazioneApi(progettoId, {
      canale: canaleSelezionato,
      mittente,
      destinatario,
      direzione: 'uscita',
      testo: nuovoTesto.trim(),
    });
    setNuovoTesto('');
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
            onClick={() => loadComunicazioni()}
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
            {loadingMsgs ? '⏳ Caricamento...' : '🔄 Sincronizza Live'}
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
                {m.testo}
              </div>

              {/* Allegati Messaggio */}
              {m.allegati && m.allegati.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    📎 Allegati confluite nel Vault Progetto:
                  </div>
                  {m.allegati.map((att, idx) => (
                    <div key={idx} style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                      <span style={{ fontWeight: 600, color: 'var(--indigo-l)' }}>📄 {att.nome} ({att.dimensione})</span>
                      <button
                        onClick={() => alert(`✓ File "${att.nome}" salvato ed indicizzato nel Vault Documentale del Progetto!`)}
                        style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                      >
                        + Sposta in Vault Progetto
                      </button>
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
              <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Canale Invio:</label>
              <select
                value={canaleSelezionato}
                onChange={e => setCanaleSelezionato(e.target.value as any)}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--card2)', color: 'var(--text)', border: '1px solid var(--border)', fontWeight: 600 }}
              >
                <option value="whatsapp">🟢 WhatsApp Business ({contactInfo.whatsapp})</option>
                <option value="email">✉️ Email ({contactInfo.email})</option>
                <option value="telegram">✈️ Telegram ({contactInfo.telegram})</option>
                <option value="signal">🔒 Signal ({contactInfo.signal})</option>
              </select>
            </div>

            {/* Dati Dinamici Presi dall'Anagrafica Accanto al Selettore */}
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
              <span style={{ fontWeight: 800 }}>{channelDetail.icon} {channelDetail.title}:</span>
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
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <textarea
            value={nuovoTesto}
            onChange={e => setNuovoTesto(e.target.value)}
            placeholder={`Scrivi un messaggio per ${contactInfo.referente} da inviare via ${canaleSelezionato.toUpperCase()} (${channelDetail.val})...`}
            rows={2}
            style={{ flex: 1, fontSize: 12.5, borderRadius: 10, padding: 10, resize: 'none' }}
          />
          <button
            type="submit"
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '0 24px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            Invia Ora →
          </button>
        </div>
      </form>
    </div>
  );
}
