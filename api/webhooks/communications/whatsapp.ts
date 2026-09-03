// Vercel Serverless Function per il Webhook WhatsApp Business di Meta
export default async function handler(req: any, res: any) {
  // 1. Handshake di verifica Meta (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    // Il token di verifica non ha un ripiego cablato: era scritto in chiaro nel repository,
    // e chi lo leggeva poteva superare l'handshake di Meta e registrare il proprio endpoint
    // come webhook dello studio. Senza la variabile d'ambiente l'handshake viene rifiutato.
    const verifyToken = process.env.WA_VERIFY_TOKEN;

    if (!verifyToken) {
      return res.status(503).send('WA_VERIFY_TOKEN non configurato');
    }

    if (mode === 'subscribe' && token === verifyToken) {
      // Meta richiede di restituire unicamente il valore di challenge con status 200
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // 2. Ricezione messaggi WhatsApp entranti (POST) e inoltro al backend di produzione
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      
      // Inoltra l'evento al backend Railway in produzione
      const railwayRes = await fetch('https://bluman-api-production.up.railway.app/webhooks/communications/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      console.log('[WhatsApp Webhook Vercel] Inoltrato a Railway, status:', railwayRes.status);
    } catch (err) {
      console.warn('[WhatsApp Webhook Vercel] Errore inoltro a Railway:', err);
    }

    return res.status(200).json({ status: 'EVENT_RECEIVED' });
  }

  return res.status(405).send('Method Not Allowed');
}
