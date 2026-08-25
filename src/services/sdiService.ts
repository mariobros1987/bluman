import crypto from 'crypto';

export interface PreparazioneInvioManualeResult {
  ok: boolean;
  riferimentoPreparazione: string;
  dataPreparazione: string;
  message: string;
}

/**
 * §3.5 — Preparazione della fattura per l'invio manuale a SdI.
 *
 * Questo servizio un tempo si chiamava `trasmettiFatturaSdi` e dichiarava la fattura
 * «trasmessa con successo al Sistema di Interscambio» generando un identificativo con
 * il formato di quelli veri (SDI-IT-...), senza che alcun provider fosse collegato:
 * un falso fiscale a tutti gli effetti.
 *
 * La realtà è che non esiste ancora un canale SdI collegato (nessun provider): il
 * sistema prepara la fattura (l'XML si scarica dalla rotta dedicata), restituisce un
 * riferimento LOCALE di preparazione e nulla più. La trasmissione la fa l'operatore
 * tramite il portale «Fatture & Corrispettivi» dell'Agenzia delle Entrate o il proprio
 * intermediario; l'esito vero (consegnata/scartata/mancata_consegna) viene registrato
 * solo quando arriva via webhook esiti.
 */
export async function preparaFatturaPerInvioManuale(params: {
  fatturaId: string;
  numeroProgressivo: string;
}): Promise<PreparazioneInvioManualeResult> {
  const timestampIso = new Date().toISOString();
  // Riferimento LOCALE di preparazione — NON è un identificativo rilasciato da SdI.
  const riferimentoPreparazione = `PREP-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  console.log(`[FATTURAZIONE] Fattura ${params.numeroProgressivo} preparata per invio manuale a SdI (riferimento locale: ${riferimentoPreparazione})`);

  return {
    ok: true,
    riferimentoPreparazione,
    dataPreparazione: timestampIso,
    message:
      `Fattura ${params.numeroProgressivo} pronta per l'invio manuale: scarica l'XML e trasmettilo ` +
      `tramite il portale «Fatture & Corrispettivi» o il tuo intermediario. ` +
      `Il sistema NON ha inviato nulla allo SdI (nessun provider collegato).`,
  };
}
