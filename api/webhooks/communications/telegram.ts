// Vercel Serverless Function per il Webhook Telegram Bot
export default async function handler(req: any, res: any) {
  if (req.method === 'POST') {
    try {
      const update = req.body || {};
      
      // Inoltra l'evento al backend Railway in produzione
      const railwayRes = await fetch('https://bluman-api-production.up.railway.app/webhooks/communications/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      console.log('[Telegram Webhook Vercel] Inoltrato a Railway, status:', railwayRes.status);
    } catch (err) {
      console.warn('[Telegram Webhook Vercel] Errore inoltro a Railway:', err);
    }

    // Telegram richiede sempre una risposta 200 OK per confermare la ricezione
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Telegram Webhook Live', timestamp: new Date().toISOString() });
  }

  return res.status(405).send('Method Not Allowed');
}
