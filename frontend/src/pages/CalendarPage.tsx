import React, { useState, useEffect } from 'react';
import { triggerCronScadenzeApi, fetchProgetti, fetchClienti, fetchTutteFattureStudioApi } from '../api/client';
import { getCurrentTenantId, getTenantStorageKey, getStudioInfoForTenant } from '../utils/tenant';

interface EventoStudio {
  id: string;
  titolo: string;
  data: string; // YYYY-MM-DD
  ora?: string;
  categoria: 'microvoce' | 'kyc' | 'fattura' | 'contratto' | 'promemoria';
  priorita: 'alta' | 'media' | 'normale';
  clienteNome?: string;
  progettoId?: number | string;
  progettoNome?: string;
  operatoreNome?: string;
  stato: 'pending' | 'delayed' | 'done';
  note?: string;
}

export function CalendarPage() {
  const [viewMode, setViewMode] = useState<'mese' | 'lista'>('mese');
  const [filterCat, setFilterCat] = useState<string>('tutti');
  const [selectedEvent, setSelectedEvent] = useState<EventoStudio | null>(null);
  const [newEventModalOpen, setNewEventModalOpen] = useState(false);
  const [events, setEvents] = useState<EventoStudio[]>([]);

  // Carica i dati reali da Progetti, Clienti ERP e Fatture isolati per Tenant
  useEffect(() => {
    const loadRealEvents = async () => {
      try {
        const currentTenantId = getCurrentTenantId();
        const studioInfo = getStudioInfoForTenant(currentTenantId);

        const [prjs, cls, invs] = await Promise.all([
          fetchProgetti(),
          fetchClienti(),
          fetchTutteFattureStudioApi(),
        ]);

        const filteredPrjs = (prjs || []).filter((p: any) => !p.tenantId || p.tenantId === currentTenantId);
        const filteredCls = (cls || []).filter((c: any) => !c.tenantId || c.tenantId === currentTenantId);
        const filteredInvs = (invs || []).filter((i: any) => !i.tenantId || i.tenantId === currentTenantId);

        const dynamicEvents: EventoStudio[] = [];

        // 1. Eventi da Clienti
        if (filteredCls && Array.isArray(filteredCls)) {
          filteredCls.forEach((c: any, idx: number) => {
            const dateStr = c.dataKyc ? new Date(c.dataKyc).toISOString().slice(0, 10) : `2026-08-${(12 + (idx % 15)).toString().padStart(2, '0')}`;
            dynamicEvents.push({
              id: `kyc-${c.id}`,
              titolo: `Rinnovo Compliance UBO & Audit KYC`,
              data: dateStr,
              ora: '10:00',
              categoria: 'kyc',
              priorita: 'alta',
              clienteNome: c.nome,
              operatoreNome: studioInfo.leadAdvisor || 'Lead Advisor',
              stato: 'pending',
              note: `Verifica annuale antiriciclaggio e registro titolari effettivi per ${c.nome}.`,
            });
          });
        }

        // 2. Eventi da Progetti
        if (filteredPrjs && Array.isArray(filteredPrjs)) {
          filteredPrjs.forEach((p: any, pIdx: number) => {
            dynamicEvents.push({
              id: `prj-${p.id}`,
              titolo: `Consegna Milestone: ${p.titolo || p.nome || 'Incarico'}`,
              data: `2026-08-${(14 + (pIdx % 12)).toString().padStart(2, '0')}`,
              ora: '14:30',
              categoria: 'microvoce',
              priorita: p.delay ? 'alta' : 'media',
              clienteNome: p.cliente?.nome || p.cl || 'Cliente Studio',
              progettoId: p.id,
              progettoNome: p.titolo || p.nome,
              operatoreNome: studioInfo.leadAdvisor || 'Lead Advisor',
              stato: p.delay ? 'delayed' : 'pending',
              note: `Avanzamento del progetto ${p.titolo || p.nome} con coordinamento team.`,
            });
          });
        }

        // 3. Eventi da Fatture
        if (filteredInvs && Array.isArray(filteredInvs)) {
          filteredInvs.forEach((inv: any, iIdx: number) => {
            dynamicEvents.push({
              id: `inv-${inv.id}`,
              titolo: `Scadenza Rata Fattura ${inv.numeroProgressivoSerie || inv.numero || 'FT-2026'}`,
              data: inv.dataEmissione ? new Date(inv.dataEmissione).toISOString().slice(0, 10) : `2026-08-${(18 + (iIdx % 10)).toString().padStart(2, '0')}`,
              ora: '09:00',
              categoria: 'fattura',
              priorita: 'alta',
              clienteNome: inv.progetto?.cliente?.nome || 'Cliente Incarico',
              progettoNome: inv.progetto?.nome || 'Incarico',
              operatoreNome: studioInfo.leadAdvisor || 'Lead Advisor',
              stato: inv.stato === 'incassata' ? 'done' : 'pending',
              note: `Importo da incassare: €${((inv.importoTotaleCentesimi || 350000) / 100).toFixed(2)} tramite bonifico bancario.`,
            });
          });
        }

        // Recupera eventuali eventi custom creati a mano dall'utente
        const calStorageKey = getTenantStorageKey('bluman_custom_calendar_events', currentTenantId);
        const savedCustom = localStorage.getItem(calStorageKey);
        const customEvents: EventoStudio[] = savedCustom ? JSON.parse(savedCustom) : [];

        const merged = [...customEvents, ...dynamicEvents];
        setEvents(merged);
      } catch (err) {
        console.warn('Errore sync eventi calendario:', err);
      }
    };

    loadRealEvents();
  }, []);

  // New Event Form State
  const [formTitolo, setFormTitolo] = useState('');
  const [formData, setFormData] = useState('2026-08-18');
  const [formOra, setFormOra] = useState('10:00');
  const [formCat, setFormCat] = useState<'microvoce' | 'kyc' | 'fattura' | 'contratto' | 'promemoria'>('promemoria');
  const [formPriorita, setFormPriorita] = useState<'alta' | 'media' | 'normale'>('normale');
  const [formCliente, setFormCliente] = useState('Holding Beta S.r.l.');
  const [formOperatore] = useState('Joe Disabato');
  const [formNote, setFormNote] = useState('');

  const handleCreateEventSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitolo) return;
    const newEv: EventoStudio = {
      id: `ev-custom-${Date.now()}`,
      titolo: formTitolo,
      data: formData,
      ora: formOra,
      categoria: formCat,
      priorita: formPriorita,
      clienteNome: formCliente,
      operatoreNome: formOperatore || 'Joe Disabato',
      stato: 'pending',
      note: formNote,
    };
    
    // Aggiorna stato e localStorage custom
    const updated = [newEv, ...events];
    setEvents(updated);
    
    const savedCustom = localStorage.getItem('bluman_custom_calendar_events');
    const customList: EventoStudio[] = savedCustom ? JSON.parse(savedCustom) : [];
    customList.unshift(newEv);
    localStorage.setItem('bluman_custom_calendar_events', JSON.stringify(customList));

    setNewEventModalOpen(false);
    setFormTitolo('');
    setFormNote('');
  };

  const handleToggleComplete = (id: string) => {
    setEvents(events.map(ev => ev.id === id ? { ...ev, stato: ev.stato === 'done' ? 'pending' : 'done' } : ev));
    if (selectedEvent?.id === id) {
      setSelectedEvent(prev => prev ? { ...prev, stato: prev.stato === 'done' ? 'pending' : 'done' } : null);
    }
  };

  const filteredEvents = events.filter(ev => {
    if (filterCat === 'tutti') return true;
    return ev.categoria === filterCat;
  });

  // Days matrix for August 2026
  const daysInMonth = 31;
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header & Controls */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>📅 Calendario Condiviso & Scadenzario Studio</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Pianificazione unificata di microvoci, rinnovi compliance KYC, emissioni fatture e promemoria
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* View Mode Toggle */}
          <div style={{ background: 'var(--card2)', padding: 3, borderRadius: 10, display: 'flex', gap: 2, border: '1px solid var(--border)' }}>
            <button
              onClick={() => setViewMode('mese')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                background: viewMode === 'mese' ? 'var(--indigo)' : 'transparent',
                color: viewMode === 'mese' ? '#fff' : 'var(--muted)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📅 Vista Mese
            </button>
            <button
              onClick={() => setViewMode('lista')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                background: viewMode === 'lista' ? 'var(--indigo)' : 'transparent',
                color: viewMode === 'lista' ? '#fff' : 'var(--muted)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              📋 Scadenzario Lista
            </button>
          </div>

          <button
            onClick={async () => {
              // §3.3 — triggerCronScadenzeApi ora lancia davvero: il successo si annuncia
              // solo con il report restituito dal server, mai con un messaggio inventato.
              try {
                const res = await triggerCronScadenzeApi();
                alert(res?.message || '✓ Scansione cron completata con successo!');
              } catch (err: any) {
                alert(`⚠️ Scansione cron NON eseguita: ${err?.message || 'errore di rete'}. Le notifiche di scadenza NON sono state inviate.`);
              }
            }}
            style={{ background: '#1e1b4b', color: '#a5b4fc', border: '1px solid #4338ca', padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>⏰ Esegui Cron Notifiche</span>
          </button>

          <button
            onClick={() => setNewEventModalOpen(true)}
            style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
          >
            + Nuovo Evento Studio
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {[
          { key: 'tutti', label: 'Tutti gli Eventi', icon: '📌' },
          { key: 'microvoce', label: '⚡ Microvoci Progetto', icon: '⚡' },
          { key: 'kyc', label: '🔍 Compliance KYC/AML', icon: '🔍' },
          { key: 'fattura', label: '💶 Emissione Fatture', icon: '💶' },
          { key: 'contratto', label: '📜 Firma Contratti', icon: '📜' },
          { key: 'promemoria', label: '🔔 Promemoria Team', icon: '🔔' },
        ].map(cat => (
          <button
            key={cat.key}
            onClick={() => setFilterCat(cat.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: filterCat === cat.key ? '1px solid var(--indigo)' : '1px solid var(--border)',
              background: filterCat === cat.key ? 'var(--card2)' : 'var(--card)',
              color: filterCat === cat.key ? 'var(--indigo-l)' : 'var(--muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      {viewMode === 'mese' ? (
        /* Month View Grid */
        <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Agosto 2026</h3>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{filteredEvents.length} Scadenze programmate</span>
          </div>

          {/* Days Headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
            <div>Lun</div><div>Mar</div><div>Mer</div><div>Gio</div><div>Ven</div><div>Sab</div><div>Dom</div>
          </div>

          {/* Days Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {daysArray.map(day => {
              const dayStr = `2026-08-${day < 10 ? '0' + day : day}`;
              const dayEvents = filteredEvents.filter(e => e.data === dayStr);
              const isToday = day === 14;

              return (
                <div
                  key={day}
                  style={{
                    minHeight: 94,
                    background: isToday ? 'var(--card)' : 'var(--bg)',
                    border: isToday ? '2px solid var(--indigo)' : '1px solid var(--border)',
                    borderRadius: 12,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isToday ? 'var(--indigo-l)' : 'var(--muted)' }}>
                      {day} {isToday && <span style={{ fontSize: 9, background: 'var(--indigo)', color: '#fff', padding: '1px 5px', borderRadius: 10 }}>Oggi</span>}
                    </span>
                  </div>

                  {/* Day Event Badges */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dayEvents.map(ev => {
                      const color = getCategoryColor(ev.categoria);
                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedEvent(ev)}
                          style={{
                            background: color.bg,
                            border: `1px solid ${color.border}`,
                            color: color.text,
                            padding: '3px 6px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            textDecoration: ev.stato === 'done' ? 'line-through' : 'none',
                            opacity: ev.stato === 'done' ? 0.6 : 1,
                          }}
                          title={`${ev.titolo} (${ev.ora || 'Tutto il giorno'})`}
                        >
                          {ev.ora ? `${ev.ora} ` : ''}{ev.titolo}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Agenda List View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredEvents.map(ev => {
            const color = getCategoryColor(ev.categoria);
            const isDone = ev.stato === 'done';

            return (
              <div
                key={ev.id}
                style={{
                  background: 'var(--card)',
                  border: `1px solid ${isDone ? '#059669' : 'var(--border)'}`,
                  borderRadius: 14,
                  padding: 16,
                  display: 'flex',
                  // `justify` non esiste in CSSProperties: era ignorato dal browser e le
                  // schede non si disponevano come previsto.
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  boxShadow: '0 4px 14px rgba(0,0,0,.2)',
                  opacity: isDone ? 0.7 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <button
                    onClick={() => handleToggleComplete(ev.id)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      border: `2px solid ${isDone ? '#34d399' : 'var(--muted)'}`,
                      background: isDone ? '#34d399' : 'transparent',
                      color: '#fff',
                      fontSize: 12,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Marca come completato"
                  >
                    {isDone ? '✓' : ''}
                  </button>

                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', textDecoration: isDone ? 'line-through' : 'none' }}>
                      {ev.titolo}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span>📅 {ev.data} {ev.ora ? `alle ${ev.ora}` : ''}</span>
                      {ev.clienteNome && <span>🏢 {ev.clienteNome}</span>}
                      {ev.operatoreNome && <span>👤 {ev.operatoreNome}</span>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: color.bg, border: `1px solid ${color.border}`, color: color.text }}>
                    {ev.categoria.toUpperCase()}
                  </span>

                  <button
                    onClick={() => setSelectedEvent(ev)}
                    style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                  >
                    👁 Dettagli
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Dettagli Evento */}
      {selectedEvent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: getCategoryColor(selectedEvent.categoria).bg, color: getCategoryColor(selectedEvent.categoria).text }}>
                  {selectedEvent.categoria.toUpperCase()}
                </span>
                <h3 style={{ margin: '8px 0 0 0', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{selectedEvent.titolo}</h3>
              </div>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
              <div><strong>📅 Data e Ora:</strong> {selectedEvent.data} {selectedEvent.ora ? `alle ${selectedEvent.ora}` : ''}</div>
              {selectedEvent.clienteNome && <div><strong>🏢 Cliente ERP:</strong> {selectedEvent.clienteNome}</div>}
              {selectedEvent.progettoNome && <div><strong>📁 Progetto:</strong> {selectedEvent.progettoNome}</div>}
              {selectedEvent.operatoreNome && <div><strong>👤 Operatore Assegnato:</strong> {selectedEvent.operatoreNome}</div>}
              <div><strong>⚡ Stato Attuale:</strong> {selectedEvent.stato === 'done' ? '✓ Completato' : selectedEvent.stato === 'delayed' ? '⚠ In Ritardo' : '⏳ In Corso'}</div>
              {selectedEvent.note && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, color: 'var(--muted)', fontSize: 11 }}>
                  <strong>📝 Note Operative:</strong> {selectedEvent.note}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <button
                type="button"
                onClick={() => handleToggleComplete(selectedEvent.id)}
                style={{
                  background: selectedEvent.stato === 'done' ? 'var(--card2)' : '#059669',
                  color: selectedEvent.stato === 'done' ? 'var(--text)' : '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {selectedEvent.stato === 'done' ? '↩ Riapri Evento' : '✓ Segna Come Completato'}
              </button>

              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 16px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}
              >
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nuovo Evento Studio */}
      {newEventModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <form onSubmit={handleCreateEventSubmit} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>+ Nuovo Evento / Promemoria Studio</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolo Scadenza *</label>
              <input type="text" value={formTitolo} onChange={e => setFormTitolo(e.target.value)} required placeholder="Es. Consegna fascicolo notarile" style={{ width: '100%', fontSize: 13 }} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data Scadenza *</label>
                <input type="date" value={formData} onChange={e => setFormData(e.target.value)} required style={{ width: '100%', fontSize: 12 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Ora (opzionale)</label>
                <input type="time" value={formOra} onChange={e => setFormOra(e.target.value)} style={{ width: '100%', fontSize: 12 }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Categoria *</label>
                <select value={formCat} onChange={e => setFormCat(e.target.value as any)} style={{ padding: 8, fontSize: 12 }}>
                  <option value="microvoce">⚡ Microvoce Progetto</option>
                  <option value="kyc">🔍 Compliance KYC/AML</option>
                  <option value="fattura">💶 Emissione Fattura</option>
                  <option value="contratto">📜 Firma Contratto</option>
                  <option value="promemoria">🔔 Promemoria Team</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Priorità *</label>
                <select value={formPriorita} onChange={e => setFormPriorita(e.target.value as any)} style={{ padding: 8, fontSize: 12 }}>
                  <option value="alta">🔴 Alta</option>
                  <option value="media">🟡 Media</option>
                  <option value="normale">🟢 Normale</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Cliente Associato (dall'Anagrafica ERP) *</label>
              <select value={formCliente} onChange={e => setFormCliente(e.target.value)} style={{ padding: 8, fontSize: 12 }}>
                <option value="Holding Beta S.r.l.">Holding Beta S.r.l. (P.IVA 01234567890)</option>
                <option value="Gamma Real Estate S.r.l.">Gamma Real Estate S.r.l. (P.IVA 09876543210)</option>
                <option value="Delta Tech Kft (Ungheria)">Delta Tech Kft (HU12345678)</option>
                <option value="Famiglia Conti (Wealth)">Famiglia Conti (Wealth Privato)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note Operative</label>
              <textarea value={formNote} onChange={e => setFormNote(e.target.value)} rows={2} placeholder="Dettagli ed istruzioni per l'operatore..." style={{ width: '100%', fontSize: 12 }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => setNewEventModalOpen(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Salva Evento</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function getCategoryColor(cat: EventoStudio['categoria']) {
  switch (cat) {
    case 'microvoce':  return { bg: '#312e81', border: '#4338ca', text: '#a5b4fc' };
    case 'kyc':        return { bg: '#701a75', border: '#86198f', text: '#f5d0fe' };
    case 'fattura':    return { bg: '#064e3b', border: '#047857', text: '#a7f3d0' };
    case 'contratto':  return { bg: '#78350f', border: '#b45309', text: '#fde68a' };
    default:           return { bg: '#1e293b', border: '#334155', text: '#cbd5e1' };
  }
}
