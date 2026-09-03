/**
 * Invio WhatsApp verso Meta Cloud API, con le credenziali dello studio.
 *
 * Esisteva in tre copie divergenti: dentro `otpDispatch.ts` (l'unica corretta, che legge le
 * credenziali dalla riga Tenant), dentro `POST /progetti/:id/comunicazioni` (che leggeva solo
 * `process.env`, cioè il numero di un solo studio per tutti i tenant) e nella funzione
 * serverless `api/send-whatsapp.ts`, chiamata direttamente dal browser senza autenticazione e
 * con `Access-Control-Allow-Origin: *`. La terza rispondeva anche `success: true` quando il
 * ripiego su `hello_world` falliva: all'operatore arrivava un successo, al cliente niente.
 *
 * Qui c'è una sola implementazione. Le credenziali arrivano dal chiamante — che le prende da
 * `credenzialiCanali(tenantId)`, quindi dalla riga dello studio — e un invio non riuscito
 * risponde `ok: false` con il motivo che ha dato Meta, mai un successo inventato.
 */

/** Il minimo indispensabile: `CredenzialiCanali` di `otpDispatch` è compatibile per forma. */
export interface CredenzialiWhatsapp {
  waPhoneId: string | null;
  waAccessToken: string | null;
}

export interface EsitoWhatsapp {
  ok: boolean;
  errore?: string;
}

/**
 * Graph vuole il numero in cifre, senza `+` né spazi né parentesi.
 *
 * Restituisce `null` quando quello che resta non può essere un numero internazionale: un
 * tentativo verso otto cifre casuali non recapita niente e consuma un tentativo di consegna.
 */
export function numeroPerGraph(numero: string | null | undefined): string | null {
  const cifre = String(numero ?? '').replace(/\D/g, '');
  return cifre.length >= 8 ? cifre : null;
}

/** Una chiamata a Graph. `motivo` riporta il messaggio di Meta, che è quello utile. */
export async function chiamaGraphWhatsapp(
  cred: CredenzialiWhatsapp,
  corpo: unknown,
): Promise<{ ok: boolean; motivo?: string }> {
  const risposta = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(String(cred.waPhoneId))}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cred.waAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
  });

  if (risposta.ok) return { ok: true };

  const dettaglio: any = await risposta.json().catch(() => null);
  // Il messaggio di Graph va riportato: "fuori dalla finestra di 24 ore" (131047), "template
  // non trovato" e "numero non registrato su WhatsApp" sono problemi diversi, con rimedi
  // diversi, e chi sta spedendo deve sapere quale dei tre è.
  const codice = dettaglio?.error?.code ? ` [${dettaglio.error.code}]` : '';
  return { ok: false, motivo: `${dettaglio?.error?.message || `HTTP ${risposta.status}`}${codice}` };
}

/** Vero quando le credenziali dello studio bastano per provare a spedire. */
export function whatsappConfigurato(cred: CredenzialiWhatsapp): boolean {
  return Boolean(cred.waPhoneId && cred.waAccessToken);
}

/**
 * Messaggio di testo libero.
 *
 * WhatsApp lo recapita solo se il destinatario ha scritto allo studio nelle ultime 24 ore:
 * fuori da quella finestra Meta risponde 131047 e il messaggio non parte. Non c'è un ripiego
 * automatico su un template di esempio, perché al cliente arriverebbe «Hello World» invece di
 * quello che l'operatore ha scritto — e l'operatore leggerebbe «consegnato».
 */
export async function inviaTestoWhatsapp(
  cred: CredenzialiWhatsapp,
  numero: string,
  testo: string,
): Promise<EsitoWhatsapp> {
  if (!whatsappConfigurato(cred)) {
    return { ok: false, errore: 'WhatsApp non è configurato nelle impostazioni dello studio (Phone ID e access token).' };
  }
  const destinatario = numeroPerGraph(numero);
  if (!destinatario) {
    return { ok: false, errore: 'Il numero di cellulare non è utilizzabile: servono almeno 8 cifre con il prefisso internazionale.' };
  }
  if (!testo.trim()) {
    return { ok: false, errore: 'Nessun testo da spedire.' };
  }

  try {
    const esito = await chiamaGraphWhatsapp(cred, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: destinatario,
      type: 'text',
      text: { preview_url: false, body: testo },
    });
    if (esito.ok) return { ok: true };

    const finestra = /131047/.test(esito.motivo || '')
      ? ' Il destinatario non ha scritto allo studio nelle ultime 24 ore: WhatsApp consegna solo template approvati fuori da quella finestra.'
      : '';
    return { ok: false, errore: `WhatsApp non ha accettato l'invio — ${esito.motivo}.${finestra}` };
  } catch (err) {
    return { ok: false, errore: `WhatsApp non raggiungibile: ${err instanceof Error ? err.message : 'errore di rete'}.` };
  }
}

/**
 * Messaggio da template approvato su Meta: l'unica forma che WhatsApp recapita sempre, anche
 * fuori dalla finestra di 24 ore.
 */
export async function inviaTemplateWhatsapp(
  cred: CredenzialiWhatsapp,
  numero: string,
  nomeTemplate: string,
  lingua = 'it',
  parametri: string[] = [],
): Promise<EsitoWhatsapp> {
  if (!whatsappConfigurato(cred)) {
    return { ok: false, errore: 'WhatsApp non è configurato nelle impostazioni dello studio (Phone ID e access token).' };
  }
  const destinatario = numeroPerGraph(numero);
  if (!destinatario) {
    return { ok: false, errore: 'Il numero di cellulare non è utilizzabile: servono almeno 8 cifre con il prefisso internazionale.' };
  }

  try {
    const esito = await chiamaGraphWhatsapp(cred, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: destinatario,
      type: 'template',
      template: {
        name: nomeTemplate,
        language: { code: lingua },
        ...(parametri.length > 0
          ? { components: [{ type: 'body', parameters: parametri.map(p => ({ type: 'text', text: p })) }] }
          : {}),
      },
    });
    if (esito.ok) return { ok: true };
    return { ok: false, errore: `Template «${nomeTemplate}» (${lingua}) rifiutato da Meta — ${esito.motivo}.` };
  } catch (err) {
    return { ok: false, errore: `WhatsApp non raggiungibile: ${err instanceof Error ? err.message : 'errore di rete'}.` };
  }
}
