import React, { useState } from 'react';
import { TEAM } from '../store/mockData';
import { Avatar } from './ui/Avatar';

interface CalendarPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  microvoceName: string;
  projectName: string;
  initialDate?: string;
  onSchedule: (date: string, operatorId: number, priority: string, sendEmail: boolean) => void;
}

export function CalendarPreviewModal({
  isOpen,
  onClose,
  microvoceName,
  projectName,
  initialDate = '2026-08-25',
  onSchedule,
}: CalendarPreviewModalProps) {
  const [selectedDate, setSelectedDate] = useState<string>(initialDate);
  const [operatorId, setOperatorId] = useState<number>(1);
  const [priority, setPriority] = useState<string>('alta');
  const [sendEmail, setSendEmail] = useState<boolean>(true);
  const [confirmed, setConfirmed] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    onSchedule(selectedDate, operatorId, priority, sendEmail);
    setConfirmed(true);
    setTimeout(() => {
      setConfirmed(false);
      onClose();
    }, 1200);
  };

  // Generatore minicalendario Agosto 2026
  const daysInMonth = Array.from({ length: 31 }, (_, i) => i + 1);
  const currentDayNumber = Number(selectedDate.split('-')[2]) || 25;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15,23,42,0.8)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: 16,
    }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        maxWidth: 580,
        width: '100%',
        padding: 26,
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
        color: 'var(--text)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--indigo-l)', fontWeight: 800, letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📅 PROGRAMMAZIONE SCADENZARIO STUDIO</span>
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, margin: '4px 0 0 0', background: 'linear-gradient(90deg, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Pianifica Scadenza Attività
            </h3>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              Microvoce: <strong style={{ color: 'var(--indigo-l)' }}>{microvoceName}</strong> ({projectName})
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ✕
          </button>
        </div>

        {confirmed && (
          <div style={{ background: '#0d2d22', border: '1px solid #1a5c3c', color: '#34d399', padding: '12px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, marginBottom: 16 }}>
            ✓ Scadenza inserita nel Calendario Condiviso Studio e notificata all'operatore!
          </div>
        )}

        <form onSubmit={handleConfirm}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20, marginBottom: 20 }}>
            {/* Left Column: Mini Calendar Picker */}
            <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>🗓 Agosto 2026</span>
                <span style={{ fontSize: 10, color: 'var(--indigo-l)', fontWeight: 700 }}>{selectedDate}</span>
              </div>

              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 9, color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}>
                <span>LU</span><span>MA</span><span>ME</span><span>GI</span><span>VE</span><span>SA</span><span>DO</span>
              </div>

              {/* Days Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {daysInMonth.map(day => {
                  const dayStr = `2026-08-${String(day).padStart(2, '0')}`;
                  const isSelected = day === currentDayNumber;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => setSelectedDate(dayStr)}
                      style={{
                        padding: '6px 0',
                        borderRadius: 6,
                        border: isSelected ? '1.5px solid var(--indigo)' : '1px solid transparent',
                        background: isSelected ? 'var(--indigo)' : 'rgba(255,255,255,0.02)',
                        color: isSelected ? '#fff' : 'var(--text)',
                        fontSize: 11,
                        fontWeight: isSelected ? 800 : 500,
                        cursor: 'pointer',
                        transition: 'all .12s ease',
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              {/* Presets */}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setSelectedDate('2026-08-18')}
                  style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '4px', borderRadius: 6, fontSize: 9.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  +3 Giorni
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate('2026-08-22')}
                  style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '4px', borderRadius: 6, fontSize: 9.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  +1 Settimana
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate('2026-08-31')}
                  style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '4px', borderRadius: 6, fontSize: 9.5, fontWeight: 600, cursor: 'pointer' }}
                >
                  Fine Mese
                </button>
              </div>
            </div>

            {/* Right Column: Operator, Priority, Reminders */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  Operatore Incaricato Scadenza:
                </label>
                <select
                  value={operatorId}
                  onChange={e => setOperatorId(Number(e.target.value))}
                  style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: 'var(--text)' }}
                >
                  {TEAM.map(u => (
                    <option key={u.id} value={u.id}>{u.n} ({u.r})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  Livello di Priorità Scadenza:
                </label>
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  style={{ width: '100%', background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: 'var(--text)' }}
                >
                  <option value="alta">🔴 Alta Priorità (Scadenza Legale / AML / SDI)</option>
                  <option value="media">🟡 Priorità Media (Consegna Bozza / Documento)</option>
                  <option value="normale">🟢 Priorità Normale (Verifica Ordinaria)</option>
                </select>
              </div>

              <div style={{ background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    id="chkEmail"
                    checked={sendEmail}
                    onChange={e => setSendEmail(e.target.checked)}
                  />
                  <label htmlFor="chkEmail" style={{ fontSize: 10.5, color: 'var(--text)', cursor: 'pointer', fontWeight: 600 }}>
                    ✉️ Invia Notifica Email & Reminder SMTP 24h prima
                  </label>
                </div>
              </div>

              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px dashed var(--indigo)', borderRadius: 10, padding: 10, fontSize: 10.5, color: 'var(--indigo-l)' }}>
                ℹ️ La scadenza verrà integrata automaticamente nella pagina <strong>📅 Calendario Studio</strong> con filtro per operatore.
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'var(--card2)', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Annulla
            </button>
            <button
              type="submit"
              style={{ background: 'var(--indigo)', color: '#fff', border: 'none', padding: '8px 22px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 14px rgba(99,102,241,0.4)' }}
            >
              ✓ Salva Scadenza in Calendario
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
