/**
 * L'indirizzo pubblico di *questo* backend: quello che Meta e Telegram devono chiamare.
 *
 * Perché esiste un file per una riga di codice. Il valore era scritto tre volte con tre
 * convenzioni diverse (`src/routes/webhooks.ts`, `frontend/src/api/http.ts`,
 * `frontend/src/utils/index.ts`), e serviva a comporre i webhook. Aggiungendo il path di
 * callback WhatsApp per studio i punti diventavano quattro, e il primo che avesse dimenticato
 * `RAILWAY_PUBLIC_DOMAIN` avrebbe mostrato allo studio un indirizzo che non esiste più.
 *
 * `RAILWAY_PUBLIC_DOMAIN` è fornita da Railway e tiene il valore allineato all'ambiente (la
 * produzione e ogni ambiente di prova). Il dominio di produzione resta come ripiego per gli
 * ambienti che non la espongono — la macchina di chi sviluppa, dove comunque nessun provider
 * chiama.
 *
 * ⚠️ Ma Railway non è l'unico ambiente. La seconda sorgente è `APP_BASE_URL`, la convenzione
 * del progetto per «dove vive questo deployment», che leggono già `emailRelay`, `imapInbound`,
 * `serverHelpers` ed `emailService`. Fuori da Railway è l'unica che sa la risposta: sul VPS
 * `RAILWAY_PUBLIC_DOMAIN` **non esiste**, e senza questo ramo i callback di WhatsApp e Telegram
 * si componevano sul dominio di Railway — **un altro backend, con un altro database**. Uno
 * studio che avesse configurato Meta da lì avrebbe mandato i messaggi dei suoi clienti
 * all'ambiente sbagliato, e non se ne sarebbe accorto nessuno finché un cliente non avesse
 * scritto senza ricevere risposta (corretto il 01/10/2026).
 */
const DOMINIO_PREDEFINITO = 'bluman-api-production.up.railway.app';

export const ROTTA_WA = '/webhooks/communications/whatsapp';
export const ROTTA_TG = '/webhooks/communications/telegram';

/**
 * `RAILWAY_PUBLIC_DOMAIN` è un **dominio nudo** (`bluman-api.up.railway.app`): si toglie un
 * eventuale schema e si rimette `https`. Railway lo espone senza schema, ma chi lo legge da un
 * altro contesto può avercelo messo, e `https://https://…` non è un errore di configurazione
 * visibile: è un 404 al momento della verifica in Meta.
 */
function urlDaDominioNudo(valore: string | undefined): string | null {
  const pulito = valore?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
  return pulito ? `https://${pulito}` : null;
}

/**
 * `APP_BASE_URL` è invece un **URL completo** (`http://localhost:5173` in locale,
 * `https://studio.esempio` in produzione), e lo schema si conserva di proposito: sul VPS, prima
 * del TLS, l'indirizzo è legittimamente `http://` e imporgli `https://` comporrebbe un callback
 * che non risponde. Uno schema assente si interpreta come `https`, perché un indirizzo nudo è
 * comunque un host pubblico.
 */
function urlDaIndirizzoDichiarato(valore: string | undefined): string | null {
  const grezzo = (valore ?? '').trim();
  if (!grezzo) return null;
  const conSchema = /^https?:\/\//i.test(grezzo) ? grezzo : `https://${grezzo}`;
  // `https://` da solo è uno schema senza host: non è un indirizzo a cui si possa consegnare
  // un webhook. Vale come variabile assente invece di produrre `https://https:`.
  const host = conSchema.replace(/^https?:\/\//i, '').split('/')[0];
  if (!host) return null;
  return conSchema.replace(/\/+$/, '');
}

export function urlPubblicaBackend(): string {
  // L'ordine è la regola: dove Railway espone il proprio dominio quello vince (è l'ambiente in
  // cui la richiesta arriva davvero, e copre anche gli ambienti di prova); altrove decide
  // `APP_BASE_URL`; il dominio di produzione resta solo per chi non dichiara nulla.
  return (
    urlDaDominioNudo(process.env.RAILWAY_PUBLIC_DOMAIN) ??
    urlDaIndirizzoDichiarato(process.env.APP_BASE_URL) ??
    `https://${DOMINIO_PREDEFINITO}`
  );
}

/**
 * Forma ammessa per il discriminante del path di callback.
 *
 * È lo stesso alfabeto che `gen_random_uuid()` produce senza trattini (32 esadecimali), con
 * margine per rigenerazioni future. Il controllo serve prima di comporre un URL che finisce in
 * un campo dell'interfaccia e in una chiamata a Meta: uno slug con dentro `/` o `..`
 * cambierebbe il path invece di nominarlo.
 */
export function slugValido(valore: unknown): string | null {
  const s = typeof valore === 'string' ? valore.trim() : '';
  return /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : null;
}

/** Callback URL di WhatsApp per lo studio, o `null` se lo studio non ha ancora uno slug. */
export function urlWebhookWhatsapp(slug: unknown): string | null {
  const valido = slugValido(slug);
  return valido ? `${urlPubblicaBackend()}${ROTTA_WA}/${valido}` : null;
}

/** Endpoint su cui Telegram consegna gli aggiornamenti del bot. */
export function urlWebhookTelegram(): string {
  return `${urlPubblicaBackend()}${ROTTA_TG}`;
}
