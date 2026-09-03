import React, { useEffect, useState, useMemo } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import api from '@/lib/api';

interface Evento {
  id: string;
  titolo: string;
  descrizione: string | null;
  data_inizio: string;
  data_fine: string | null;
  tutto_giorno: boolean;
  progetto_id: string | null;
}

const MESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];
const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export const Calendario: React.FC = () => {
  const [eventi, setEventi] = useState<Evento[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [formTitolo, setFormTitolo] = useState('');
  const [formDescrizione, setFormDescrizione] = useState('');
  const [formOraInizio, setFormOraInizio] = useState('09:00');
  const [formOraFine, setFormOraFine] = useState('10:00');
  const [formTuttoGiorno, setFormTuttoGiorno] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchEventi = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/eventi');
      setEventi(res.data || []);
    } catch (err) {
      console.error('Errore caricamento eventi', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEventi();
  }, []);

  const anno = currentDate.getFullYear();
  const mese = currentDate.getMonth();

  const giorniMese = useMemo(() => {
    const primo = new Date(anno, mese, 1);
    const ultimo = new Date(anno, mese + 1, 0);
    const giorni: (Date | null)[] = [];

    // Offset per iniziare da lunedì
    let startDay = primo.getDay() - 1;
    if (startDay < 0) startDay = 6;

    for (let i = 0; i < startDay; i++) giorni.push(null);
    for (let d = 1; d <= ultimo.getDate(); d++) {
      giorni.push(new Date(anno, mese, d));
    }
    // Padding finale per completare la griglia
    while (giorni.length % 7 !== 0) giorni.push(null);

    return giorni;
  }, [anno, mese]);

  const eventiPerGiorno = useMemo(() => {
    const map: Record<string, Evento[]> = {};
    for (const ev of eventi) {
      const key = new Date(ev.data_inizio).toDateString();
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [eventi]);

  const mesePrec = () => setCurrentDate(new Date(anno, mese - 1, 1));
  const meseSucc = () => setCurrentDate(new Date(anno, mese + 1, 1));
  const oggi = new Date();

  const handleDayClick = (day: Date | null) => {
    if (!day) return;
    setSelectedDay(day);
    setShowForm(true);
    setFormTitolo('');
    setFormDescrizione('');
    setFormOraInizio('09:00');
    setFormOraFine('10:00');
    setFormTuttoGiorno(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDay || !formTitolo.trim()) return;

    const dataInizio = new Date(selectedDay);
    if (!formTuttoGiorno) {
      const [h, m] = formOraInizio.split(':').map(Number);
      dataInizio.setHours(h, m, 0);
    }

    const dataFine = formTuttoGiorno ? null : (() => {
      const d = new Date(selectedDay);
      const [h, m] = formOraFine.split(':').map(Number);
      d.setHours(h, m, 0);
      return d;
    })();

    try {
      await api.post('/api/eventi', {
        titolo: formTitolo,
        descrizione: formDescrizione || null,
        data_inizio: dataInizio.toISOString(),
        data_fine: dataFine ? dataFine.toISOString() : null,
        tutto_giorno: formTuttoGiorno,
      });
      setShowForm(false);
      fetchEventi();
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Errore nella creazione dell\'evento');
    }
  };

  const handleDeleteEvent = async (evId: string) => {
    if (!confirm('Eliminare questo evento?')) return;
    try {
      await api.delete(`/api/eventi/${evId}`);
      fetchEventi();
    } catch (err) {
      console.error('Errore eliminazione evento', err);
    }
  };

  const selectedDayEvents = selectedDay ? (eventiPerGiorno[selectedDay.toDateString()] || []) : [];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays size={24} className="text-primary" />
            Calendario
          </h1>
          <p className="text-xs text-muted mt-1">Scadenze, appuntamenti e milestone di progetto</p>
        </div>
        {loading && <div className="text-xs text-primary animate-pulse">Caricamento eventi...</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Calendar Grid */}
        <div className="lg:col-span-3">
          <Card>
            {/* Month Nav */}
            <div className="flex items-center justify-between mb-4">
              <button onClick={mesePrec} className="p-1.5 rounded-lg hover:bg-bg-card-hover transition-colors">
                <ChevronLeft size={18} />
              </button>
              <h2 className="text-lg font-bold">{MESI[mese]} {anno}</h2>
              <button onClick={meseSucc} className="p-1.5 rounded-lg hover:bg-bg-card-hover transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-px mb-1">
              {GIORNI.map(g => (
                <div key={g} className="text-center text-[10px] text-muted font-semibold py-1">{g}</div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-px">
              {giorniMese.map((day, i) => {
                if (!day) return <div key={`empty-${i}`} className="min-h-[80px] bg-bg-sidebar/30 rounded" />;

                const isToday = day.toDateString() === oggi.toDateString();
                const isSelected = selectedDay?.toDateString() === day.toDateString();
                const dayEvents = eventiPerGiorno[day.toDateString()] || [];

                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[80px] p-1.5 rounded cursor-pointer transition-all border ${
                      isSelected
                        ? 'border-primary bg-primary-light'
                        : isToday
                          ? 'border-primary/40 bg-bg-card'
                          : 'border-transparent bg-bg-card hover:bg-bg-card-hover'
                    }`}
                    onClick={() => handleDayClick(day)}
                  >
                    <div className={`text-xs font-semibold mb-1 ${isToday ? 'text-primary' : 'text-muted'}`}>
                      {day.getDate()}
                    </div>
                    {dayEvents.slice(0, 3).map(ev => (
                      <div
                        key={ev.id}
                        className="text-[9px] bg-primary/20 text-primary rounded px-1 py-0.5 mb-0.5 truncate font-medium"
                        title={ev.titolo}
                      >
                        {ev.titolo}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[9px] text-muted">+{dayEvents.length - 3} altri</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Sidebar: Selected Day Detail */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          {selectedDay && (
            <>
              <Card>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">
                    {selectedDay.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </h3>
                  <button
                    className="p-1 rounded hover:bg-primary-light transition-colors text-primary"
                    onClick={() => { setShowForm(true); }}
                    title="Nuovo evento"
                  >
                    <Plus size={16} />
                  </button>
                </div>

                {selectedDayEvents.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {selectedDayEvents.map(ev => (
                      <div key={ev.id} className="p-2 rounded-lg bg-bg-sidebar border border-color group">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-xs font-semibold">{ev.titolo}</div>
                            {ev.descrizione && <div className="text-[10px] text-muted mt-0.5">{ev.descrizione}</div>}
                            <div className="text-[10px] text-primary mt-1">
                              {ev.tutto_giorno
                                ? 'Tutto il giorno'
                                : new Date(ev.data_inizio).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                              }
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteEvent(ev.id); }}
                            className="text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted italic">Nessun evento in questo giorno.</p>
                )}
              </Card>

              {/* Quick Add Form */}
              {showForm && (
                <Card>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Plus size={14} className="text-primary" />
                    Nuovo Evento
                  </h3>
                  <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
                    <div>
                      <label className="text-[10px] text-muted block mb-0.5">Titolo</label>
                      <input
                        type="text"
                        className="input-field text-xs"
                        value={formTitolo}
                        onChange={e => setFormTitolo(e.target.value)}
                        required
                        placeholder="Es. Call con cliente"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted block mb-0.5">Descrizione</label>
                      <textarea
                        className="input-field text-xs"
                        rows={2}
                        value={formDescrizione}
                        onChange={e => setFormDescrizione(e.target.value)}
                        placeholder="Note opzionali..."
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="tutto-giorno"
                        checked={formTuttoGiorno}
                        onChange={e => setFormTuttoGiorno(e.target.checked)}
                      />
                      <label htmlFor="tutto-giorno" className="text-xs text-muted">Tutto il giorno</label>
                    </div>
                    {!formTuttoGiorno && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted block mb-0.5">Inizio</label>
                          <input type="time" className="input-field text-xs" value={formOraInizio} onChange={e => setFormOraInizio(e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted block mb-0.5">Fine</label>
                          <input type="time" className="input-field text-xs" value={formOraFine} onChange={e => setFormOraFine(e.target.value)} />
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 justify-end mt-1">
                      <button type="button" className="btn-secondary text-xs" onClick={() => setShowForm(false)}>Annulla</button>
                      <button type="submit" className="btn-primary text-xs">Salva</button>
                    </div>
                  </form>
                </Card>
              )}
            </>
          )}

          {!selectedDay && (
            <Card>
              <p className="text-xs text-muted text-center py-4">Seleziona un giorno per vedere o aggiungere eventi</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
