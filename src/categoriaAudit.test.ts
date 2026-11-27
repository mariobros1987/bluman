// Analisi del 26/11, F7 — nel Log Audit i filtri per ruolo e categoria agivano solo sulla pagina
// visualizzata. La regola della categoria ora è una sola, per la pagina e per il filtro del server.
import { describe, it, expect } from 'vitest';
import { CATEGORIE_AUDIT, categoriaAzioneAudit, eCategoriaAudit, eRuoloAudit, regolaFiltroCategoriaAudit } from './domain/categoriaAudit.js';

/** Applica la regola del filtro a un'azione, come farà il database. */
function passaIlFiltro(azione: string, categoria: (typeof CATEGORIE_AUDIT)[number]): boolean {
  const { contiene, nonContiene } = regolaFiltroCategoriaAudit(categoria);
  const az = azione.toUpperCase();
  const ha = contiene.length === 0 || contiene.some((p) => az.includes(p));
  return ha && !nonContiene.some((p) => az.includes(p));
}

describe('categoriaAzioneAudit', () => {
  it('classifica dalle parole dell’azione, e ciò che resta è «DOCUMENTI»', () => {
    expect(categoriaAzioneAudit('FATTURA_EMESSA')).toBe('FATTURAZIONE');
    expect(categoriaAzioneAudit('MOVIMENTO_PRIMANOTA_ELIMINATO')).toBe('FATTURAZIONE');
    expect(categoriaAzioneAudit('LIPE_VERSATA')).toBe('FATTURAZIONE');
    expect(categoriaAzioneAudit('MODULO_ELIMINATO')).toBe('PROGETTO');
    expect(categoriaAzioneAudit('ORE_CONSUNTIVATE')).toBe('PROGETTO');
    // «FORNITORE» contiene «ORE»: prima finiva tra i progetti.
    expect(categoriaAzioneAudit('FORNITORE_CREATO')).toBe('FATTURAZIONE');
    expect(categoriaAzioneAudit('UTENTE_ARCHIVIATO')).toBe('TENANT');
    expect(categoriaAzioneAudit('LOGIN_RIUSCITO')).toBe('AUTH');
    expect(categoriaAzioneAudit('KYC_APPROVATO')).toBe('KYC');
    expect(categoriaAzioneAudit('DOCUMENTO_CARICATO')).toBe('DOCUMENTI');
    expect(categoriaAzioneAudit(null)).toBe('DOCUMENTI');
  });

  it('con due parole vince la categoria che viene prima', () => {
    // «FATTURA» e «PROGETTO» insieme: fatturazione, com'era nella pagina.
    expect(categoriaAzioneAudit('FATTURA_PROGETTO_EMESSA')).toBe('FATTURAZIONE');
  });
});

describe('regolaFiltroCategoriaAudit — il filtro del server dà la stessa risposta della classificazione', () => {
  const AZIONI = [
    'FATTURA_EMESSA', 'INCASSO_REGISTRATO', 'MOVIMENTO_PRIMANOTA_CREATO', 'LIPE_VERSATA', 'PROGETTO_STATO_AGGIORNATO',
    'MODULO_ELIMINATO', 'ORE_CONSUNTIVATE', 'FORNITORE_CREATO', 'FATTURA_PROGETTO_EMESSA', 'UTENTE_ARCHIVIATO', 'TENANT_AGGIORNATO', 'LOGIN_RIUSCITO',
    'PASSWORD_RIGENERATA', 'PERMESSI_MODIFICATI', 'KYC_APPROVATO', 'DOCUMENTO_CARICATO', 'DOCUMENTO_ELIMINATO', 'ALTRO',
  ];

  it('ogni azione passa il filtro della sua categoria e di nessun’altra', () => {
    for (const azione of AZIONI) {
      const attesa = categoriaAzioneAudit(azione);
      const passate = CATEGORIE_AUDIT.filter((c) => passaIlFiltro(azione, c));
      expect(passate, azione).toEqual([attesa]);
    }
  });
});

describe('valori ammessi dai filtri', () => {
  it('categorie e ruoli sconosciuti non passano', () => {
    expect(eCategoriaAudit('FATTURAZIONE')).toBe(true);
    expect(eCategoriaAudit('TUTTI')).toBe(false);
    expect(eRuoloAudit('advisor')).toBe(true);
    expect(eRuoloAudit("advisor' OR 1=1")).toBe(false);
  });
});
