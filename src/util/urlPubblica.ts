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
 */
const DOMINIO_PREDEFINITO = 'bluman-api-production.up.railway.app';

export const ROTTA_WA = '/webhooks/communications/whatsapp';
export const ROTTA_TG = '/webhooks/communications/telegram';

export function urlPubblicaBackend(): string {
  const dominio = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const pulito = dominio
    ?.replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .trim();
  return `https://${pulito || DOMINIO_PREDEFINITO}`;
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
