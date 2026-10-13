/**
 * I dati dell'anagrafica dello studio **senza i quali l'app non può comporre un documento**.
 *
 * Non è un elenco di buone intenzioni: è la lista dei campi che `sdiXmlGenerator.ts` legge per
 * scrivere il cedente di una fattura elettronica. Prima di questa lista, un campo vuoto non
 * fermava niente — l'app scriveva un valore inventato al suo posto:
 *
 * - P.IVA e codice fiscale mancanti → `'00000000000'` (sdiXmlGenerator.ts);
 * - regime fiscale mancante → `'RF01'`, cioè «ordinario» (sdiXmlGenerator.ts);
 * - indirizzo mancante → `'Via Roma 1'`, `'00100'`, `'Roma'`, `'RM'` (sdiXmlGenerator.ts);
 * - denominazione mancante → `'Studio Advisory'` (mappaturaFatturaSdi.ts).
 *
 * Un XML con la P.IVA a zero non è un documento con un buco: è un documento che **dice il falso**,
 * e SdI o lo scarta o lo accetta — in nessuno dei due casi è la fattura dello studio. Da qui la
 * regola: questi campi si chiedono, non si indovinano.
 *
 * La lista è **una sola** e vive qui. La espone `GET /tenant/anagrafica` (per la guida in-app) e la
 * usa il controllo prima della generazione dell'XML (per rifiutare): due copie divergerebbero, ed è
 * la classe di guasto che `src/canaliCoerenza.test.ts` racconta per i canali.
 */

export interface CampoAnagrafica {
  /** La colonna della riga `tenant`, con il nome che ha nel codice. */
  chiave: 'ragioneSociale' | 'piva' | 'codiceFiscale' | 'sedeLegale' | 'regimeFiscale' | 'iban';
  /** L'etichetta che l'operatore legge in Impostazioni → Anagrafica (`TabCompany.tsx`). */
  etichetta: string;
  /** Dove finisce il valore, in una riga. */
  dove: string;
  /** Cosa l'app scriveva al suo posto finché poteva inventare. */
  senza: string;
}

export const CAMPI_ANAGRAFICA: readonly CampoAnagrafica[] = [
  {
    chiave: 'ragioneSociale',
    etichetta: 'Ragione Sociale Studio',
    dove: 'la «Denominazione» del cedente in ogni fattura elettronica, e l’intestazione di ogni documento',
    senza: 'l’app scriveva «Studio Advisory»',
  },
  {
    chiave: 'piva',
    etichetta: 'Partita IVA / VAT Number',
    dove: 'l’«IdCodice» dell’identificativo fiscale del cedente nell’XML SDI',
    senza: 'l’app scriveva «00000000000»',
  },
  {
    chiave: 'codiceFiscale',
    etichetta: 'Codice Fiscale Societario',
    dove: 'il «CodiceFiscale» del cedente nell’XML SDI',
    senza: 'l’app ripiegava sulla partita IVA, e senza quella scriveva «00000000000»',
  },
  {
    chiave: 'sedeLegale',
    etichetta: 'Indirizzo Sede Legale',
    dove: 'l’indirizzo della sede del cedente nell’XML SDI e nelle intestazioni',
    senza: 'l’app scriveva «Via Roma 1»',
  },
  {
    chiave: 'regimeFiscale',
    etichetta: 'Regime Fiscale',
    dove: 'il «RegimeFiscale» del cedente nell’XML SDI',
    senza: 'l’app scriveva «RF01», cioè «ordinario» — un regime che potrebbe non essere il tuo',
  },
  {
    chiave: 'iban',
    etichetta: 'IBAN per Accredito Fatture',
    dove: 'le coordinate di pagamento stampate in fattura e nei solleciti',
    senza: 'la fattura usciva senza coordinate su cui pagare',
  },
] as const;

/**
 * Vero se il valore è assente. Vuoto è `null`, `undefined` o una stringa di soli spazi — **non**
 * `falsy` generico: oggi nessuno di questi campi è numerico, ma la regola scritta evita che un
 * domani uno `0` legittimo passi per «mancante». Una stringa di soli spazi è vuota perché è così
 * che si presenta un campo toccato e lasciato in bianco: `trim()` la riconduce a quel che è.
 */
function assente(valore: unknown): boolean {
  if (valore === null || valore === undefined) return true;
  return typeof valore === 'string' && valore.trim() === '';
}

/**
 * I campi obbligatori che **mancano** nella riga dello studio, nell'ordine in cui vanno compilati.
 *
 * Restituisce `[]` quando l'anagrafica è completa. Con `null` (riga non leggibile) restituisce
 * **tutti** i campi: non si sa che ci siano, quindi non si può dire che ci siano. È il verso giusto
 * dell'errore — chi legge vede una guida da compilare, non un documento falso.
 */
export function campiAnagraficaMancanti(
  tenant: Record<string, unknown> | null | undefined,
): CampoAnagrafica[] {
  return CAMPI_ANAGRAFICA.filter(c => assente(tenant?.[c.chiave]));
}

/** L'anagrafica è completa: si può comporre un documento fiscale senza inventare niente. */
export function anagraficaCompleta(tenant: Record<string, unknown> | null | undefined): boolean {
  return campiAnagraficaMancanti(tenant).length === 0;
}

/**
 * Il messaggio con cui si rifiuta di comporre un documento: **nomina i campi**, non dice
 * «anagrafica incompleta». Un rifiuto che non dice cosa manca costringe l'operatore a indovinare
 * fra sei campi in un'altra schermata — la stessa ragione per cui `statoIngressoWhatsapp`
 * (`routes/tenant.ts`) elenca i pezzi mancanti del canale invece di dire «non configurato».
 */
export function messaggioAnagraficaIncompleta(mancanti: CampoAnagrafica[]): string {
  const elenco = mancanti.map(c => c.etichetta).join(', ');
  return `Anagrafica dello studio incompleta: senza ${elenco} il documento fiscale non si può comporre. Compilali in Impostazioni → Anagrafica: l’app non li inventa.`;
}
