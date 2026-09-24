/**
 * KYC/AML Fase K3 (Malta, spec §6) — livello di rischio a 4 pilastri. PURO: nessun DB/HTTP.
 *
 * Non un punteggio unico (la FIAU contesta le valutazioni a pochi dati): cliente, geografia,
 * prodotto/servizio, canale, ognuno con un livello. Il livello complessivo è **worst-case**: il più
 * alto dei quattro vince (un solo pilastro Alto → cliente Alto). Regola documentata e conservativa.
 */

export type LivelloRischioK3 = 'basso' | 'medio' | 'alto';
export type LivelloVerificaK3 = 'semplificata' | 'ordinaria' | 'rafforzata';

export interface Pilastri {
  cliente: LivelloRischioK3;
  geografia: LivelloRischioK3;
  prodotto: LivelloRischioK3;
  canale: LivelloRischioK3;
}

const ORDINE: Record<LivelloRischioK3, number> = { basso: 0, medio: 1, alto: 2 };
const PER_ORDINE: LivelloRischioK3[] = ['basso', 'medio', 'alto'];

/** Worst-case: il livello complessivo è il più alto tra i quattro pilastri. */
export function livelloComplessivo(p: Pilastri): LivelloRischioK3 {
  const max = Math.max(ORDINE[p.cliente], ORDINE[p.geografia], ORDINE[p.prodotto], ORDINE[p.canale]);
  return PER_ORDINE[max]!;
}

/**
 * §6 — una valutazione è completa solo se ogni pilastro ha una **motivazione** (dati + giudizio,
 * non solo il livello). Senza le quattro motivazioni non si può chiudere (§14).
 */
export function assessmentCompleto(mot: { cliente?: string | null; geografia?: string | null; prodotto?: string | null; canale?: string | null }): boolean {
  return [mot.cliente, mot.geografia, mot.prodotto, mot.canale].every((m) => !!m && m.trim().length > 0);
}

/** Rischio ALTO ⇒ verifica rafforzata (§8.3); medio/basso ⇒ ordinaria. */
export function livelloVerificaDaRischio(livello: LivelloRischioK3): LivelloVerificaK3 {
  return livello === 'alto' ? 'rafforzata' : 'ordinaria';
}

/** Mesi alla prossima revisione periodica per livello: Alto 6, Medio 12, Basso 24. */
export function mesiRevisioneRischio(livello: LivelloRischioK3): number {
  return livello === 'alto' ? 6 : livello === 'medio' ? 12 : 24;
}

/** Data della prossima revisione a partire da una data base e dal livello. */
export function prossimaRevisione(dataBase: Date, livello: LivelloRischioK3): Date {
  const d = new Date(dataBase);
  d.setMonth(d.getMonth() + mesiRevisioneRischio(livello));
  return d;
}
