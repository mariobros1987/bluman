import type { FastifyInstance } from 'fastify';
import {
  calcolaAnteprimaFascicoloFiscale,
  generaFascicoloFiscaleZip,
  type ParametriFascicoloFiscale,
} from '../services/fascicoloFiscaleZipEngine.js';

interface QuerystringFascicolo {
  anno?: string;
  tipo?: string;
  mese?: string;
  trimestre?: string;
}

/**
 * Validazione dei parametri di periodo.
 *
 * `parseInt('pippo', 10)` è `NaN`, e `NaN` arrivava fino a `new Date(Date.UTC(NaN, …))`:
 * una Invalid Date il cui `toISOString()` solleva RangeError, quindi 500 «Errore
 * generazione fascicolo» per un errore che è del chiamante. Anche `tipo` va validato qui e
 * non fidandosi del tipo TypeScript: quello descrive cosa ci aspettiamo, non cosa arriva
 * sul socket — `?tipo=qualsiasi_cosa` finiva nel ramo `else`, cioè esportava l'anno intero
 * senza dirlo a nessuno.
 */
function validaParametri(query: QuerystringFascicolo): { ok: true; parametri: Omit<ParametriFascicoloFiscale, 'tenantId'> } | { ok: false; errore: string } {
  const annoCorrente = new Date().getFullYear();
  const anno = query.anno === undefined || query.anno === '' ? annoCorrente : Number(query.anno);
  if (!Number.isInteger(anno) || anno < 2000 || anno > annoCorrente + 1) {
    return { ok: false, errore: `Parametro «anno» non valido: atteso un intero fra 2000 e ${annoCorrente + 1}.` };
  }

  const tipo = query.tipo === undefined || query.tipo === '' ? 'mensile' : query.tipo;
  if (tipo !== 'mensile' && tipo !== 'trimestrale' && tipo !== 'annuale') {
    return { ok: false, errore: 'Parametro «tipo» non valido: atteso mensile, trimestrale o annuale.' };
  }

  let mese: number | undefined;
  if (tipo === 'mensile') {
    mese = query.mese === undefined || query.mese === '' ? new Date().getMonth() + 1 : Number(query.mese);
    if (!Number.isInteger(mese) || mese < 1 || mese > 12) {
      return { ok: false, errore: 'Parametro «mese» non valido: atteso un intero fra 1 e 12.' };
    }
  }

  let trimestre: number | undefined;
  if (tipo === 'trimestrale') {
    trimestre = query.trimestre === undefined || query.trimestre === ''
      ? Math.floor(new Date().getMonth() / 3) + 1
      : Number(query.trimestre);
    if (!Number.isInteger(trimestre) || trimestre < 1 || trimestre > 4) {
      return { ok: false, errore: 'Parametro «trimestre» non valido: atteso un intero fra 1 e 4.' };
    }
  }

  return { ok: true, parametri: { anno, tipo, mese, trimestre } };
}

export async function registraRotteFascicoloFiscale(server: FastifyInstance) {
  // GET /contabilita/export-fascicolo-commercialista
  // Il fascicolo è la contabilità completa dello studio: registri IVA, prospetto di
  // liquidazione, prima nota di banca e cassa. Un token con ruolo `cliente` non deve
  // poterlo scaricare — vedeva i dati di tutti gli altri clienti dello stesso studio.
  server.get<{ Querystring: QuerystringFascicolo }>('/contabilita/export-fascicolo-commercialista', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const validazione = validaParametri(req.query);
    if (!validazione.ok) return reply.code(400).send({ errore: validazione.errore });

    const tenantId = req.tenantId as string;
    const { anno, tipo, mese, trimestre } = validazione.parametri;
    server.log.info({ tenantId, anno, tipo, mese, trimestre }, 'export fascicolo commercialista richiesto');

    try {
      const risultato = await generaFascicoloFiscaleZip({ tenantId, anno, tipo, mese, trimestre });

      server.log.info(
        {
          nomeFile: risultato.nomeFile,
          bytes: risultato.buffer.length,
          attive: risultato.conteggioFattureAttive,
          passive: risultato.conteggioFatturePassive,
          xmlAttivi: risultato.conteggioXmlAttiviGenerati,
        },
        'export fascicolo commercialista completato',
      );

      reply.header('Content-Type', 'application/zip');
      // Il nome è già sanificato dal motore (solo [A-Za-z0-9_-] e `.zip`), quindi non può
      // iniettare virgolette o CRLF nell'header.
      reply.header('Content-Disposition', `attachment; filename="${risultato.nomeFile}"`);
      reply.header('Content-Length', risultato.buffer.length);
      return reply.send(risultato.buffer);
    } catch (err: any) {
      server.log.error({ err }, 'errore generazione fascicolo fiscale ZIP');
      return reply.code(500).send({ errore: 'Errore generazione fascicolo fiscale ZIP.' });
    }
  });

  // GET /contabilita/anteprima-fascicolo-commercialista — conteggi e riepilogo prima del
  // download. Non costruisce l'archivio: prima generava lo ZIP intero e scartava il buffer.
  server.get<{ Querystring: QuerystringFascicolo }>('/contabilita/anteprima-fascicolo-commercialista', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const validazione = validaParametri(req.query);
    if (!validazione.ok) return reply.code(400).send({ errore: validazione.errore });

    const tenantId = req.tenantId as string;
    const { anno, tipo, mese, trimestre } = validazione.parametri;

    try {
      const anteprima = await calcolaAnteprimaFascicoloFiscale({ tenantId, anno, tipo, mese, trimestre });
      return reply.send(anteprima);
    } catch (err: any) {
      server.log.error({ err }, 'errore anteprima fascicolo fiscale');
      return reply.code(500).send({ errore: 'Errore recupero anteprima fascicolo.' });
    }
  });
}
