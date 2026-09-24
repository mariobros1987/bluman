/**
 * KYC/AML Fase K2 (spec §7) — ricostruzione della catena di controllo. PURO: nessun DB/HTTP.
 *
 * I `Legame` sono archi «`daId` possiede/controlla `aId` per una quota %». Partendo dal soggetto
 * radice (il cliente/società), si risale verso i proprietari: per ogni percorso fino a un
 * proprietario ULTIMO (una foglia: chi non è a sua volta posseduto) si moltiplicano le quote, e si
 * somma la quota effettiva per proprietario ultimo attraverso i vari percorsi. I titolari effettivi
 * sono quelli la cui quota effettiva raggiunge la soglia (es. 25%).
 *
 * Cicli (partecipazioni incrociate) e percorsi già visti sono gestiti senza ricorsione infinita.
 */

export interface Legame {
  daId: string;
  aId: string;
  /** Quota di `daId` in `aId`, 0..100. `null` → trattata come sconosciuta (0, non propaga quota). */
  percentuale: number | null;
}

export interface TitolareCalcolato {
  soggettoId: string;
  /** Somma delle quote effettive lungo tutti i percorsi fino alla radice, in percentuale (0..100+). */
  percentualeEffettiva: number;
}

/**
 * Calcola i titolari effettivi ultimi del soggetto `radiceId` risalendo i `legami`, con soglia in
 * percentuale (default 25). Ritorna i proprietari ultimi che raggiungono la soglia, ordinati per
 * quota decrescente. Se un percorso ha una quota `null`/0 non contribuisce (quota sconosciuta non si
 * inventa, regola 7).
 */
export function calcolaTitolariEffettivi(
  legami: Legame[],
  radiceId: string,
  sogliaPercentuale = 25,
): TitolareCalcolato[] {
  // Proprietari diretti di un soggetto: gli archi il cui `aId` è quel soggetto.
  const proprietariDi = new Map<string, Legame[]>();
  for (const l of legami) {
    if (!proprietariDi.has(l.aId)) proprietariDi.set(l.aId, []);
    proprietariDi.get(l.aId)!.push(l);
  }

  const accumulo = new Map<string, number>();

  // DFS verso l'alto. `quota` è la frazione (0..1) effettiva accumulata fin qui; `visitati` evita i cicli.
  const risali = (soggettoId: string, quota: number, visitati: Set<string>) => {
    const proprietari = proprietariDi.get(soggettoId);
    if (!proprietari || proprietari.length === 0) {
      // Foglia = proprietario ultimo. Non conta la radice stessa.
      if (soggettoId !== radiceId) accumulo.set(soggettoId, (accumulo.get(soggettoId) ?? 0) + quota);
      return;
    }
    for (const l of proprietari) {
      if (visitati.has(l.daId)) continue; // ciclo: non si rientra
      const frazione = l.percentuale && l.percentuale > 0 ? l.percentuale / 100 : 0;
      if (frazione === 0) continue; // quota sconosciuta/zero: non propaga
      risali(l.daId, quota * frazione, new Set(visitati).add(l.daId));
    }
  };

  risali(radiceId, 1, new Set([radiceId]));

  return [...accumulo.entries()]
    .map(([soggettoId, frazione]) => ({ soggettoId, percentualeEffettiva: Math.round(frazione * 10000) / 100 }))
    .filter((t) => t.percentualeEffettiva >= sogliaPercentuale)
    .sort((a, b) => b.percentualeEffettiva - a.percentualeEffettiva);
}

/**
 * §5.2 — allarme sulle variazioni: dalla data della variazione, la scadenza del deposito al registro
 * dei titolari effettivi è a `giorni` giorni (default 14). Puro; la data si normalizza a mezzanotte UTC.
 */
export function scadenzaVariazioneTe(dataVariazione: Date, giorni = 14): Date {
  const d = new Date(dataVariazione);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d;
}
