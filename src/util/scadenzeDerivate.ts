/**
 * Le regole con cui una data diventa una scadenza.
 *
 * Perché questo file esiste. Il cron notturno (`cronService.ts`) sa già quando un rinnovo KYC è
 * vicino e quando una rata va sollecitata. Il calendario deve mostrare **le stesse** scadenze. Se
 * le due cose calcolassero ognuna per conto proprio, prima o poi direbbero due cose diverse — e il
 * caso peggiore non è che una delle due sbagli: è che l'operatore riceva una notifica per una
 * scadenza che nel calendario non c'è, o veda nel calendario una scadenza per cui nessuno lo ha
 * avvisato. Con due implementazioni quel disallineamento è una questione di tempo, non di bravura.
 *
 * Quindi qui c'è **una** implementazione, pura e senza database, e la usano entrambi: il cron per
 * decidere se notificare, la rotta del calendario per decidere cosa disegnare.
 *
 * Puro significa: nessun `import` di Prisma, nessuna query, nessun `new Date()` nascosto dentro una
 * funzione senza poterlo passare da fuori. Una regola che non si può interrogare con una data finta
 * non si può nemmeno verificare.
 */

/** Un anno, in millisecondi. È l'anno «commerciale» di 365 giorni, non l'anno solare. */
export const ANNO_MS = 365 * 24 * 60 * 60 * 1000;

const GIORNO_MS = 24 * 60 * 60 * 1000;

/**
 * Con quanti giorni di anticipo si avvisa che il rinnovo KYC è vicino.
 *
 * La verifica antiriciclaggio si rinnova ogni anno; avvisare il giorno stesso non serve a niente,
 * perché il fascicolo va ricostruito prima.
 */
export const GIORNI_PREAVVISO_KYC = 30;

/**
 * I giorni in cui una rata aperta va sollecitata: una settimana prima, il giorno stesso, e tre
 * giorni dopo la scadenza. Non è una scala crescente: sono tre momenti distinti, e il terzo esiste
 * perché il primo e il secondo si perdono facilmente.
 *
 * **Il verso è quello del cron**: il numero è `dataScadenza − oggi` in giorni, quindi è **positivo
 * quando la scadenza è ancora da venire**. «Una settimana prima» si scrive `7`, non `-7`. Il verso
 * opposto è l'errore naturale da fare qui — il primo tentativo di questo file lo conteneva, e il
 * test lo ha preso — ed è anche il più costoso, perché invertito il sollecito arriverebbe tre
 * giorni prima e mai dopo.
 */
export const GIORNI_SOLLECITO_RATA = [7, 0, -3] as const;

/**
 * Il primo giorno di preavviso, in età del KYC.
 *
 * Il cron avvisa quando l'età supera `365 − 30`, cioè quando al rinnovo mancano **29** giorni e
 * non 30: il giorno esatto del preavviso resta fuori. È un off-by-one reale, conservato qui perché
 * correggerlo sposta di un giorno una notifica che l'operatore riceve già — una decisione, non un
 * refactoring. Il test lo fissa, così smette di essere invisibile.
 */
export const ETA_KYC_PRIMO_AVVISO = 365 - GIORNI_PREAVVISO_KYC;

