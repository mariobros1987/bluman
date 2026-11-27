// Modulo estratto da ClientPortal.tsx (split meccanico, zero cambi di comportamento):
// Tabs Bar del portale — barra di navigazione a 7 schede (proposta, avanzamento,
// form, documenti, fatture, contatti, profilo).

import { tabsBarStyle, tabBtnStyle } from './styles';
import type { PortalTab } from './types';

export interface PortalTabsBarProps {
  activeTab: PortalTab;
  setActiveTab: (tab: PortalTab) => void;
}

// Nomi brevi, senza numeri: sul telefono la barra scorre e si vede una scheda alla volta, e
// «Avanzamento Live Lavori» o «Contatto Advisor» dicevano meno di una parola sola.
const SCHEDE: Array<[PortalTab, string]> = [
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
        </button>
      ))}
    </div>
  );
}
