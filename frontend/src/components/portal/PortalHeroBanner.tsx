// Modulo estratto da ClientPortal.tsx (split meccanico, zero cambi di comportamento):
// Hero Welcome Banner del portale — titolo dell'incarico attivo e stato
// dell'accettazione (In Lavorazione / In Attesa di Accettazione).

import { heroBannerStyle } from './styles';

export interface PortalHeroBannerProps {
  progettoAttivo: any;
  signed: boolean;
}

export function PortalHeroBanner({
  progettoAttivo,
  signed,
}: PortalHeroBannerProps) {
  return (
    <div style={heroBannerStyle}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--indigo-l)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px' }}>
          PORTALE DEDICATO ED ASSISTENZA PROFESSIONALE
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '4px 0 6px' }}>
          {progettoAttivo?.nome || 'Nessun incarico aperto'}
        </h1>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Benvenuto nel tuo portale. Qui puoi consultare l'avanzamento dei lavori, compilare i dati societari e sottoscrivere i contratti.
        </div>
      </div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px', textAlign: 'right' }}>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>Stato Incarico</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: signed ? 'var(--green)' : 'var(--amber)', marginTop: 2 }}>
          {signed ? '✓ Progetto Attivo (In Lavorazione)' : '✍️ In Attesa di Accettazione'}
        </div>
      </div>
    </div>
  );
}