function adData(valore: Date | string | null | undefined): Date | null {
  if (!valore) return null;
  const d = valore instanceof Date ? valore : new Date(valore);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Quanti giorni interi separano due istanti, arrotondati al più vicino. */
function giorniFra(dal: Date, al: Date): number {
  return Math.round((al.getTime() - dal.getTime()) / GIORNO_MS);
}

// ── Rinnovo KYC ─────────────────────────────────────────────────────────────────

/**
 * La data del rinnovo: l'anniversario della verifica. `null` quando il KYC non è mai stato fatto —
 * e in quel caso **non c'è nessuna scadenza**, che è diverso da «scade oggi».
 */
export function rinnovoKyc(dataKyc: Date | string | null | undefined): Date | null {
  const fatta = adData(dataKyc);
  if (!fatta) return null;
  return new Date(fatta.getTime() + ANNO_MS);
}

/** Quanti giorni mancano al rinnovo. Negativo quando è già passato e nessuno l'ha rifatto. */
export function giorniAlRinnovoKyc(
  dataKyc: Date | string | null | undefined,
  adesso: Date = new Date(),
): number | null {
  const rinnovo = rinnovoKyc(dataKyc);
  if (!rinnovo) return null;
  return giorniFra(adesso, rinnovo);
}

/**
 * Vero quando il rinnovo è a `GIORNI_PREAVVISO_KYC` giorni o meno.
 *
 * **La condizione è scritta nella stessa forma che usa il cron**, e non in una forma equivalente
 * ma più leggibile, di proposito: questo file deve poter sostituire il calcolo del cron senza
 * cambiarne il comportamento di un giorno. Chi rifattorizza lo faccia sapendo che i due numeri
 * devono restare identici, e che il test lo verifica.
 *
 * Nota su ciò che questa funzione **non** dice: non c'è un limite superiore. Un KYC la cui
 * scadenza è passata da mesi resta «in avviso» per sempre, quindi il cron lo notifica ogni giorno
 * (la deduplicazione a 20 ore non copre il giorno dopo). È il comportamento attuale, conservato
 * qui di proposito: correggerlo cambia cosa riceve l'operatore, e va deciso, non scoperto. Il
 * calendario, che non ha questo problema, usa `giorniAlRinnovoKyc` e mostra una scadenza scaduta
 * come scaduta.
 */
export function kycInAvviso(
  dataKyc: Date | string | null | undefined,
  adesso: Date = new Date(),
): boolean {
  const fatta = adData(dataKyc);
  if (!fatta) return false;
  const eta = adesso.getTime() - fatta.getTime();
  return eta > ANNO_MS - GIORNI_PREAVVISO_KYC * GIORNO_MS;
}

// ── Rate di incasso ─────────────────────────────────────────────────────────────

/**
 * Il giorno di sollecito, se oggi è uno di quelli; `null` altrimenti.
 *
 * Il valore restituito è lo scostamento dalla scadenza nel verso del cron (positivo = la scadenza
 * deve ancora arrivare), che è quello che serve a scegliere il tono del messaggio.
 */
export function giornoSollecitoRata(
  dataScadenza: Date | string | null | undefined,
  adesso: Date = new Date(),
): number | null {
  const scadenza = adData(dataScadenza);
  if (!scadenza) return null;
  const diff = giorniFra(adesso, scadenza);
  return (GIORNI_SOLLECITO_RATA as readonly number[]).includes(diff) ? diff : null;
}

/** Il tono del sollecito, che dipende da quanto la scadenza è lontana. */
export function tonoRata(giorno: number): 'scaduta' | 'oggi' | 'vicina' {
  if (giorno < 0) return 'scaduta';
  if (giorno === 0) return 'oggi';
  return 'vicina';
}

// ── Stato di una scadenza, per come si disegna ──────────────────────────────────

export type StatoScadenza = 'da_fare' | 'scaduta' | 'fatta';

/**
 * Come si presenta una scadenza nel calendario.
 *
 * `dataScadenza` da sola non basta a dirlo: una rata già incassata con data passata non è
 * «scaduta», è chiusa. Per questo lo stato della sorgente entra nel calcolo, ed è il motivo per cui
 * questa funzione sta qui e non nel componente che disegna.
 */
export function statoScadenza(
  dataScadenza: Date | string | null | undefined,
  chiusa: boolean,
  adesso: Date = new Date(),
): StatoScadenza {
  if (chiusa) return 'fatta';
  const scadenza = adData(dataScadenza);
  if (!scadenza) return 'da_fare';
  return giorniFra(adesso, scadenza) < 0 ? 'scaduta' : 'da_fare';
}
