import { escapeHtmlTesto } from './htmlSanitizer.js';

/**
 * Il testo semplice diventa HTML senza che `<` o `&` rompano il messaggio.
 *
 * Vive qui e non in `src/routes/comunicazioni.ts`, dove è nata, perché serve a due percorsi: il
 * messaggio che l'operatore scrive a mano e l'invito a collegare la chat Telegram a una pratica
 * (`src/routes/collegamentoChat.ts`). Una seconda copia sarebbe la terza volta in questo repository
 * che lo stesso pezzo di corpo di un'email esiste in due posti e diverge — con la differenza che
 * qui la divergenza sarebbe invisibile: la copia dimenticata continuerebbe a spedire email che
 * sembrano giuste.
 *
 * Per lo stesso motivo l'escape non è riscritto qui: si usa `escapeHtmlTesto`, che è la regola già
 * in vigore in `htmlSanitizer.ts`. Quella protegge anche `"` e `'`, che in un nodo di testo non
 * servirebbero; una seconda catena di `replace` con tre caratteri invece di cinque sarebbe una
 * regola in meno da tenere allineata, cioè esattamente la divergenza che questa estrazione vuole
 * evitare — e il giorno in cui qualcuno riusasse questo output dentro un attributo, la differenza
 * conterebbe.
 *
 * Il nome della pratica e quello del cliente arrivano dal database: possono contenere `&` o `<`, e
 * senza questa protezione finirebbero nel corpo dell'email come markup.
 */
export function testoInHtml(testo: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;white-space:pre-wrap">${escapeHtmlTesto(testo)}</div>`;
}
