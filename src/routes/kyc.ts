// Rotte del modulo KYC/AML §5.5 (Fase 5.5.1 — motore + stati). Il fascicolo di adeguata verifica
// è un processo INTERNO allo studio: il ruolo `cliente` non vi accede (come l'archivio §37). Il
// livello di verifica lo decide il motore puro `kycEngine`, non l'operatore.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { calcolaRischioKyc, calcolaScadenzaKyc, type LivelloVerificaKyc } from '../domain/kycEngine.js';
import { transizioneKyc } from '../services/kycCaseService.js';
import { registraComplianceEvent } from '../services/complianceEventLog.js';
import { recordAudit } from '../util/serverHelpers.js';

// Soglia di default per la verifica rafforzata: €15.000 (D.Lgs. 231/2007, operazioni occasionali).
// Configurabile per tenant in una fase successiva; qui è la base.
const SOGLIA_KYC_DEFAULT_CENT = 1_500_000;

export async function registraRotteKyc(server: FastifyInstance): Promise<void> {
  const vietatoAlCliente = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.ruolo === 'cliente') {
      reply.code(403).send({ errore: 'Il fascicolo KYC è riservato allo studio.' });
      return true;
    }
    return false;
  };

  // Fascicolo corrente + storico + documenti + override di un cliente.
  server.get<{ Params: { clienteId: string } }>('/clienti/:clienteId/kyc', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    const fascicolo = await prisma.fascicoloKyc.findFirst({
      where: { tenantId: req.tenantId, clienteId: req.params.clienteId },
      orderBy: { createdAt: 'desc' },
      include: { storico: { orderBy: { createdAt: 'desc' } }, documenti: true, overrideLog: true },
    });
    return reply.send({ fascicolo });
  });

  // Crea/rinnova un fascicolo calcolando livello, rischio e scadenza dal motore puro.
  server.post<{
    Params: { clienteId: string };
    Body: {
      tipoCliente?: string; pep?: boolean; paeseResidenza?: string; paesiAltoRischio?: string[];
      valoreOperazioneCent?: number; sogliaOperazioneCent?: number;
      senzaPresenzaFisica?: boolean; identificatoConSpidOCie?: boolean;
    };
  }>('/clienti/:clienteId/kyc', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    const tenantId = req.tenantId;
    const { clienteId } = req.params;
    const b = req.body || {};
    const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, tenantId }, select: { id: true, tipo: true } });
    if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato' });

    const esito = calcolaRischioKyc({
      tipoCliente: b.tipoCliente ?? cliente.tipo,
      pep: b.pep,
      paeseResidenza: b.paeseResidenza,
      paesiAltoRischio: b.paesiAltoRischio ?? [],
      valoreOperazioneCent: b.valoreOperazioneCent,
      sogliaOperazioneCent: b.sogliaOperazioneCent ?? SOGLIA_KYC_DEFAULT_CENT,
      senzaPresenzaFisica: b.senzaPresenzaFisica,
      identificatoConSpidOCie: b.identificatoConSpidOCie,
    });

    const fascicolo = await prisma.fascicoloKyc.create({
      data: {
        tenantId,
        clienteId,
        stato: 'in_raccolta',
        livelloVerifica: esito.livelloVerifica,
        rischioCalcolato: esito.rischioCalcolato,
        punteggioRischio: esito.punteggioRischio,
        pep: b.pep ?? false,
        paeseResidenza: b.paeseResidenza ?? null,
        storico: {
          create: {
            tenantId,
            statoNuovo: 'in_raccolta',
            attoreUserId: req.userId ?? 'sistema',
            motivazione: `Creato dal motore: ${esito.livelloVerifica} — ${esito.motivazioni.join('; ')}`,
          },
        },
      },
      include: { storico: true },
    });
    // Apertura pratica: primo anello della catena di compliance (spec §8.10).
    await registraComplianceEvent(prisma, {
      tenantId,
      tipo: 'KYC_PRATICA_APERTA',
      attoreUserId: req.userId ?? null,
      payload: { fascicoloId: fascicolo.id, clienteId, livelloVerifica: esito.livelloVerifica, rischio: esito.rischioCalcolato },
    });
    await recordAudit({
      tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_FASCICOLO_CREATO',
      entita: `Cliente ${clienteId}`,
      dettagli: `Livello ${esito.livelloVerifica}, rischio ${esito.rischioCalcolato} (punteggio ${esito.punteggioRischio})`,
      ipAddress: req.ip,
    });
    return reply.send({ ok: true, fascicolo, esito });
  });

  // Transizione di stato (spec v0.2 §8): la macchina a stati valida il passo, il gate MLRO copre il
  // rischio alto, e ogni cambio scrive storico + ComplianceEvent (via il service).
  const STATI_V02 = ['bozza', 'in_raccolta', 'in_verifica', 'in_attesa_approvazione', 'approvato', 'respinto', 'sospeso', 'in_revisione', 'chiuso'];
  server.patch<{ Params: { id: string }; Body: { stato: string; motivazione?: string } }>(
    '/kyc/:id/stato',
    async (req, reply) => {
      if (vietatoAlCliente(req, reply)) return;
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { stato, motivazione } = req.body || {};
      if (!STATI_V02.includes(stato)) return reply.code(400).send({ errore: 'Stato non valido' });

      const fascicolo = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId } });
      if (!fascicolo) return reply.code(404).send({ errore: 'Fascicolo non trovato' });

      // Gate MLRO (§8.3): advisor/super_admin, oppure l'utente nominato MLRO nel tenant (K0).
      const settings = await prisma.tenantComplianceSettings.findUnique({ where: { tenantId }, select: { mlroUserId: true } });
      const puoApprovareRafforzata = req.ruolo === 'advisor' || req.ruolo === 'super_admin'
        || (!!req.userId && req.userId === settings?.mlroUserId);

      const ora = new Date();
      const campiApprovazione = {
        dataVerifica: ora,
        dataScadenza: calcolaScadenzaKyc(fascicolo.livelloVerifica as LivelloVerificaKyc, ora),
        approvatoDa: req.userId ?? null,
        approvatoIl: ora,
      };

      const esito = await transizioneKyc(prisma, {
        tenantId, fascicoloId: id, nuovoStato: stato,
        attoreUserId: req.userId, motivazione, puoApprovareRafforzata, campiApprovazione,
      });

      if (esito.esito === 'non_trovato') return reply.code(404).send({ errore: 'Fascicolo non trovato' });
      if (esito.esito === 'stato_ignoto') return reply.code(400).send({ errore: `Stato non riconosciuto: ${esito.valore}` });
      if (esito.esito === 'transizione_non_valida') return reply.code(409).send({ errore: `Transizione non ammessa: ${esito.da} → ${esito.a}` });
      if (esito.esito === 'serve_mlro') return reply.code(403).send({ errore: 'Approvazione di una pratica ad alto rischio riservata all’MLRO o a un ruolo superiore.' });

      await recordAudit({
        tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_STATO_AGGIORNATO',
        entita: `Fascicolo ${id}`,
        dettagli: `${fascicolo.stato} -> ${stato}${motivazione ? ` (${motivazione})` : ''}`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, fascicolo: esito.fascicolo });
    },
  );
}
