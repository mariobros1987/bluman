// Integrazione Sentry per il frontend — speculare a src/plugins/sentry.ts del
// backend (voce 6.2 del PIANO_DI_MIGLIORAMENTO).
//
// Opt-in per costruzione: senza VITE_SENTRY_DSN l'SDK non viene nemmeno caricato.
// L'import è dinamico, quindi Vite lo mette in un chunk separato che il browser
// scarica SOLO quando il DSN è impostato (Vercel → Settings → Environment
// Variables): sviluppo locale e suite di test restano a zero costo, zero rete.
//
// Con il DSN attivo arrivano su Sentry gli errori non gestiti (window.onerror e
// unhandledrejection li installa Sentry.init) e quelli di render catturati
// dall'ErrorBoundary. La privacy è la stessa del backend: niente PII, niente
// breadcrumb con dati dei clienti, solo l'errore e i tag minimi.
//
// Nota sulla corsa iniziale: init è asincrono (caricamento del chunk). Un errore
// nei primissimi istanti dopo il reload può cadere prima che Sentry sia pronto —
// resta in console, e l'ErrorBoundary lo mostra comunque in pagina.

type SentryClient = typeof import('@sentry/react');

let client: SentryClient | null = null;
let avvioInCorso = false;

/**
 * Inizializza Sentry se e solo se VITE_SENTRY_DSN è configurato. Idempotente:
 * chiamarla più volte (StrictMode monta due volte) non reinizializza.
 */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || client || avvioInCorso) return;
  avvioInCorso = true;

  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Solo errori, come il backend: niente performance monitoring al primo
    // rollout (volume, costo, PII nelle transazioni).
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
  client = Sentry;
}

/**
 * Segnala un errore a Sentry. No-op totale finché il DSN non è configurato:
 * i chiamanti non devono sapere se l'error tracking esiste.
 */
export function captureException(
  errore: unknown,
  opzioni?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
): void {
  if (!client) return;
  client.captureException(errore, opzioni);
}
