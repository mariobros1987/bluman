import { useEffect, useRef } from 'react';
import { inviaComunicazioneApi, fetchComunicazioniApi } from '../../api/client';
import type { ContattiStudio } from '../../api/client';
import { getStudioInfoForTenant } from '../../utils/tenant';
import { docBoxStyle } from './styles';

export interface TabContattiProps {
  contattiStudio: ContattiStudio | null;
  messaggi: any[];
  setMessaggi: (updater: (prev: any[]) => any[]) => void;
  nuovoMessaggio: string;
  setNuovoMessaggio: (valore: string) => void;
  inviandoMessaggio: boolean;
  setInviandoMessaggio: (valore: boolean) => void;
  canaleMessaggio: 'whatsapp' | 'email' | 'telegram' | 'portal';
  setCanaleMessaggio: (canale: any) => void;
  clientName: string;
  clientObj: any;
  progettoId: string;
}

export function TabContatti({
  contattiStudio,
  messaggi,
  setMessaggi,
  nuovoMessaggio,
  setNuovoMessaggio,
  inviandoMessaggio,
  setInviandoMessaggio,
  canaleMessaggio,
  setCanaleMessaggio,
  clientName,
  clientObj,
  progettoId,
}: TabContattiProps) {
  // Polling 5 s: così la risposta dell'advisor appare senza dover ricaricare la pagina.
  // Identico all'interval di ComunicazioniTab sul lato operatore. Se progettoId non è
  // ancora disponibile (progetto non ancora selezionato) il polling non parte.
  const setMessaggiRef = useRef(setMessaggi);
  setMessaggiRef.current = setMessaggi;

  useEffect(() => {
    if (!progettoId) return;
    const aggiorna = () => {
      fetchComunicazioniApi(progettoId)
        .then(msgs => {
          if (msgs && Array.isArray(msgs) && msgs.length > 0) {
            setMessaggiRef.current(() => msgs);
          }
        })
        .catch(() => {});
    };
    aggiorna();
    const id = setInterval(aggiorna, 5000);
    return () => clearInterval(id);
  }, [progettoId]);

  return (
    <div style={docBoxStyle}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>💬 Assistenza Dedicata & Comunicazioni Dirette Studio</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 18 }}>Invia messaggi in tempo reale al tuo Advisor di riferimento. La conversazione è sincronizzata con l'Advisor Hub dello Studio.</div>

      {/* §2.6 — Scheda Advisor costruita sui recapiti reali dello studio (riga del
          tenant), non su un nome e un telefono scritti a mano. Il pallino "Advisor
          Online" non c'è più: non riflette la presenza reale di nessuno. */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--indigo)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
          {(contattiStudio?.advisorNome || contattiStudio?.studio || '??')
            .split(/\s+/)
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {contattiStudio?.advisorNome || 'Il tuo Advisor di riferimento'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 600 }}>
            {contattiStudio?.studio || 'Studio'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {[
              contattiStudio?.advisorEmail ? `✉️ ${contattiStudio.advisorEmail}` : null,
              contattiStudio?.telefono ? `📞 ${contattiStudio.telefono}` : null,
              !contattiStudio?.advisorEmail && contattiStudio?.emailStudio ? `✉️ ${contattiStudio.emailStudio}` : null,
            ].filter(Boolean).join('  ·  ') || 'Recapiti non ancora configurati dallo studio'}
          </div>
        </div>
      </div>

      {/* Live Chat Timeline */}
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 360, overflowY: 'auto', marginBottom: 18 }}>
        {messaggi.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)', fontSize: 12 }}>
            💬 Nessun messaggio scambiato finora. Scrivi qui sotto per contattare il tuo Advisor.
          </div>
        ) : (
          messaggi.map((m: any, idx: number) => {
            const isCliente = m.direzione === 'entrata' || (m.mittente && m.mittente.includes('Cliente'));
            return (
              <div
                key={m.id || idx}
                style={{
                  alignSelf: isCliente ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: isCliente ? '#1e1b4b' : 'var(--card2)',
                  border: `1px solid ${isCliente ? '#4338ca' : 'var(--border)'}`,
                  borderRadius: 12,
                  padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: isCliente ? '#a5b4fc' : 'var(--indigo-l)' }}>
                    {/* §2.6: il mittente dello studio prende il nome vero se c'è, senza
                        inventare una persona. */}
                    {isCliente ? 'Tu (Cliente)' : (m.mittente || contattiStudio?.advisorNome || 'Studio (Advisor)')}
                  </span>
                  <span style={{ fontSize: 9.5, color: 'var(--muted)' }}>
                    {m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : (m.dataOra || 'Oggi')}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                  {m.testo}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Live Message Sender Form */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!nuovoMessaggio.trim() || inviandoMessaggio) return;
          setInviandoMessaggio(true);

          // §2.6: il destinatario è lo studio reale (e il suo advisor se c'è), non un
          // nome cablato.
          const destinatarioStudio = contattiStudio?.advisorNome
            ? `${contattiStudio.studio || 'Studio'} (${contattiStudio.advisorNome})`
            : (contattiStudio?.studio || 'Studio');

          const msgObj = {
            id: `msg-${Date.now()}`,
            canale: canaleMessaggio,
            mittente: `${clientName} (Cliente)`,
            destinatario: destinatarioStudio,
            direzione: 'entrata',
            testo: nuovoMessaggio.trim(),
            dataOra: new Date().toLocaleString('it-IT'),
          };

          setMessaggi(prev => [...prev, msgObj]);

          try {
            await inviaComunicazioneApi(progettoId, {
              canale: canaleMessaggio,
              mittente: `${clientName} (Cliente)`,
              destinatario: destinatarioStudio,
              direzione: 'entrata',
              testo: nuovoMessaggio.trim(),
            });
          } catch (err) {
            console.warn('Errore invio messaggio portale:', err);
          }

          setNuovoMessaggio('');
          setInviandoMessaggio(false);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--card2)', padding: 14, borderRadius: 12, border: '1px solid var(--border)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Invia messaggio diretto all'Advisor:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>Canale preferito:</span>
            <select
              value={canaleMessaggio}
              onChange={(e) => setCanaleMessaggio(e.target.value as any)}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
            >
              {/*
                I tre ripieghi che stavano qui — un cellulare di una persona reale, un
                indirizzo inventato e una @ costruita dal nome del cliente — comparivano
                nella tendina di qualunque cliente che non avesse quel recapito in
                anagrafica, e sceglierli significava chiedere l'invio a un estraneo. Ora
                il canale senza recapito si vede spento e non è selezionabile.
              */}
              <option value="portal">🌐 Portale Riservato (Sicuro)</option>
              {(() => {
                const referenti = (clientObj as any)?.referentiJson || {};
                const recapiti: Array<{ id: string; etichetta: string; valore?: string | null }> = [
                  { id: 'whatsapp', etichetta: '🟢 WhatsApp Business', valore: clientObj?.cellulare || referenti.whatsapp || clientObj?.telefono },
                  { id: 'email', etichetta: '✉️ Email', valore: clientObj?.email || referenti.email },
                  { id: 'telegram', etichetta: '✈️ Telegram', valore: clientObj?.telegram || referenti.telegram },
                ];
                return recapiti.map((r) => (
                  <option key={r.id} value={r.id} disabled={!r.valore}>
                    {r.etichetta} {r.valore ? `(${r.valore})` : '— recapito non presente in anagrafica'}
                  </option>
                ));
              })()}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <textarea
            value={nuovoMessaggio}
            onChange={(e) => setNuovoMessaggio(e.target.value)}
            placeholder="Scrivi qui la tua richiesta o domanda per l'Advisor..."
            rows={2}
            style={{ flex: 1, fontSize: 12, padding: 10, borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'none' }}
          />
          <button
            type="submit"
            disabled={inviandoMessaggio || !nuovoMessaggio.trim()}
            style={{
              background: 'var(--indigo)',
              color: '#fff',
              border: 'none',
              padding: '0 20px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              opacity: (!nuovoMessaggio.trim() || inviandoMessaggio) ? 0.6 : 1,
            }}
          >
            {inviandoMessaggio ? 'Invio...' : 'Invia →'}
          </button>
        </div>
      </form>

      {/* §2.6 — Sede legale dello studio: prima dai contatti reali letti dal tenant, con
          il ripiego locale solo se il backend non ha risposto. */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Sede Legale {contattiStudio?.studio || getStudioInfoForTenant().ragioneSociale}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          {contattiStudio?.sedeLegale || getStudioInfoForTenant().sedeLegale || 'Sede in fase di configurazione'}<br />
          {contattiStudio?.emailStudio ? `✉️ ${contattiStudio.emailStudio}` : (getStudioInfoForTenant().email ? `${getStudioInfoForTenant().email}` : '')}
        </div>
      </div>
    </div>
  );
}
