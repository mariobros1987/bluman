/**
 * Toglie da un sorgente i commenti di riga e di blocco, lasciando intatte le stringhe.
 *
 * Serve ai presidi strutturali: quelli che verificano che un nome — un server di posta di terzi,
 * la casella di un solo studio — non compaia in una posizione di codice. La distinzione conta,
 * perché i commenti che raccontano una correzione devono poter nominare quello che è stato
 * corretto, e senza questo passaggio ogni presidio segnalerebbe le proprie spiegazioni.
 *
 * Riconosce anche i letterali regex: `replace(/([\\"])/g, …)` in `emailService.ts` contiene una
 * virgoletta, e senza trattarli la scansione la prendeva per l'inizio di una stringa — da lì in
 * poi i commenti risultavano codice.
 *
 * Sta in `src/util/` e non dentro un file di test perché lo usano due presidi diversi
 * (`postaDiagnosi.test.ts` e `postaRecordDns.test.ts`) e la copia divergente era il modo più
 * rapido per avere due scansioni che non concordano.
 */
export function soloCodice(sorgente: string): string {
  let fuori = '';
  let i = 0;
  let apice: string | null = null;
  /** Ultimo carattere significativo di codice: dice se una `/` apre una regex o divide. */
  let precedente = '';

  while (i < sorgente.length) {
    const c = sorgente[i];
    const d = sorgente[i + 1];

    if (apice) {
      if (c === '\\') {
        fuori += c + (d ?? '');
        i += 2;
        continue;
      }
      if (c === apice) apice = null;
      fuori += c;
      i += 1;
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      apice = c;
      precedente = c;
      fuori += c;
      i += 1;
      continue;
    }

    if (c === '/' && d === '/') {
      while (i < sorgente.length && sorgente[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && d === '*') {
      i += 2;
      while (i < sorgente.length && !(sorgente[i] === '*' && sorgente[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    // `<` non è in questo elenco perché nei `.tsx` apre un tag di chiusura: con `<` dentro,
    // `</div>` veniva letto come l'inizio di un letterale regex e la scansione si mangiava il
    // testo JSX fino alla fine della riga — cioè proprio il testo che i presidi controllano.
    // `>` invece resta: `x => /re/.test(y)` è una regex dopo una freccia.
    if (c === '/' && (precedente === '' || '(,=:[!&|?{};+-*%^>~'.includes(precedente))) {
      i += 1;
      let dentroClasse = false;
      while (i < sorgente.length) {
        const r = sorgente[i];
        if (r === '\\') {
          i += 2;
          continue;
        }
        if (r === '\n') break;
        if (r === '[') dentroClasse = true;
        else if (r === ']') dentroClasse = false;
        else if (r === '/' && !dentroClasse) {
          i += 1;
          break;
        }
        i += 1;
      }
      precedente = '/';
      continue;
    }

    fuori += c;
    if (c && !/\s/.test(c)) precedente = c;
    i += 1;
  }

  return fuori;
}
