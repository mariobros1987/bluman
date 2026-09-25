// Rotte del modulo KYC/AML §5.5 (Fase 5.5.1 — motore + stati). Il fascicolo di adeguata verifica
// è un processo INTERNO allo studio: il ruolo `cliente` non vi accede (come l'archivio §37). Il
// livello di verifica lo decide il motore puro `kycEngine`, non l'operatore.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { calcolaRischioKyc, calcolaScadenzaKyc, type LivelloVerificaKyc } from '../domain/kycEngine.js';
import { transizioneKyc } from '../services/kycCaseService.js';
import { registraComplianceEvent } from '../services/complianceEventLog.js';
import { moduloKycAttivo } from '../util/guardiaModuli.js';
import { calcolaTitolariEffettivi, scadenzaVariazioneTe } from '../domain/catenaControllo.js';
import { livelloComplessivo, prossimaRevisione, type LivelloRischioK3 } from '../domain/calcoloRischio.js';
import { screeningBloccaApprovazione, motivoBloccoScreening } from '../domain/screeningKyc.js';
import { uploadDocumento, rifirmaUrlUpload } from '../services/storageService.js';
import { createHash } from 'node:crypto';
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
  // Modulo Compliance/KYC spento per lo studio → 403 (attivazione modulo per-studio).
  const moduloSpento = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (!(await moduloKycAttivo(req.tenantId))) {
      reply.code(403).send({ errore: 'Il modulo Compliance/KYC non è attivo per questo studio.' });
      return true;
    }
    return false;
  };

  // Fascicolo corrente + storico + documenti + override di un cliente.
  server.get<{ Params: { clienteId: string } }>('/clienti/:clienteId/kyc', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
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
    if (await moduloSpento(req, reply)) return;
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
      if (await moduloSpento(req, reply)) return;
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

      // §8.4 — leggo gli screening solo quando si approva (come il gate MLRO legge le settings):
      // un match non risolto blocca l'approvazione, con motivo esplicito (regola 12).
      const screenings = stato === 'approvato'
        ? await prisma.screeningKyc.findMany({
            where: { fascicoloId: id, tenantId },
            select: { tipo: true, esito: true, dataScreening: true, createdAt: true },
          })
        : [];
      const screeningBloccante = screeningBloccaApprovazione(screenings);

      const esito = await transizioneKyc(prisma, {
        tenantId, fascicoloId: id, nuovoStato: stato,
        attoreUserId: req.userId, motivazione, puoApprovareRafforzata, screeningBloccante, campiApprovazione,
      });

      if (esito.esito === 'non_trovato') return reply.code(404).send({ errore: 'Fascicolo non trovato' });
      if (esito.esito === 'stato_ignoto') return reply.code(400).send({ errore: `Stato non riconosciuto: ${esito.valore}` });
      if (esito.esito === 'transizione_non_valida') return reply.code(409).send({ errore: `Transizione non ammessa: ${esito.da} → ${esito.a}` });
      if (esito.esito === 'serve_mlro') return reply.code(403).send({ errore: 'Approvazione di una pratica ad alto rischio riservata all’MLRO o a un ruolo superiore.' });
      if (esito.esito === 'screening_bloccante') return reply.code(409).send({ errore: motivoBloccoScreening(screenings) });

      await recordAudit({
        tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_STATO_AGGIORNATO',
        entita: `Fascicolo ${id}`,
        dettagli: `${fascicolo.stato} -> ${stato}${motivazione ? ` (${motivazione})` : ''}`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, fascicolo: esito.fascicolo });
    },
  );

  // Sblocco motivato (§8, OverrideKyc): l'admin dello studio forza l'operatività a valle nonostante
  // il KYC non approvato, lasciando una motivazione. Vale GIORNI_VALIDITA_OVERRIDE giorni (kycGate).
  server.post<{ Params: { id: string }; Body: { motivazione?: string; azioneSbloccata?: string } }>(
    '/kyc/:id/override',
    async (req, reply) => {
      if (vietatoAlCliente(req, reply)) return;
      if (await moduloSpento(req, reply)) return;
      if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
        return reply.code(403).send({ errore: 'Lo sblocco motivato è riservato al responsabile dello studio.' });
      }
      const { id } = req.params;
      const motivazione = (req.body?.motivazione || '').trim();
      if (motivazione.length < 10) {
        return reply.code(400).send({ errore: 'La motivazione dello sblocco è obbligatoria (almeno 10 caratteri).' });
      }
      const fascicolo = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId: req.tenantId }, select: { id: true } });
      if (!fascicolo) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
      const azioneSbloccata = (req.body?.azioneSbloccata || 'operativita').slice(0, 60);
      await prisma.overrideKyc.create({
        data: { tenantId: req.tenantId, fascicoloId: id, attoreUserId: req.userId ?? 'sistema', azioneSbloccata, motivazione },
      });
      await registraComplianceEvent(prisma, {
        tenantId: req.tenantId, tipo: 'KYC_OVERRIDE', attoreUserId: req.userId ?? null,
        payload: { fascicoloId: id, azioneSbloccata },
      });
      await recordAudit({
        tenantId: req.tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_OVERRIDE',
        entita: `Fascicolo ${id}`, dettagli: `Sblocco ${azioneSbloccata}: ${motivazione}`, ipAddress: req.ip,
      });
      return reply.send({ ok: true });
    },
  );

  // ── K2 — titolare effettivo, catena di controllo, deposito al registro ──────────────
  server.get<{ Params: { id: string } }>('/kyc/:id/titolare-effettivo', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true, soggettoId: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const [titolari, legami, deposito, settings] = await Promise.all([
      prisma.titolareEffettivo.findMany({ where: { tenantId, fascicoloId: id }, include: { soggetto: true } }),
      prisma.legameControllo.findMany({ where: { tenantId, fascicoloId: id } }),
      prisma.depositoRegistroTe.findFirst({ where: { tenantId, fascicoloId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.tenantComplianceSettings.findUnique({ where: { tenantId }, select: { sogliaTitolareEffettivo: true } }),
    ]);
    const soglia = settings?.sogliaTitolareEffettivo ?? 25;
    const catena = fasc.soggettoId
      ? calcolaTitolariEffettivi(legami.map((l) => ({ daId: l.daId, aId: l.aId, percentuale: l.percentuale == null ? null : Number(l.percentuale) })), fasc.soggettoId, soglia)
      : [];
    return reply.send({ titolari, legami, deposito, catena, soglia });
  });

  server.post<{ Params: { id: string }; Body: Record<string, any> }>('/kyc/:id/titolare-effettivo', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId; const b = req.body || {};
    if (!b.denominazione || String(b.denominazione).trim().length < 2) return reply.code(400).send({ errore: 'Denominazione del titolare effettivo obbligatoria.' });
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const soggetto = await prisma.soggettoKyc.create({
      data: { tenantId, tipo: b.tipo === 'persona_giuridica' ? 'persona_giuridica' : 'persona_fisica', denominazione: String(b.denominazione).slice(0, 200), codiceFiscale: b.codiceFiscale || null, paeseResidenza: b.paeseResidenza || null },
    });
    const te = await prisma.titolareEffettivo.create({
      data: { tenantId, fascicoloId: id, soggettoId: soggetto.id, criterio: ['proprieta', 'controllo', 'altro'].includes(b.criterio) ? b.criterio : 'proprieta', percentuale: b.percentuale != null && Number.isFinite(Number(b.percentuale)) ? Number(b.percentuale) : null, fonte: b.fonte === 'registro_camerale' ? 'registro_camerale' : 'autodichiarazione', note: b.note || null },
      include: { soggetto: true },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_TE_AGGIUNTO', attoreUserId: req.userId ?? null, payload: { fascicoloId: id, soggettoId: soggetto.id, criterio: te.criterio } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_TE_AGGIUNTO', entita: `Fascicolo ${id}`, dettagli: `TE ${soggetto.denominazione} (${te.criterio})`, ipAddress: req.ip });
    return reply.send({ ok: true, titolare: te });
  });

  // K2_ROUTES_PLACEHOLDER

  server.post<{ Params: { id: string }; Body: { daId?: string; aId?: string; percentuale?: number; note?: string } }>('/kyc/:id/legame-controllo', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId; const b = req.body || {};
    if (!b.daId || !b.aId) return reply.code(400).send({ errore: 'daId e aId (soggetti) sono obbligatori.' });
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const legame = await prisma.legameControllo.create({
      data: { tenantId, fascicoloId: id, daId: b.daId, aId: b.aId, percentuale: b.percentuale != null && Number.isFinite(Number(b.percentuale)) ? Number(b.percentuale) : null, note: b.note || null },
    });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_LEGAME_AGGIUNTO', entita: `Fascicolo ${id}`, dettagli: `${b.daId} → ${b.aId}`, ipAddress: req.ip });
    return reply.send({ ok: true, legame });
  });

  server.put<{ Params: { id: string }; Body: Record<string, any> }>('/kyc/:id/deposito-registro', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId; const b = req.body || {};
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    // §5.2 — se lo studio segnala una variazione, la scadenza del deposito è a 14 giorni.
    const scadenza = b.dataVariazione ? scadenzaVariazioneTe(new Date(b.dataVariazione)) : (b.scadenza ? new Date(b.scadenza) : null);
    const dati = {
      stato: ['da_depositare', 'depositato', 'in_ritardo'].includes(b.stato) ? b.stato : 'da_depositare',
      dataDeposito: b.dataDeposito ? new Date(b.dataDeposito) : null,
      scadenza,
      riferimento: b.riferimento || null,
      note: b.note || null,
    };
    const esistente = await prisma.depositoRegistroTe.findFirst({ where: { tenantId, fascicoloId: id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    const deposito = esistente
      ? await prisma.depositoRegistroTe.update({ where: { id: esistente.id }, data: dati })
      : await prisma.depositoRegistroTe.create({ data: { tenantId, fascicoloId: id, ...dati } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_DEPOSITO_TE', entita: `Fascicolo ${id}`, dettagli: `stato ${dati.stato}${scadenza ? `, scad ${scadenza.toISOString().slice(0, 10)}` : ''}`, ipAddress: req.ip });
    return reply.send({ ok: true, deposito });
  });

  // ── K3 — valutazione del rischio a 4 pilastri (spec §6) ─────────────────────────────
  server.get<{ Params: { id: string } }>('/kyc/:id/rischio', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const valutazioni = await prisma.riskAssessment.findMany({ where: { tenantId, fascicoloId: id }, orderBy: { versione: 'desc' } });
    return reply.send({ corrente: valutazioni[0] ?? null, storico: valutazioni });
  });

  server.post<{ Params: { id: string }; Body: Record<string, any> }>('/kyc/:id/rischio', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId; const b = req.body || {};
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const liv = (v: unknown): LivelloRischioK3 => (v === 'medio' || v === 'alto' ? v : 'basso');
    const pilastri = { cliente: liv(b.clienteLivello), geografia: liv(b.geografiaLivello), prodotto: liv(b.prodottoLivello), canale: liv(b.canaleLivello) };
    const complessivo = livelloComplessivo(pilastri);
    const ultima = await prisma.riskAssessment.findFirst({ where: { tenantId, fascicoloId: id }, orderBy: { versione: 'desc' }, select: { versione: true } });
    const ora = new Date();
    const assessment = await prisma.riskAssessment.create({
      data: {
        tenantId, fascicoloId: id,
        clienteLivello: pilastri.cliente, clienteMotivazione: b.clienteMotivazione || null,
        geografiaLivello: pilastri.geografia, geografiaMotivazione: b.geografiaMotivazione || null,
        prodottoLivello: pilastri.prodotto, prodottoMotivazione: b.prodottoMotivazione || null,
        canaleLivello: pilastri.canale, canaleMotivazione: b.canaleMotivazione || null,
        livelloComplessivo: complessivo, motivazioneComplessiva: b.motivazioneComplessiva || null,
        versione: (ultima?.versione ?? 0) + 1, prossimaRevisione: prossimaRevisione(ora, complessivo),
        attoreUserId: req.userId ?? null,
      },
    });
    // Riflette il rischio sul fascicolo: rischio alto → verifica rafforzata (scelta del titolare, §8.3).
    await prisma.fascicoloKyc.update({
      where: { id },
      data: { rischioCalcolato: complessivo, ...(complessivo === 'alto' ? { livelloVerifica: 'rafforzata' } : {}) },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_RISCHIO_VALUTATO', attoreUserId: req.userId ?? null, payload: { fascicoloId: id, complessivo, versione: assessment.versione } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_RISCHIO_VALUTATO', entita: `Fascicolo ${id}`, dettagli: `Rischio ${complessivo} (v${assessment.versione})`, ipAddress: req.ip });
    return reply.send({ ok: true, assessment, complessivo });
  });

  // ── K6 — documenti d'identità del soggetto KYC (upload sicuro, cifrato/firmato in storage) ──
  server.get<{ Params: { soggettoId: string } }>('/kyc/soggetto/:soggettoId/documenti', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { soggettoId } = req.params; const tenantId = req.tenantId;
    const sog = await prisma.soggettoKyc.findFirst({ where: { id: soggettoId, tenantId }, select: { id: true } });
    if (!sog) return reply.code(404).send({ errore: 'Soggetto non trovato' });
    const documenti = await prisma.documentoIdentita.findMany({ where: { tenantId, soggettoId }, orderBy: { createdAt: 'desc' } });
    return reply.send({ documenti: documenti.map((d) => ({ ...d, urlStorage: rifirmaUrlUpload(d.urlStorage) })) });
  });

  server.post<{ Params: { soggettoId: string }; Body: Record<string, any> }>('/kyc/soggetto/:soggettoId/documento', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { soggettoId } = req.params; const tenantId = req.tenantId; const b = req.body || {};
    const sog = await prisma.soggettoKyc.findFirst({ where: { id: soggettoId, tenantId }, select: { id: true } });
    if (!sog) return reply.code(404).send({ errore: 'Soggetto non trovato' });
    if (!b.contentBase64 || !b.filename) return reply.code(400).send({ errore: 'File (contentBase64) e nome file obbligatori.' });
    let url: string;
    try {
      const res = await uploadDocumento(String(b.filename), String(b.contentBase64), tenantId);
      if (!res.ok || !res.url) return reply.code(400).send({ errore: 'Upload non riuscito.' });
      url = res.url;
    } catch (e: any) {
      return reply.code(400).send({ errore: e?.message || 'File non ammesso.' });
    }
    const hash = createHash('sha256').update(Buffer.from(String(b.contentBase64), 'base64')).digest('hex');
    const doc = await prisma.documentoIdentita.create({
      data: {
        tenantId, soggettoId,
        tipo: ['carta_identita', 'passaporto', 'permesso_soggiorno', 'altro'].includes(b.tipo) ? b.tipo : 'altro',
        numero: b.numero || null, emittente: b.emittente || null,
        scadenza: b.scadenza ? new Date(b.scadenza) : null,
        urlStorage: url, hashSha256: hash, esitoVerifica: null,
      },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_DOCUMENTO_CARICATO', attoreUserId: req.userId ?? null, payload: { soggettoId, tipo: doc.tipo, hash } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_DOCUMENTO_CARICATO', entita: `Soggetto ${soggettoId}`, dettagli: `Documento ${doc.tipo}`, ipAddress: req.ip });
    return reply.send({ ok: true, documento: { ...doc, urlStorage: rifirmaUrlUpload(doc.urlStorage) } });
  });
}