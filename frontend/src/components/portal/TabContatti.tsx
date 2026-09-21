import { useEffect, useRef, useState, useMemo } from 'react';
import { inviaComunicazioneApi, fetchComunicazioniApi, segnaComunicazioniLetteApi } from '../../api/client';
import { uploadFileApi, urlDocumentoAssoluto } from '../../api/documenti';
import type { ContattiStudio } from '../../api/client';
import { getStudioInfoForTenant } from '../../utils/tenant';
import { SpunteStato } from '../SpunteStato';
import { docBoxStyle } from './styles';
import { useToast } from '../ui/ToastProvider';

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
  const toast = useToast();
  const [fileAllegato, setFileAllegato] = useState<{ nome: string; base64: string; sizeStr: string; mime: string } | null>(null);
  const [caricandoFile, setCaricandoFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Smart Chat Scroll & Unread Marker
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unreadMarkerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [initialScrollDone, setInitialScrollDone] = useState(false);

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
            const normalizzati = msgs.map((m: any) => ({
              ...m,
              dataOra: m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : (m.dataOra || 'Oggi'),
              allegati: m.allegatiJson
                ? (typeof m.allegatiJson === 'string' ? (() => { try { return JSON.parse(m.allegatiJson); } catch { return []; } })() : m.allegatiJson)
                : (m.allegati || []),
              // `?? null` e non `|| 'consegnato'`: qui il portale dichiarava consegnato ciò che
              // nessuno aveva dichiarato, e ci disegnava sopra le due spunte (regola 7).
              stato: m.stato ?? null,
              inviatoAt: m.inviatoAt || null,
              lettoAt: m.lettoAt || null,
              consegnatoAt: m.consegnatoAt || null,
              errore: m.errore || null,
            }));
            setMessaggiRef.current(() => normalizzati);

            // Se ci sono messaggi inviati dallo studio non ancora letti dal cliente, li segna come letti
            const daLeggere = normalizzati.some((m: any) => m.direzione === 'uscita' && m.stato !== 'letto');
            if (daLeggere) {
              segnaComunicazioniLetteApi(progettoId, 'uscita').catch(() => {});
            }
          }
        })
        .catch(() => {});
    };
    aggiorna();
    const id = setInterval(aggiorna, 5000);
    return () => clearInterval(id);
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
      if (distFromBottom < 140) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messaggi.length]);

  const handleChatScroll = () => {
    if (!chatContainerRef.current) return;
    const el = chatContainerRef.current;
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 100;
    setShowScrollBottom(isUp);
  };

  const primoNonLettoId = useMemo(() => {
    const primo = messaggi.find((m: any) => m.direzione === 'uscita' && m.stato !== 'letto');
    return primo ? (primo.id || primo.createdAt) : null;
  }, [messaggi]);

  const nuoviNonLettiCount = useMemo(() => {
    return messaggi.filter((m: any) => m.direzione === 'uscita' && m.stato !== 'letto').length;
  }, [messaggi]);

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

      {/* Live Chat Timeline con Smart Scroll e Spunte di Stato */}
      <div style={{ position: 'relative' }}>
        <div
          ref={chatContainerRef}
          onScroll={handleChatScroll}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 360, overflowY: 'auto', marginBottom: 18 }}
        >
          {messaggi.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--muted)', fontSize: 12 }}>
              💬 Nessun messaggio scambiato finora. Scrivi qui sotto per contattare il tuo Advisor.
            </div>
          ) : (
            messaggi.map((m: any, idx: number) => {
              const isCliente = m.direzione === 'entrata' || (m.mittente && m.mittente.includes('Cliente'));
              const isFirstUnread = (m.id || m.createdAt) === primoNonLettoId;
              return (
                <div key={m.id || idx} style={{ display: 'flex', flexDirection: 'column' }}>
                  {isFirstUnread && (
                    <div ref={unreadMarkerRef} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0', opacity: 0.95 }}>
                      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--indigo))' }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--pill-indigo-fg)', background: 'var(--pill-indigo-bg)', border: '1px solid var(--indigo-d)', padding: '2px 10px', borderRadius: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span>🔔</span>
                        <span>Nuovi messaggi dallo Studio</span>
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--indigo), transparent)' }} />
                    </div>
                  )}
                  <div
                    style={{
                      alignSelf: isCliente ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      background: isCliente ? 'var(--pill-indigo-bg)' : 'var(--card2)',
                      border: `1px solid ${isCliente ? 'var(--indigo-d)' : 'var(--border)'}`,
                      borderRadius: 12,
                      padding: '10px 14px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isCliente ? 'var(--pill-indigo-fg)' : 'var(--indigo-l)' }}>
                        {/* §2.6: il mittente dello studio prende il nome vero se c'è, senza inventare una persona. */}
                        {isCliente ? 'Tu (Cliente)' : (m.mittente || contattiStudio?.advisorNome || 'Studio (Advisor)')}
                      </span>
                      <span style={{ fontSize: 9.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>{m.createdAt ? new Date(m.createdAt).toLocaleString('it-IT') : (m.dataOra || 'Oggi')}</span>
                        {/* Le spunte di un messaggio che il cliente ha scritto riguardano lo
                            Studio: «arrivato» e «letto» qui non parlano di WhatsApp né di Meta.
                            Il segno arriva da `SpunteStato`, lo stesso che usa la chat
                            dell'operatore, così i due non possono più divergere. */}
                        {isCliente && (
                          <SpunteStato
                            stato={m.stato}
                            inviatoAt={m.inviatoAt}
                            consegnatoAt={m.consegnatoAt}
                            lettoAt={m.lettoAt}
                            errore={m.errore}
                            contesto="portale"
                          />
                        )}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                      {m.testo}
                    </div>

                    {/* Allegati allegati al messaggio */}
                    {m.allegati && m.allegati.length > 0 && (
                      <div style={{ marginTop: 8, borderTop: `1px solid ${isCliente ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 9.5, color: isCliente ? 'var(--pill-indigo-fg)' : 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                          📎 Allegati ({m.allegati.length}):
                        </div>
                        {m.allegati.map((att: any, attIdx: number) => {
                          const downloadUrl = urlDocumentoAssoluto(att.url || '#');
                          return (
                            <div key={attIdx} style={{ background: isCliente ? 'rgba(0,0,0,0.25)' : 'var(--card)', border: `1px solid ${isCliente ? 'rgba(255,255,255,0.15)' : 'var(--border)'}`, borderRadius: 6, padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                <span>📄</span>
                                <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <div style={{ fontWeight: 600, fontSize: 11, color: isCliente ? '#fff' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{att.nome}</div>
                                  {att.dimensione && <div style={{ fontSize: 9, color: isCliente ? 'var(--pill-indigo-fg)' : 'var(--muted)' }}>{att.dimensione}</div>}
                                </div>
                              </div>
                              <a
                                href={downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                download={att.nome}
                                style={{
                                  background: isCliente ? 'var(--indigo-d)' : 'var(--muted)',
                                  color: '#fff',
                                  border: '1px solid rgba(255,255,255,0.2)',
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  textDecoration: 'none',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ⬇️ Scarica
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {showScrollBottom && (
          <button
            type="button"
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            style={{
              position: 'absolute',
              bottom: 26,
              right: 20,
              background: 'var(--indigo)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 20,
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 700,
              boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              zIndex: 10,
            }}
          >
            <span>⬇️ Scorri all'ultimo</span>
            {nuoviNonLettiCount > 0 && (
              <span style={{ background: 'var(--red)', color: '#fff', borderRadius: '50%', fontSize: 9, padding: '1px 5px', fontWeight: 800 }}>
                {nuoviNonLettiCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Live Message Sender Form con Supporto Allegati */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if ((!nuovoMessaggio.trim() && !fileAllegato) || inviandoMessaggio || caricandoFile) return;
          setInviandoMessaggio(true);

          // §2.6: il destinatario è lo studio reale (e il suo advisor se c'è), non un nome cablato.
          const destinatarioStudio = contattiStudio?.advisorNome
            ? `${contattiStudio.studio || 'Studio'} (${contattiStudio.advisorNome})`
            : (contattiStudio?.studio || 'Studio');

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
              console.warn('Errore upload allegato portale:', errUp);
            } finally {
              setCaricandoFile(false);
            }
          }

          const testoFinale = nuovoMessaggio.trim() || (allegatiCaricati ? `[Allegato: ${allegatiCaricati[0].nome}]` : '');

          const msgObj = {
            id: `msg-${Date.now()}`,
            canale: canaleMessaggio,
            mittente: `${clientName} (Cliente)`,
            destinatario: destinatarioStudio,
            direzione: 'entrata',
            testo: testoFinale,
            dataOra: new Date().toLocaleString('it-IT'),
            allegati: allegatiCaricati || [],
          };

          setMessaggi(prev => [...prev, msgObj]);

          try {
            await inviaComunicazioneApi(progettoId, {
              canale: canaleMessaggio,
              mittente: `${clientName} (Cliente)`,
              destinatario: destinatarioStudio,
              direzione: 'entrata',
              testo: testoFinale,
              ...(allegatiCaricati ? { allegatiJson: allegatiCaricati } : {}),
            });
          } catch (err) {
            console.warn('Errore invio messaggio portale:', err);
          }

          setNuovoMessaggio('');
          setFileAllegato(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
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

        {/* Chip file allegato in anteprima */}
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
            value={nuovoMessaggio}
            onChange={(e) => setNuovoMessaggio(e.target.value)}
            placeholder="Scrivi qui la tua richiesta o domanda per l'Advisor..."
            rows={2}
            style={{ flex: 1, fontSize: 12, padding: 10, borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', resize: 'none' }}
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
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
              height: 42,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            📎
          </button>

          <button
            type="submit"
            disabled={inviandoMessaggio || caricandoFile || (!nuovoMessaggio.trim() && !fileAllegato)}
            style={{
              background: 'var(--indigo)',
              color: '#fff',
              border: 'none',
              padding: '0 20px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              height: 42,
              opacity: (!nuovoMessaggio.trim() && !fileAllegato) || inviandoMessaggio || caricandoFile ? 0.6 : 1,
            }}
          >
            {inviandoMessaggio || caricandoFile ? 'Invio...' : 'Invia →'}
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
