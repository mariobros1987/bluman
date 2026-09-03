// Motore di calcolo stati — §16 del documento.
//
// Modulo di dominio PURO: nessuna chiamata a DB/HTTP. Riceve entità (o proiezioni minime
// di esse), restituisce nuovi valori. Il service layer chiama queste funzioni e persiste
// il risultato — vedi piano di sviluppo, Fase 5 e Fase 7.
//
// Regola §16.6, sempre valida in questo file: le funzioni di aggregazione ricalcolano
// SOLO verso l'alto (micro-voce → modulo → progetto). Nessuna funzione qui scrive mai
// lo stato di una micro-voce a partire da quello di un modulo.

import type { MicrovoceInput, StatoMicrovoce, StatoModulo, StatoProgetto } from './types.js';

// ── §16.1 — Funzioni sulla micro-voce ──────────────────────────────────────

export interface SegnaleRischio {
  segnaleRischio: boolean;
  oreExtra: number;
}

/**
 * §16.1 — Il segnale di rischio è un flag calcolato, MAI uno stato a sé (§7bis).
 * Si accende solo se la micro-voce è 'active' e le ore consuntivate superano le
 * preventivate. Una micro-voce 'delayed'/'blocked' con ore sforate non attiva
 * questo segnale: il suo stato manuale racconta già una storia più specifica.
 */
export function valutaSegnaleRischio(m: Pick<MicrovoceInput, 'stato' | 'orePreventivate' | 'oreConsuntivate'>): SegnaleRischio {
  const oreExtra = Math.max(0, m.oreConsuntivate - m.orePreventivate);
  const segnaleRischio = m.stato === 'active' && m.oreConsuntivate > m.orePreventivate;
  return { segnaleRischio, oreExtra };
}

/**
 * §16.1 — Percentuale di avanzamento di una micro-voce.
 * Tetto a 99 (non 100) finché lo stato non è 'done': evita che una micro-voce mostri
 * "completata" solo perché ha sforato le ore, senza che nessuno l'abbia chiusa davvero.
 */
export function calcolaPercentualeMicrovoce(m: Pick<MicrovoceInput, 'stato' | 'orePreventivate' | 'oreConsuntivate'>): number {
  if (m.stato === 'done') return 100;
  if (m.stato === 'pending' || m.stato === 'attesa_dipendenza') return 0;
  if (m.orePreventivate <= 0) return 0; // guardia: mai dividere per zero
  return Math.min(99, (m.oreConsuntivate / m.orePreventivate) * 100);
}

// ── §16.2 — Funzioni sul modulo ────────────────────────────────────────────

/**
 * §16.2 — Il modulo eredita sempre lo stato più critico tra le sue micro-voci.
 * Precedenza: blocked > delayed > done (tutte) > attesa_dipendenza (tutte) > in_progress > pending.
 */
export function calcolaStatoModulo(microvoci: Array<Pick<MicrovoceInput, 'stato'>>): StatoModulo {
  if (microvoci.length === 0) return 'pending';
  const stati = microvoci.map((v) => v.stato);

  if (stati.some((s) => s === 'blocked')) return 'blocked';
  if (stati.some((s) => s === 'delayed')) return 'delayed';
  if (stati.every((s) => s === 'done')) return 'done';
  if (stati.every((s) => s === 'attesa_dipendenza')) return 'attesa_dipendenza';
  if (stati.some((s) => s === 'active' || s === 'done')) return 'in_progress';
  return 'pending';
}

/**
 * §16.2 — Media pesata sulle ore preventivate, non media semplice: una micro-voce
 * da 10h pesa più di una da 1h.
 */
export function calcolaPercentualeModulo(microvoci: Array<Pick<MicrovoceInput, 'stato' | 'orePreventivate' | 'oreConsuntivate'>>): number {
  const totOre = microvoci.reduce((a, v) => a + v.orePreventivate, 0);
  if (totOre <= 0) return 0;
  const somma = microvoci.reduce((a, v) => a + calcolaPercentualeMicrovoce(v) * v.orePreventivate, 0);
  return somma / totOre;
}

// ── §16.3 — Funzioni sul progetto ──────────────────────────────────────────

/** §16.3 — Media pesata sulle ore preventivate totali di ciascun modulo. */
export function calcolaPercentualeProgetto(moduli: Array<{ orePreventivate: number; percentuale: number }>): number {
  const totOre = moduli.reduce((a, m) => a + m.orePreventivate, 0);
  if (totOre <= 0) return 0;
  const somma = moduli.reduce((a, m) => a + m.percentuale * m.orePreventivate, 0);
  return somma / totOre;
}

