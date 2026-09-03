import React, { useState } from 'react';
import type { Progetto } from '../../types';

// ─── Componente Calendario & Scadenzario Incarico ─────────────────
export function CalendarioProgettoTab({ project }: { project: Progetto }) {
  const [modalNewEvent, setModalNewEvent] = useState(false);
  const [titoloScadenza, setTitoloScadenza] = useState('');
  const [dataScadenza, setDataScadenza] = useState('');
  const [assegnatario, setAssegnatario] = useState('Joe Disabato');

  const [events, setEvents] = useState<any[]>([
    { id: 'ev-1', titolo: 'Consegna bozza Deed of Trust al Cliente', data: '18/08/2026', stato: 'pending', assegnatario: 'Joe Disabato', tipo: 'Milestone' },
    { id: 'ev-2', titolo: 'Deposito Istanza autorizzativa MFSA', data: '22/08/2026', stato: 'pending', assegnatario: 'Francesca Disabato', tipo: 'Compliance' },
    { id: 'ev-3', titolo: 'Call di allineamento con Advisor Elvetico', data: '25/08/2026', stato: 'pending', assegnatario: 'Avv. Lorenzo Marino', tipo: 'Meeting' },
    { id: 'ev-4', titolo: 'Verifica preliminare fascicolo KYC', data: '12/08/2026', stato: 'done', assegnatario: 'Elena Rossi', tipo: 'Check' },
  ]);

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titoloScadenza || !dataScadenza) return;
    const newEv = {
      id: `ev-${Date.now()}`,
      titolo: titoloScadenza,
      data: dataScadenza,
      stato: 'pending',
      assegnatario,
      tipo: 'Scadenza Incarico',
    };
    setEvents([newEv, ...events]);
    setModalNewEvent(false);
    setTitoloScadenza('');
    setDataScadenza('');
    alert(`✓ Scadenza "${titoloScadenza}" aggiunta allo Scadenzario del Progetto ed integrata nel Calendario Studio!`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Calendario */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--indigo-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📅 Scadenzario & Milestone Incarico</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Pianificazione temporale e promemoria delle scadenze operative per <strong>{project.cl}</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setModalNewEvent(true)}
          style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,.3)' }}
        >
          + Programma Nuova Scadenza
        </button>
      </div>

      {/* Lista Scadenze */}
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
          ⏱ Cronologia Scadenze e Promemoria Incarico
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map(ev => (
            <div key={ev.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 20 }}>{ev.stato === 'done' ? '✅' : '⏳'}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{ev.titolo}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Assegnato a: <strong>{ev.assegnatario}</strong> · Categoria: <span style={{ color: '#818cf8' }}>{ev.tipo}</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#818cf8', background: '#1a1f3d', padding: '4px 10px', borderRadius: 8, border: '1px solid #3730a3' }}>
                  📅 {ev.data}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEvents(events.map(x => x.id === ev.id ? { ...x, stato: x.stato === 'done' ? 'pending' : 'done' } : x));
                  }}
                  style={{ background: ev.stato === 'done' ? '#0d2d22' : 'transparent', border: `1px solid ${ev.stato === 'done' ? '#059669' : 'var(--border)'}`, color: ev.stato === 'done' ? '#34d399' : 'var(--muted)', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >
                  {ev.stato === 'done' ? '✓ Completato' : 'Marca Come Completato'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Nuova Scadenza */}
      {modalNewEvent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
          <form onSubmit={handleAddEvent} style={{ background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>+ Programma Nuova Scadenza Incarico</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Crea un evento nel calendario condiviso dello studio associato a questo progetto</div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Titolo Scadenza / Attività *</label>
              <input value={titoloScadenza} onChange={e => setTitoloScadenza(e.target.value)} required placeholder="es. Deposito statuto presso MFSA" style={{ fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Data Scadenza *</label>
              <input type="date" value={dataScadenza} onChange={e => setDataScadenza(e.target.value)} required style={{ fontSize: 12 }} />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Assegnatario *</label>
              <select value={assegnatario} onChange={e => setAssegnatario(e.target.value)} style={{ padding: 10, fontSize: 12 }}>
                <option value="Joe Disabato">Joe Disabato (Lead Advisor)</option>
                <option value="Francesca Disabato">Francesca Disabato (Back Office)</option>
                <option value="Avv. Lorenzo Marino">Avv. Lorenzo Marino (Legal Counsel)</option>
                <option value="Elena Rossi">Elena Rossi (Tax Advisor)</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => setModalNewEvent(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '7px 14px', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>Annulla</button>
              <button type="submit" style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ Salva Scadenza</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
