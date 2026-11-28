// Il form che il cliente compila per un articolo della Libreria (deciso dal titolare il
// 28/11/2026): «nell'articolo deve essere indicato il form da compilare da parte del cliente;
// se è già compilato prende i dati direttamente da lì». PURO: lo usano le rotte dei form,
// l'istanziazione del progetto e le prove.
//
// Un form è un nome e un elenco di domande (stringhe). Sul passaggio del progetto le domande
// stanno in `campi_form_json` (elenco di stringhe) e le risposte in `risposte_form_json`
// (oggetto domanda → risposta): sono le due forme che la scheda del passaggio sa già disegnare.

export interface FormDellArticolo {
  id: string;
  nome: string;
  campi: string[];
}

export const LUNGHEZZA_MASSIMA_NOME_FORM = 120;
export const LUNGHEZZA_MASSIMA_CAMPO_FORM = 120;
export const NUMERO_MASSIMO_CAMPI_FORM = 40;

/** Le domande di un form: stringhe non vuote, senza doppioni (maiuscole e spazi non contano). */
export function campiDelForm(campiJson: unknown): string[] {
  if (!Array.isArray(campiJson)) return [];
  const visti = new Set<string>();
  const campi: string[] = [];
  for (const c of campiJson) {
    if (typeof c !== 'string') continue;
    const pulito = c.trim();
    const chiave = pulito.toLowerCase();
    if (!pulito || visti.has(chiave)) continue;
    visti.add(chiave);
    campi.push(pulito);
  }
  return campi;
}

/** `null` se nome e domande vanno bene; altrimenti la frase per chi sta creando il form. */
export function motivoFormNonValido(nome: unknown, campi: unknown): string | null {
  if (typeof nome !== 'string' || !nome.trim()) return 'Il form deve avere un nome.';
  if (nome.trim().length > LUNGHEZZA_MASSIMA_NOME_FORM) {
    return `Il nome del form è troppo lungo (al massimo ${LUNGHEZZA_MASSIMA_NOME_FORM} caratteri).`;
  }
  if (!Array.isArray(campi) || campi.some((c) => typeof c !== 'string')) {
    return 'Le domande del form devono essere un elenco di testi.';
  }
  const puliti = campiDelForm(campi);
  if (puliti.length === 0) return 'Il form deve avere almeno una domanda: un form vuoto non chiede niente al cliente.';
  if (puliti.length > NUMERO_MASSIMO_CAMPI_FORM) {
    return `Il form ha troppe domande (al massimo ${NUMERO_MASSIMO_CAMPI_FORM}).`;
  }
  if (puliti.some((c) => c.length > LUNGHEZZA_MASSIMA_CAMPO_FORM)) {
    return `Una domanda è troppo lunga (al massimo ${LUNGHEZZA_MASSIMA_CAMPO_FORM} caratteri).`;
  }
  return null;
}

export interface PassaggioDelForm {
  titolo: string;
  tipo: 'form';
  chi: 'cliente';
  ordine: number;
  descrizione: string | null;
  campiFormJson: string[];
  formMasterId: string;
}

/** Il passaggio che il form dell'articolo fa nascere sull'attività del progetto. */
export function passaggioDelForm(form: FormDellArticolo, ordine: number): PassaggioDelForm {
  return {
    titolo: `Compila il form «${form.nome}»`,
    tipo: 'form',
    chi: 'cliente',
    ordine,
    descrizione: 'Dati chiesti al cliente dal form dell’articolo.',
    campiFormJson: form.campi,
    formMasterId: form.id,
  };
}

/**
 * Le risposte già date che valgono per le domande di oggi: solo le domande ancora nel form e
 * solo le risposte non vuote. `null` se non ce n'è nessuna — un form mai compilato non si
 * «riusa» vuoto.
 */
export function risposteRiutilizzabili(campi: readonly string[], risposte: unknown): Record<string, string> | null {
  if (!risposte || typeof risposte !== 'object' || Array.isArray(risposte)) return null;
  const date = risposte as Record<string, unknown>;
  const valide: Record<string, string> = {};
  for (const campo of campi) {
    const valore = date[campo];
    if (typeof valore === 'string' && valore.trim()) valide[campo] = valore;
  }
  return Object.keys(valide).length > 0 ? valide : null;
}

/** La frase che dice all'operatore da dove vengono le risposte già scritte (regola 12). */
export function notaRisposteRiprese(progettoNome: string, compilate: number, domande: number): string {
  return (
    `Risposte riprese da quelle che il cliente ha già dato nel progetto «${progettoNome}» ` +
    `(${compilate} di ${domande} domande): controllale prima di segnare il passaggio come fatto.`
  );
}
