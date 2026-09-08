// Modulo estratto da ClientPortal.tsx (split meccanico, zero cambi di comportamento):
// Tabs Bar del portale — barra di navigazione a 7 schede (proposta, avanzamento,
// form, documenti, fatture, contatti, profilo).

import { tabsBarStyle, tabBtnStyle } from './styles';
import type { PortalTab } from './types';

export interface PortalTabsBarProps {
  activeTab: PortalTab;
  setActiveTab: (tab: PortalTab) => void;
}

export function PortalTabsBar({
  activeTab,
  setActiveTab,
}: PortalTabsBarProps) {
  return (
    <div style={tabsBarStyle}>
      <button
        onClick={() => setActiveTab('proposta')}
        style={tabBtnStyle(activeTab === 'proposta')}
      >
        ✍️ 1. Proposta d'Ordine & Firma
      </button>
      <button
        onClick={() => setActiveTab('avanzamento')}
        style={tabBtnStyle(activeTab === 'avanzamento')}
      >
        📊 2. Avanzamento Live Lavori
      </button>
      <button
        onClick={() => setActiveTab('form')}
        style={tabBtnStyle(activeTab === 'form')}
      >
        📋 3. Form Dati Societari
      </button>
      <button
        onClick={() => setActiveTab('documenti')}
        style={tabBtnStyle(activeTab === 'documenti')}
      >
        📎 4. Documenti & Contratti
      </button>
      <button
        onClick={() => setActiveTab('fatture')}
        style={tabBtnStyle(activeTab === 'fatture')}
      >
        💳 5. Fatture & Pagamenti
      </button>
      <button
        onClick={() => setActiveTab('contatti')}
        style={tabBtnStyle(activeTab === 'contatti')}
      >
        💬 6. Contatto Advisor
      </button>
      <button
        onClick={() => setActiveTab('profilo')}
        style={tabBtnStyle(activeTab === 'profilo')}
      >
        👤 7. Profilo & Password
      </button>
    </div>
  );
}
