// L'aiuto in-app: le schede di `docs/manuale/` servite all'app.
//
// Due cose di questa rotta sono obbligate e non si vedono leggendola.
//
// **1. La risposta è JSON, mai `text/html`.** `frontend/src/api/http.ts` — `apiFetch` **lancia** se
// il `content-type` della risposta contiene `text/html`, perché nell'architettura dell'app quel
// content-type significa una cosa sola: la richiesta non ha raggiunto il backend (è il rewrite di
// `vercel.json` che risponde così a qualunque percorso). Quindi l'HTML di una scheda viaggia come
// **stringa dentro un oggetto JSON**. Non è una preferenza: una rotta che rispondesse HTML
// indebolirebbe la premessa di quella guardia, che è nata da un guasto vero, e il prossimo
// «Unexpected token <» non avrebbe più un test che lo spiega.
//
// **2. I percorsi sono `/manuale`, non `/aiuto`.** `/aiuto` è la **pagina** del frontend. Sul VPS
// nginx toglie il prefisso `/api`, quindi i due nomi non collidono — ma la §19 di questo stesso
// manuale racconta quanto è costato scoprire che «una pagina e una rotta con lo stesso percorso» è
// un guasto che si paga caro (`infrastrutturaDeploy.test.ts` lo presidia). Tenere i due nomi
// distinti costa zero e toglie la domanda.
//
// Il filtro per ruolo sta **qui**, non nel frontend: un indice che pubblicizza una scheda che poi
// non si apre è una promessa che la pagina non può mantenere, e il `testo` di una scheda riservata
// non deve viaggiare affatto.

import type { FastifyInstance } from 'fastify';
import { htmlScheda, indiceManuale } from '../domain/manuale.js';

/** Il ruolo che vede anche le schede riservate. Vedi `SCHEDE_RISERVATE` in `domain/manuale.ts`. */
function ruoloDi(req: { ruolo?: unknown }): string {
  return typeof req.ruolo === 'string' ? req.ruolo : '';
}

export async function registraRotteManuale(server: FastifyInstance): Promise<void> {
  /**
   * L'indice delle schede, filtrato per ruolo, con il testo su cui la ricerca dell'app cerca.
   *
   * Il testo viaggia con l'indice di proposito: sono ~110 KB in una richiesta sola, e la ricerca
   * filtrando in locale risponde mentre si scrive. La ricerca **non** interroga il server a ogni
   * tasto — sarebbe un ciclo di richieste per una funzione che deve essere istantanea.
   */
  server.get('/manuale', async (req) => {
    const indice = await indiceManuale(ruoloDi(req));
    // `letto: false` non è un indice vuoto: è «non ho potuto guardare». Il frontend le distingue
    // perché dicono due cose opposte — «l'aiuto non è disponibile in questa installazione» contro
    // «non c'è niente da leggere» — e la seconda sarebbe una bugia detta dall'app.
    return indice;
  });

  /**
   * Una scheda, in HTML già sanitizzato.
   *
   * I quattro esiti dell'esito diventano quattro codici diversi, e la distinzione è il motivo per
   * cui `htmlScheda` non restituisce un booleano: **403** «esiste ma non ti è permessa», **404**
   * «non esiste» (o slug malformato), **503** «esiste e non si è potuta leggere». Collassare le
   * ultime due direbbe che il manuale non ha quella scheda mentre il guasto è dell'installazione, e
   * chi indaga guarderebbe nel posto sbagliato.
   */
  server.get<{ Params: { slug: string } }>('/manuale/:slug', async (req, reply) => {
    const esito = await htmlScheda(req.params.slug, ruoloDi(req));
    switch (esito.esito) {
      case 'ok':
        return {
          letto: true,
          slug: esito.scheda.slug,
          numero: esito.scheda.numero,
          titolo: esito.scheda.titolo,
          riservata: esito.scheda.riservata,
          html: esito.html,
        };
      case 'riservata':
        // Il messaggio **nomina la scheda**: un 403 che dice solo «non autorizzato» manda a
        // cercare un permesso mancante, mentre qui la risposta è che quella scheda è il manuale
        // dell'operatore della piattaforma e non dello studio.
        return reply.code(403).send({
          errore: `La scheda «${req.params.slug}» è riservata all'amministratore della piattaforma.`,
        });
      case 'assente':
        return reply.code(404).send({ errore: `Scheda «${req.params.slug}» non trovata nel manuale.` });
      case 'non-leggibile':
        return reply.code(503).send({
          errore: 'Il manuale non è leggibile in questa installazione: i file delle schede non si aprono.',
        });
    }
  });
}
