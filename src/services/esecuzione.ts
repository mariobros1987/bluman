// Servizio di orchestrazione — §17: consuntivazione, ritardo/blocco, procedura guidata.
// Nessuna logica di calcolo qui che non sia già in src/domain/stateEngine.ts (Fase 5) —
// questo file chiama quelle funzioni pure e persiste il risultato attraverso EsecuzionePort.

import {
  valutaSegnaleRischio,
  calcolaStatoModulo,
  marcaRitardoManuale as marcaRitardoManualePuro,
  risolviRitardoManuale as risolviRitardoManualePuro,
  risolviDipendenze,
} from '../domain/stateEngine.js';
import type { StatoMicrovoce } from '../domain/types.js';
import type { EsecuzionePort } from './istanziazionePort.js';

/**
 * §17.1 + §16.4 — Somma le ore, ricalcola il segnale di rischio, e fa risalire la
 * cascata al modulo padre. Se il modulo appena completato sblocca dipendenti
 * (§16.5), le loro micro-voci passano da attesa_dipendenza a pending.
 */
export async function registraConsuntivazione(microvoceId: string, oreAggiuntive: number, port: EsecuzionePort): Promise<void> {
  if (oreAggiuntive <= 0) throw new Error('Le ore consuntivate devono essere un valore positivo');

  const mv = await port.getMicrovoce(microvoceId);
  const oreConsuntivate = mv.oreConsuntivate + oreAggiuntive;
  const { segnaleRischio, oreExtra } = valutaSegnaleRischio({ stato: mv.stato, orePreventivate: mv.orePreventivate, oreConsuntivate });

  await port.aggiornaMicrovoce(microvoceId, { oreConsuntivate, segnaleRischio, oreExtra });
  await ricalcolaModuloECascata(mv.moduloProgettoId, port);
}

/** §17.1 + §16.4/§7bis — causaNota obbligatoria, validata dal motore puro. */
export async function marcaRitardo(microvoceId: string, nuovoStato: Extract<StatoMicrovoce, 'delayed' | 'blocked'>, causaNota: string, port: EsecuzionePort): Promise<void> {
  const mv = await port.getMicrovoce(microvoceId);
  const aggiornata = marcaRitardoManualePuro(mv, nuovoStato, causaNota); // lancia se causaNota è vuota
  await port.aggiornaMicrovoce(microvoceId, { stato: aggiornata.stato, causaNota: aggiornata.causaNota });
  await ricalcolaModuloECascata(mv.moduloProgettoId, port);
}

/** §17.1 + §16.4 — la micro-voce torna operativa. */
export async function risolviRitardo(microvoceId: string, port: EsecuzionePort): Promise<void> {
  const mv = await port.getMicrovoce(microvoceId);
  const aggiornata = risolviRitardoManualePuro(mv);
  await port.aggiornaMicrovoce(microvoceId, { stato: aggiornata.stato, causaNota: aggiornata.causaNota });
  await ricalcolaModuloECascata(mv.moduloProgettoId, port);
}

export class ProceduraIncompletaError extends Error {}

/**
 * §17.1 — Il punto di raccordo tra procedura guidata (§6bis) e motore di stati (§16):
 * una micro-voce non si può chiudere se i suoi passaggi non sono tutti completati.
 * Questa è la validazione descritta esplicitamente nel documento, non solo un dettaglio
 * implementativo — va rifiutata con un errore chiaro, non con un fallimento silenzioso.
 */
export async function completaMicrovoce(microvoceId: string, port: EsecuzionePort): Promise<void> {
  const passaggi = await port.getPassaggiDellaMicrovoce(microvoceId);
  const incompleti = passaggi.filter((p) => p.stato !== 'done');
  if (incompleti.length > 0) {
    throw new ProceduraIncompletaError(
      `Impossibile completare: ${incompleti.length} passaggio/i ancora da completare (${incompleti.map((p) => p.id).join(', ')})`,
    );
  }

  const mv = await port.getMicrovoce(microvoceId);
  await port.aggiornaMicrovoce(microvoceId, { stato: 'done', segnaleRischio: false });
  await ricalcolaModuloECascata(mv.moduloProgettoId, port);
}

// ── Procedura guidata — §17.2 ──────────────────────────────────────────────

export async function completaPassaggioDocumento(passaggioId: string, port: EsecuzionePort): Promise<void> {
  const p = await port.getPassaggio(passaggioId);
  if (p.tipo !== 'documento') throw new Error(`Il passaggio ${passaggioId} non è di tipo documento`);
  await port.aggiornaPassaggio(passaggioId, { stato: 'done' });
}

export async function completaPassaggioForm(passaggioId: string, port: EsecuzionePort): Promise<void> {
  const p = await port.getPassaggio(passaggioId);
  if (p.tipo !== 'form') throw new Error(`Il passaggio ${passaggioId} non è di tipo form`);
  await port.aggiornaPassaggio(passaggioId, { stato: 'done' });
}

export async function marcaPassaggioCompletato(passaggioId: string, port: EsecuzionePort): Promise<void> {
  const p = await port.getPassaggio(passaggioId);
  if (p.tipo !== 'info' && p.tipo !== 'verifica') {
    throw new Error(`/marca-completato è solo per passaggi info/verifica — questo è ${p.tipo} (§17.2)`);
  }
  await port.aggiornaPassaggio(passaggioId, { stato: 'done' });
}

// ── Cascata verso l'alto — §16.2/§16.5, riusata da tutte le funzioni sopra ─────────────

async function ricalcolaModuloECascata(moduloProgettoId: string, port: EsecuzionePort): Promise<void> {
  const microvoci = await port.getMicrovociDelModulo(moduloProgettoId);
  const nuovoStatoModulo = calcolaStatoModulo(microvoci);
  const modulo = await port.getModulo(moduloProgettoId);
  const eraGiaDone = modulo.stato === 'done';

  await port.aggiornaModulo(moduloProgettoId, { stato: nuovoStatoModulo });

  // §16.5 — se il modulo è appena diventato 'done' (non lo era prima), prova a sbloccare
  // i moduli dipendenti dello stesso progetto.
  if (nuovoStatoModulo === 'done' && !eraGiaDone) {
    // Blocco 3 — evento "modulo completato" verso lo studio. Fuori dalla logica
    // di cascata: se la notifica fallisce il calcolo resta comunque applicato.
    await port.notificaModuloCompletato?.(moduloProgettoId).catch(() => {});

    const moduliProgetto = await port.getModuliDelProgettoConDipendenze(modulo.progettoId);
    const sbloccati = risolviDipendenze(moduliProgetto, moduloProgettoId);

    for (const moduloSbloccatoId of sbloccati) {
      const microvociDaSbloccare = await port.getMicrovociDelModulo(moduloSbloccatoId);
      for (const mv of microvociDaSbloccare) {
        if (mv.stato === 'attesa_dipendenza') {
          await port.aggiornaMicrovoce(mv.id, { stato: 'pending' });
        }
      }
      // il modulo appena sbloccato non ha più micro-voci in attesa_dipendenza:
      // ricalcola anche il suo stato (diventerà 'pending', pronto per essere preso in carico)
      const microvociAggiornate = await port.getMicrovociDelModulo(moduloSbloccatoId);
      await port.aggiornaModulo(moduloSbloccatoId, { stato: calcolaStatoModulo(microvociAggiornate) });
    }
  }
}
