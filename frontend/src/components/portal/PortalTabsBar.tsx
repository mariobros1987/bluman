// Modulo estratto da ClientPortal.tsx (split meccanico, zero cambi di comportamento):
// Tabs Bar del portale — barra di navigazione: riepilogo e richieste in testa (cosa tocca al
// cliente), poi proposta, avanzamento, form, documenti, fatture, messaggi, profilo.

import { tabsBarStyle, tabBtnStyle } from './styles';
import type { PortalTab } from './types';

export interface PortalTabsBarProps {
  activeTab: PortalTab;
  setActiveTab: (tab: PortalTab) => void;
  /** Quante cose aspettano il cliente in una scheda: il numero accanto al nome. Lo conta il server. */
  conteggi?: Partial<Record<PortalTab, number>>;
}

// Nomi brevi, senza numeri: sul telefono la barra scorre e si vede una scheda alla volta, e
// «Avanzamento Live Lavori» o «Contatto Advisor» dicevano meno di una parola sola.
const SCHEDE: Array<[PortalTab, string]> = [
  ['riepilogo', '🏠 Riepilogo'],
  ['richieste', '📝 Da fare'],
  ['proposta', '✍️ Proposta e firma'],
  ['avanzamento', '📊 Avanzamento'],
  ['form', '📋 Dati societari'],
  ['documenti', '📎 Documenti'],
  ['fatture', '💳 Fatture'],
  ['contatti', '💬 Messaggi'],
  ['profilo', '👤 Profilo'],
];

export function PortalTabsBar({
  activeTab,
  setActiveTab,
  conteggi = {},
}: PortalTabsBarProps) {
  return (
    <div style={tabsBarStyle} role="tablist" aria-label="Sezioni del portale">
      {SCHEDE.map(([id, etichetta]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeTab === id}
          onClick={() => setActiveTab(id)}
          style={tabBtnStyle(activeTab === id)}
        >
          {etichetta}
          {(conteggi[id] ?? 0) > 0 && (
            <span aria-label={`${conteggi[id]} da fare`} style={{ background: 'var(--amber)', color: 'var(--on-accent)', borderRadius: 10, fontSize: 10.5, fontWeight: 800, padding: '1px 7px' }}>
              {conteggi[id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
