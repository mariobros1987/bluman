// La categoria di un'azione del registro (Log Audit), ricavata dal nome dell'azione.
//
// Il registro non ha una colonna «categoria»: la categoria si legge dalle parole che compaiono
// nell'azione («FATTURA_EMESSA» → fatturazione). Questa regola stava solo nella pagina, quindi il
// filtro per categoria agiva sulle righe della pagina visualizzata e non su tutto il registro.
// Qui è una sola, usata dalla pagina per il badge e dal server per filtrare tutte le righe.
//
// L'ordine conta: vince la prima categoria che trova una sua parola. «DOCUMENTI» è il resto.

export const CATEGORIE_AUDIT = ['FATTURAZIONE', 'PROGETTO', 'TENANT', 'AUTH', 'PERMESSI', 'KYC', 'DOCUMENTI'] as const;
export type CategoriaAudit = (typeof CATEGORIE_AUDIT)[number];

/** Le parole di ogni categoria, nell'ordine in cui vengono provate. */
export const PAROLE_CATEGORIA_AUDIT: ReadonlyArray<{ categoria: Exclude<CategoriaAudit, 'DOCUMENTI'>; parole: readonly string[] }> = [
  { categoria: 'FATTURAZIONE', parole: ['FATTURA', 'INCASSO', 'SDI', 'PRIMA_NOTA', 'PRIMANOTA', 'CONTRATTO', 'LIPE', 'FORNITOR'] },
  // «ORE» solo come parola a sé: da sola prendeva anche «FORNITORE».
  { categoria: 'PROGETTO', parole: ['PROGETTO', 'ORE_', '_ORE', 'TIMESHEET', 'MODULO', 'PREVENTIVO'] },
  { categoria: 'TENANT', parole: ['TENANT', 'UTENTE', 'STUDIO'] },
  { categoria: 'AUTH', parole: ['LOGIN', 'AUTH', 'PASSWORD'] },
  { categoria: 'PERMESSI', parole: ['PERMESSI'] },
  { categoria: 'KYC', parole: ['KYC'] },
];

export function categoriaAzioneAudit(azione: string | null | undefined): CategoriaAudit {
  const az = (azione ?? '').toUpperCase();
  for (const { categoria, parole } of PAROLE_CATEGORIA_AUDIT) {
    if (parole.some((p) => az.includes(p))) return categoria;
  }
  return 'DOCUMENTI';
}

export function eCategoriaAudit(valore: unknown): valore is CategoriaAudit {
  return typeof valore === 'string' && (CATEGORIE_AUDIT as readonly string[]).includes(valore);
}

/**
 * Le parole che un'azione deve contenere (`contiene`, almeno una) e quelle che NON deve contenere
 * (`nonContiene`, nessuna) per appartenere alla categoria: è la stessa regola di
 * `categoriaAzioneAudit`, scritta in modo che il server la possa tradurre in un filtro.
 * Per «DOCUMENTI» `contiene` è vuoto: è tutto ciò che non ha nessuna parola delle altre.
 */
export function regolaFiltroCategoriaAudit(categoria: CategoriaAudit): { contiene: string[]; nonContiene: string[] } {
  const indice = PAROLE_CATEGORIA_AUDIT.findIndex((r) => r.categoria === categoria);
  const regola = PAROLE_CATEGORIA_AUDIT[indice];
  if (!regola) return { contiene: [], nonContiene: PAROLE_CATEGORIA_AUDIT.flatMap((r) => [...r.parole]) };
  return {
    contiene: [...regola.parole],
    nonContiene: PAROLE_CATEGORIA_AUDIT.slice(0, indice).flatMap((r) => [...r.parole]),
  };
}

/** I ruoli che possono comparire nel registro: il filtro del server accetta solo questi. */
export const RUOLI_AUDIT = ['super_admin', 'advisor', 'collaboratore_interno', 'collaboratore_esterno', 'cliente'] as const;
export function eRuoloAudit(valore: unknown): valore is (typeof RUOLI_AUDIT)[number] {
  return typeof valore === 'string' && (RUOLI_AUDIT as readonly string[]).includes(valore);
}
