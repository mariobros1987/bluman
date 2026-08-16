// Vercel Serverless Function per il Webhook WhatsApp Business di Meta
export default async function handler(req: any, res: any) {
  // 1. Handshake di verifica Meta (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = process.env.WA_VERIFY_TOKEN || 'bluman_wa_secure_token_2026';

    if (mode === 'subscribe' && token === verifyToken) {
      // Meta richiede di restituire unicamente il valore di challenge con status 200
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 2. Ricezione messaggi WhatsApp entranti (POST)
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        console.log(`[WhatsApp Webhook Vercel] Messaggio ricevuto da ${msg.from}:`, msg.text?.body);
      }
    } catch (err) {
      console.warn('[WhatsApp Webhook Vercel] Errore parsing:', err);
    }

    return res.status(200).json({ status: 'EVENT_RECEIVED' });
  }

  return res.status(405).send('Method Not Allowed');
}
