import type { FastifyInstance } from 'fastify';
import { generaFascicoloFiscaleZip } from '../services/fascicoloFiscaleZipEngine.js';

export async function registraRotteFascicoloFiscale(server: FastifyInstance) {
  // GET /contabilita/export-fascicolo-commercialista
  server.get<{
    Querystring: {
      anno?: string;
      tipo?: 'mensile' | 'trimestrale' | 'annuale';
      mese?: string;
      trimestre?: string;
    };
  }>('/contabilita/export-fascicolo-commercialista', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const anno = req.query.anno ? parseInt(req.query.anno, 10) : new Date().getFullYear();
    const tipo = req.query.tipo || 'mensile';
    const mese = req.query.mese ? parseInt(req.query.mese, 10) : undefined;
    const trimestre = req.query.trimestre ? parseInt(req.query.trimestre, 10) : undefined;

    console.log(`[EXPORT FASCICOLO] Richiesta export ZIP commercialista (tenant: ${tenantId}, anno: ${anno}, tipo: ${tipo})`);

    try {
      const risultato = await generaFascicoloFiscaleZip({
        tenantId,
        anno,
        tipo,
        mese,
        trimestre,
      });

      console.log(`[EXPORT FASCICOLO SUCCESS] Generato ZIP ${risultato.nomeFile} (${risultato.buffer.length} bytes, attive: ${risultato.conteggioFattureAttive}, passive: ${risultato.conteggioFatturePassive})`);

      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${risultato.nomeFile}"`);
      reply.header('Content-Length', risultato.buffer.length);
      return reply.send(risultato.buffer);
    } catch (err: any) {
      console.error('[EXPORT FASCICOLO ERROR]', err);
      return reply.code(500).send({ errore: err?.message || 'Errore generazione fascicolo fiscale ZIP' });
    }
  });

  // GET /contabilita/anteprima-fascicolo-commercialista (restituisce i conteggi e il riepilogo prima del download)
  server.get<{
    Querystring: {
      anno?: string;
      tipo?: 'mensile' | 'trimestrale' | 'annuale';
      mese?: string;
      trimestre?: string;
    };
  }>('/contabilita/anteprima-fascicolo-commercialista', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const anno = req.query.anno ? parseInt(req.query.anno, 10) : new Date().getFullYear();
    const tipo = req.query.tipo || 'mensile';
    const mese = req.query.mese ? parseInt(req.query.mese, 10) : undefined;
    const trimestre = req.query.trimestre ? parseInt(req.query.trimestre, 10) : undefined;

    try {
      const risultato = await generaFascicoloFiscaleZip({
        tenantId,
        anno,
        tipo,
        mese,
        trimestre,
      });

      // Escludi il buffer per non appesantire la risposta JSON di anteprima
      const { buffer: _buf, ...datiAnteprima } = risultato;
      return reply.send(datiAnteprima);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore recupero anteprima fascicolo' });
    }
  });
}
