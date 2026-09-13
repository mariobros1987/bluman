// Integrazione Sentry per il backend (voce 6.2 del PIANO_DI_MIGLIORAMENTO).
//
// Opt-in per costruzione: senza SENTRY_DSN l'import stesso non fa niente di più di
// un no-op — zero chiamate di rete, zero inizializzazioni, la suite di test e lo
// sviluppo locale non sanno che esiste. Con il DSN impostato (Railway → Variables),
// ogni errore non gestito e ogni 500 dell'error handler arrivano anche sul dashboard
// Sentry, con tenant e utente della richiesta già allegati dal serializzatore del
// logger.
//
// La privacy è deliberata: si inviano solo l'errore e i metadati della richiesta
// (metodo, URL di rotta, tenant, userId, ruolo). Nessun body, nessuna query string,
// nessun header — i dati dei clienti dello studio non lasciano l'infrastruttura per
// finire su un servizio di terze parti.

import type { FastifyInstance } from 'fastify';

export async function registraSentry(server: FastifyInstance): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // Non configurato: nessun costo, nessuna chiamata.

  const Sentry = await import('@sentry/node');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Solo errori: le performance monitoring sono un'altra discussione (volume,
    // costo, PII nelle transazioni) e non servono per il primo rollout.
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });

  server.addHook('onError', async (req, reply, err) => {
    Sentry.captureException(err, {
      level: 'error',
      // I tag navigabili sul dashboard: chi era, per quale studio, su quale rotta.
      tags: {
        metodo: req.method,
        rotta: req.routeOptions?.url ?? req.url.split('?')[0],
        tenant: req.tenantId ?? 'n/d',
        ruolo: req.ruolo ?? 'anonimo',
      },
    });
  });

  console.log('[Sentry] Error tracking attivo (SENTRY_DSN configurato).');
}
