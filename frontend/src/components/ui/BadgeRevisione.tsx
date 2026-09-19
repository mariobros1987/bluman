// §41 — L'etichetta di revisione di un modello dello studio.
//
// Serve a rispondere a colpo d'occhio alla domanda «questa carta è stata riletta?». Per questo
// distingue tre cose che si somigliano ma non sono la stessa:
//
//  • **Approvato / In revisione / Bozza** — c'è una riga a database, e qualcuno ha deciso.
//  • **Di serie** — la carta arriva col programma e nessuno in questo studio l'ha ancora
//    adottata: non ha uno stato, e inventarle una «bozza» sarebbe attestare una rilettura
//    che non è avvenuta (regola 7).
//  • **Stato non disponibile** — la riga c'è ma il campo è vuoto: si dice che non si sa,
//    non si tira a indovinare.
//
// La versione accanto allo stato conta le approvazioni superate, non i salvataggi: v3 significa
// che il testo è stato riapprovato due volte dopo la prima.

import React from 'react';

export interface DatiRevisione {
  statoRevisione?: 'bozza' | 'in_revisione' | 'approvato' | null;
  versione?: number | null;
  diSerie?: boolean;
  revisionatoDaNome?: string | null;
  revisionatoAt?: string | null;
}

const COLORI: Record<string, React.CSSProperties> = {
  approvato: { background: 'var(--pill-green-bg)', color: 'var(--green)', border: '1px solid var(--pill-green-bg)' },
  in_revisione: { background: 'var(--pill-amber-bg)', color: 'var(--amber)', border: '1px solid var(--pill-amber-bd)' },
  bozza: { background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--pill-slate-bd)' },
  serie: { background: 'var(--surface-1)', color: 'var(--cat-societario)', border: '1px solid var(--pill-blue-bg)' },
  ignoto: { background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--pill-slate-bd)' },
};

/** Testo del tooltip: chi ha deciso e quando, se il modello lo dice. */
function dettaglio(m: DatiRevisione): string {
  if (m.diSerie) return 'Modello fornito col programma: nessuno in questo studio lo ha ancora adottato né revisionato.';
  if (!m.statoRevisione) return 'Stato di revisione non disponibile per questo modello.';
  const chi = m.revisionatoDaNome ? `da ${m.revisionatoDaNome}` : null;
  const quando = m.revisionatoAt ? new Date(m.revisionatoAt).toLocaleDateString('it-IT') : null;
  if (!chi && !quando) return 'Nessuna revisione registrata su questo modello.';
  return `Ultima decisione ${[chi, quando ? `il ${quando}` : null].filter(Boolean).join(' ')}.`;
}

export function BadgeRevisione({ modello, compatto = false }: { modello: DatiRevisione; compatto?: boolean }) {
  const chiave = modello.diSerie ? 'serie' : (modello.statoRevisione || 'ignoto');
  const testo =
    chiave === 'serie' ? (compatto ? 'Di serie' : 'Di serie · mai revisionato qui')
    : chiave === 'approvato' ? `✓ Approvato${modello.versione ? ` v${modello.versione}` : ''}`
    : chiave === 'in_revisione' ? `◑ In revisione${modello.versione ? ` v${modello.versione}` : ''}`
    : chiave === 'bozza' ? `✎ Bozza${modello.versione ? ` v${modello.versione}` : ''}`
    : 'Stato non disponibile';

  return (
    <span
      title={dettaglio(modello)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        fontSize: compatto ? 8.5 : 10,
        fontWeight: 700,
        padding: compatto ? '1px 5px' : '2px 8px',
        borderRadius: 20,
        ...COLORI[chiave],
      }}
    >
      {testo}
    </span>
  );
}
