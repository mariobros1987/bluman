import React from 'react';

const PLACEHOLDER: Record<string, { icon: string; label: string; sub: string }> = {
  clients:  { icon: '👥', label: 'Clienti', sub: 'Gestione anagrafica clienti — in sviluppo' },
  calendar: { icon: '📅', label: 'Calendario', sub: 'Pianificazione appuntamenti e scadenze — in sviluppo' },
  settings: { icon: '⚙️', label: 'Impostazioni', sub: 'Configurazione tenant e utenti — in sviluppo' },
};

export function Clients()  { return <PlaceholderPage page="clients" />; }
export function Calendar() { return <PlaceholderPage page="calendar" />; }
export function Settings() { return <PlaceholderPage page="settings" />; }

function PlaceholderPage({ page }: { page: keyof typeof PLACEHOLDER }) {
  const { icon, label, sub } = PLACEHOLDER[page];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 56 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 300, textAlign: 'center' }}>{sub}</div>
      <div style={{ marginTop: 8, fontSize: 10, color: '#4a4d64', background: 'var(--card)', border: '1px solid var(--border)', padding: '6px 14px', borderRadius: 20 }}>
        Disponibile nella prossima versione
      </div>
    </div>
  );
}
