import React, { useState, useEffect } from 'react';
import { fetchComunicazioniApi, inviaComunicazioneApi } from '../api/client';

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
  emailCliente: string;
}

export function ComunicazioniTab({ progettoId, nomeCliente, emailCliente }: ComunicazioniTabProps) {
  const [messaggi, setMessaggi] = useState<MessaggioComunicazione[]>([
    {
      id: 'msg-001',
      canale: 'email',
      mittente: 'client@holdingbeta.advisory',
      destinatario: 'joe@bluecode.advisory',
      direzione: 'entrata',
      testo: 'Buongiorno Joe, vi ho inviato a mezzo pec la delibera di approvazione bilancio 2025. In allegato la bozza preliminare per il deposito EUIPO.',
      dataOra: '14/08/2026 10:15',
      allegati: [
        { nome: 'Bozza_Marchio_EUIPO_HoldingBeta.pdf', url: '#', dimensione: '1.4 MB' },
      ],
    },
    {
      id: 'msg-002',
      canale: 'whatsapp',
      mittente: '+39 335 1234567 (Ing. Roberto Rossi)',
      destinatario: 'BluMan WhatsApp Studio (+356 79001122)',
      direzione: 'entrata',
      testo: 'Ciao Joe! Ho appena completato la registrazione sul Portale Cliente ed effettuato la Firma 1-Click della Proposta d\'Ordine. Procediamo con il deposito?',
      dataOra: '14/08/2026 11:30',
    },
    {
      id: 'msg-003',
      canale: 'whatsapp',
      mittente: 'Joe Disabato (Senior Advisor)',
      destinatario: '+39 335 1234567 (Ing. Roberto Rossi)',
      direzione: 'uscita',
      testo: 'Perfetto Roberto! Confermo ricezione firma ed allegati. L\'operatore ha avviato la microvoce per il deposito marchio. Ti aggiorniamo sul portale.',
      dataOra: '14/08/2026 11:45',
    },
    {
      id: 'msg-004',
      canale: 'telegram',
      mittente: '@RobertoRossiHoldingBeta',
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
      mittente: '+39 335 1234567 (Signal Cifrato)',
      destinatario: 'Studio Malta Secure Vault',
      direzione: 'entrata',
      testo: 'Messaggio con crittografia end-to-end: Confermo approvazione struttura holding partecipata Malta.',
      dataOra: '14/08/2026 16:50',
    },
  ]);

  const [nuovoTesto, setNuovoTesto] = useState('');
  const [canaleSelezionato, setCanaleSelezionato] = useState<'email' | 'whatsapp' | 'telegram' | 'signal'>('whatsapp');
  const [filtroCanale, setFiltroCanale] = useState<string>('TUTTI');

  useEffect(() => {
    const loadComunicazioni = async () => {
      const dbMsgs = await fetchComunicazioniApi(progettoId);
      if (dbMsgs && Array.isArray(dbMsgs) && dbMsgs.length > 0) {
        setMessaggi(dbMsgs.map((m: any) => ({
          ...m,
          dataOra: m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : m.dataOra,
          allegati: m.allegatiJson ? JSON.parse(m.allegatiJson) : m.allegati,
        })));
      }
    };
    loadComunicazioni();
  }, [progettoId]);

  const handleInviaMessaggio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuovoTesto.trim()) return;

    const mittente = 'Joe Disabato (Senior Advisor)';
    const destinatario = canaleSelezionato === 'email' ? emailCliente : `Cliente (${nomeCliente})`;

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

        {/* Filtri Canali */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
        </div>
      </div>

      {/* Info Banner Regole di Associazione Automatica */}
      <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', borderRadius: 12, padding: 14, fontSize: 11.5, color: '#34d399', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <strong>🔗 Associazione Automatica Attiva:</strong> I messaggi inviati da <code>{emailCliente}</code> ed dal cellulare registrato in anagrafica <code>+39 335 1234567</code> confluiscono automaticamente in questa scheda ed i file allegati vengono archiviati nel Vault.
        </div>
        <a
          href="/GUIDA_CONFIGURAZIONE_CANALI.md"
          target="_blank"
          rel="noreferrer"
          style={{ color: '#6ee7b7', textDecoration: 'underline', fontWeight: 600, fontSize: 11 }}
        >
          📖 Apri Guida Completa Setup API →
        </a>
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

      {/* Form Invio Messaggio Multicanale */}
      <form onSubmit={handleInviaMessaggio} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
            📤 Rispondi al Cliente dal Progetto:
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 11, color: 'var(--muted)' }}>Seleziona Canale Invio:</label>
            <select
              value={canaleSelezionato}
              onChange={e => setCanaleSelezionato(e.target.value as any)}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              <option value="whatsapp">🟢 WhatsApp Business (+39 335 1234567)</option>
              <option value="email">✉️ Email Inbound ({emailCliente})</option>
              <option value="telegram">✈️ Telegram Bot (@RobertoRossi)</option>
              <option value="signal">🔒 Signal End-to-End</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <textarea
            value={nuovoTesto}
            onChange={e => setNuovoTesto(e.target.value)}
            placeholder={`Scrivi un messaggio da inviare via ${canaleSelezionato.toUpperCase()}...`}
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
