// Vercel Serverless Function per il dispatch sicuro e senza CORS verso Meta WhatsApp Cloud API
export default async function handler(req: any, res: any) {
  // Abilita CORS per il frontend BluMan
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ errore: 'Metodo non consentito' });
  }

  try {
    const { to, text, templateName, phoneId, token } = req.body || {};

    // Nessun ripiego cablato. Qui c'erano il Phone ID del numero WhatsApp Business dello
    // studio e un access token Meta valido, scritti in chiaro nel repository: chiunque li
    // leggesse su GitHub poteva spedire messaggi a nome dello studio. C'era anche un numero
    // di destinatario reale come ripiego, cioè un messaggio spedito a una persona vera per
    // una richiesta senza destinatario. Regola 6 di `.agents/AGENTS.md`.
    const activePhoneId = phoneId || process.env.WA_PHONE_ID;
    const activeToken = token || process.env.WHATSAPP_ACCESS_TOKEN;

    if (!activePhoneId || !activeToken) {
      return res.status(400).json({
        errore:
          'WhatsApp non configurato: mancano Phone ID e access token, sia nella richiesta ' +
          'sia nelle variabili WA_PHONE_ID/WHATSAPP_ACCESS_TOKEN della funzione.',
      });
    }

    if (!to) {
      return res.status(400).json({ errore: 'Destinatario mancante: indica il numero in `to`.' });
    }

    const cleanTo = to.toString().replace(/\D/g, '');

    // 1. Tenta prima l'invio come Template (100% garantito da Meta) o come testo
    let payload: any;
    if (templateName) {
      payload = {
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en_US' },
        },
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'text',
        text: { preview_url: false, body: text || 'Messaggio da BluMan Advisory' },
      };
    }

    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${activePhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const metaJson: any = await metaRes.json();

    // Se il messaggio libero fallisce (es. sessione 24h chiusa), fallback su template hello_world
    if (!metaRes.ok && metaJson?.error?.code === 131047) {
      const fallbackRes = await fetch(`https://graph.facebook.com/v21.0/${activePhoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanTo,
          type: 'template',
          template: { name: 'hello_world', language: { code: 'en_US' } },
        }),
      });
      const fallbackJson = await fallbackRes.json();
      return res.status(200).json({ success: true, mode: 'template_fallback', data: fallbackJson });
    }

    if (!metaRes.ok) {
      return res.status(metaRes.status).json({ success: false, error: metaJson });
    }

    return res.status(200).json({ success: true, data: metaJson });
  } catch (err: any) {
    return res.status(500).json({ success: false, errore: err.message || 'Errore serverless Meta dispatch' });
  }
}