/**
 * §16.3 — 'pre_project' precede l'istanziazione dei moduli e non viene MAI
 * calcolato da questa funzione: è un dato ortogonale, gestito dal service layer
 * (transizione esplicita alla firma dell'engagement letter, §15.3).
 */
export function calcolaStatoProgetto(moduli: Array<{ stato: StatoModulo }>): Extract<StatoProgetto, 'in_progress' | 'completed'> {
  if (moduli.length > 0 && moduli.every((m) => m.stato === 'done')) return 'completed';
  return 'in_progress';
}

// ── §16.4 — Trigger: consuntivazione e ritardo manuale ─────────────────────

export interface RisultatoConsuntivazione {
  microvoce: MicrovoceInput & SegnaleRischio;
  segnaleRischioAppenaAttivato: boolean; // per decidere se generare un alert (§16.4, punto 6)
}

/**
 * §16.4 — registraConsuntivazione: calcola il nuovo stato della micro-voce dopo
 * l'aggiunta di ore. Non tocca modulo/progetto: la cascata verso l'alto (16.2/16.3)
 * è responsabilità del service layer, che chiama questa funzione e poi ricalcola
 * il modulo padre con calcolaStatoModulo/calcolaPercentualeModulo.
 */
export function registraConsuntivazione(m: MicrovoceInput, oreAggiuntive: number): RisultatoConsuntivazione {
  if (oreAggiuntive <= 0) {
    throw new Error('Le ore consuntivate devono essere un valore positivo');
  }
  const rischioPrima = valutaSegnaleRischio(m).segnaleRischio;
  const aggiornata: MicrovoceInput = { ...m, oreConsuntivate: m.oreConsuntivate + oreAggiuntive };
  const { segnaleRischio, oreExtra } = valutaSegnaleRischio(aggiornata);

  return {
    microvoce: { ...aggiornata, segnaleRischio, oreExtra },
    segnaleRischioAppenaAttivato: !rischioPrima && segnaleRischio,
  };
}

/**
 * §16.4 — marcaRitardoManuale: causa_nota è OBBLIGATORIA (§7bis). Rifiuta la
 * richiesta invece di accettarla con una nota vuota — è una decisione di
 * business, non solo di validazione tecnica.
 */
export function marcaRitardoManuale(
  m: MicrovoceInput,
  nuovoStato: Extract<StatoMicrovoce, 'delayed' | 'blocked'>,
  causaNota: string,
): MicrovoceInput & { causaNota: string } {
  if (!causaNota || causaNota.trim().length === 0) {
    throw new Error('causaNota è obbligatoria quando lo stato passa a delayed/blocked (§7bis)');
  }
  return { ...m, stato: nuovoStato, causaNota: causaNota.trim() };
}

/** §16.4 — risolviRitardoManuale: la micro-voce torna operativa. */
export function risolviRitardoManuale(m: MicrovoceInput): MicrovoceInput & { causaNota: null } {
  return { ...m, stato: 'active', causaNota: null };
}

// ── §16.5 — Risoluzione delle dipendenze ───────────────────────────────────

export interface ModuloConDipendenze {
  id: string;
  stato: StatoModulo;
  dipendeDa: string[]; // id di altri ModuloConDipendenze
}

/**
 * §16.5 — Dato l'id del modulo appena completato, restituisce gli id dei moduli
 * dipendenti le cui micro-voci vanno sbloccate (attesa_dipendenza → pending),
 * perché TUTTE le loro dipendenze sono ora soddisfatte.
 *
 * Pura e idempotente: chiamarla più volte con lo stesso stato di partenza
 * produce sempre lo stesso risultato — nessuno stato mutabile nascosto.
 */
export function risolviDipendenze(moduli: ModuloConDipendenze[], moduloCompletatoId: string): string[] {
  const statoById = new Map(moduli.map((m) => [m.id, m.stato]));
  statoById.set(moduloCompletatoId, 'done'); // il chiamante lo ha appena marcato done

  const dipendentiDiretti = moduli.filter((m) => m.dipendeDa.includes(moduloCompletatoId));

  return dipendentiDiretti
    .filter((m) => m.dipendeDa.every((depId) => statoById.get(depId) === 'done'))
    .map((m) => m.id);
}
