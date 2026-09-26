// KYC/AML Fase K0 (Malta, spec v0.2) — rotte delle impostazioni di compliance dello studio.
// Lettura riservata ai ruoli interni (mai `cliente`); scrittura solo advisor/super_admin.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { moduloKycAttivo } from '../util/guardiaModuli.js';
import { modalitaBozza, calcolaHashEvento, verificaCatena } from '../services/complianceService.js';
import { registraComplianceEvent } from '../services/complianceEventLog.js';
import { livelloComplessivo, prossimaRevisione, assessmentCompleto, type LivelloRischioK3 } from '../domain/calcoloRischio.js';

const PACCHETTI = ['MT', 'IT'];
const PROFILI = ['CSP_MFSA', 'ALTRO_SOGGETTO_OBBLIGATO'];
const LIVELLI_RISCHIO = ['basso', 'medio', 'alto'];

export async function registraRotteCompliance(server: FastifyInstance): Promise<void> {
  const vietatoAlCliente = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.ruolo === 'cliente') {
      reply.code(403).send({ errore: 'La compliance è riservata allo studio.' });
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

  server.get('/tenant/compliance-settings', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;
    let s = await prisma.tenantComplianceSettings.findUnique({ where: { tenantId } });
    if (!s) s = await prisma.tenantComplianceSettings.create({ data: { tenantId } });
    return reply.send({ settings: s, modalitaBozza: modalitaBozza(s) });
  });

  server.put<{ Body: Record<string, unknown> }>('/tenant/compliance-settings', async (req, reply) => {
    if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
      return reply.code(403).send({ errore: 'Le impostazioni di compliance sono riservate al responsabile dello studio.' });
    }
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;
    const b = (req.body || {}) as Record<string, any>;

    const dati: Record<string, any> = {};
    if (b.jurisdictionPack !== undefined) dati.jurisdictionPack = PACCHETTI.includes(b.jurisdictionPack) ? b.jurisdictionPack : 'MT';
    if (b.regulatoryProfile !== undefined) dati.regulatoryProfile = b.regulatoryProfile == null ? null : (PROFILI.includes(b.regulatoryProfile) ? b.regulatoryProfile : null);
    if (b.otherSubjectCategory !== undefined) dati.otherSubjectCategory = b.otherSubjectCategory ? String(b.otherSubjectCategory).slice(0, 200) : null;
    if (b.retentionYears !== undefined) dati.retentionYears = Number.isFinite(Number(b.retentionYears)) ? Math.max(1, Math.min(30, Math.round(Number(b.retentionYears)))) : 5;
    if (b.mlroUserId !== undefined) dati.mlroUserId = b.mlroUserId || null;
    if (b.reportingChannel !== undefined) dati.reportingChannel = String(b.reportingChannel || 'goAML').slice(0, 40);
    if (b.screeningProvider !== undefined) dati.screeningProvider = String(b.screeningProvider || 'MANUALE').slice(0, 60);
    if (b.featureFlags !== undefined && b.featureFlags && typeof b.featureFlags === 'object') dati.featureFlags = b.featureFlags;
    // K2 — configurazione titolare effettivo (regole per configurazione, §3.2).
    if (b.sogliaTitolareEffettivo !== undefined) dati.sogliaTitolareEffettivo = Number.isFinite(Number(b.sogliaTitolareEffettivo)) ? Math.max(0, Math.min(100, Math.round(Number(b.sogliaTitolareEffettivo)))) : 25;
    if (b.allarmeVariazioniTe !== undefined) dati.allarmeVariazioniTe = Boolean(b.allarmeVariazioniTe);
    if (b.gestioneRegistroTe !== undefined) dati.gestioneRegistroTe = Boolean(b.gestioneRegistroTe);

    // L'MLRO, se indicato, deve essere un utente dello studio (ruolo interno, non delegabile a terzi).
    if (dati.mlroUserId) {
      const u = await prisma.user.findFirst({ where: { id: dati.mlroUserId, tenantId }, select: { id: true } });
      if (!u) return reply.code(400).send({ errore: 'MLRO non valido: deve essere un utente dello studio.' });
    }

    const s = await prisma.tenantComplianceSettings.upsert({
      where: { tenantId },
      update: { ...dati, versione: { increment: 1 } },
      create: { tenantId, ...dati },
    });

    // Evento immutabile a catena hash (append-only). `createdAt` si persiste ESPLICITAMENTE
    // con lo stesso istante usato nel calcolo dell'hash: se lo lasciassimo al DEFAULT del DB,
    // la marca temporale memorizzata differirebbe di qualche ms da quella firmata e la verifica
    // della catena (GET /tenant/compliance-events) risulterebbe sempre rotta.
    const ultimo = await prisma.complianceEvent.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    const createdAt = new Date().toISOString();
    const hash = calcolaHashEvento({ tipo: 'COMPLIANCE_SETTINGS_AGGIORNATE', payload: dati, createdAt, hashPrecedente: ultimo?.hash ?? null });
    await prisma.complianceEvent.create({
      data: { tenantId, tipo: 'COMPLIANCE_SETTINGS_AGGIORNATE', attoreUserId: req.userId ?? null, payload: dati, hashPrecedente: ultimo?.hash ?? null, hash, createdAt: new Date(createdAt) },
    });

    return reply.send({ ok: true, settings: s, modalitaBozza: modalitaBozza(s) });
  });

  // Audit trail di compliance in sola lettura (spec §8). Riservato ai ruoli interni: gli eventi
  // raccontano le scelte regolatorie dello studio, non riguardano il cliente. Ordinati dal più
  // recente per la UI; la verifica della catena gira sull'ordine crescente e dice se e dove la
  // sequenza è stata manomessa.
  server.get('/tenant/compliance-events', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;
    const eventi = await prisma.complianceEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const catena = verificaCatena(
      eventi.map((e) => ({
        tipo: e.tipo,
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
        hashPrecedente: e.hashPrecedente ?? null,
        hash: e.hash,
      })),
    );
    // Alla UI il più recente in cima.
    return reply.send({ eventi: [...eventi].reverse(), catena });
  });

  // ── K9/§5.5 — valutazione del rischio dell'ATTIVITÀ (business risk assessment) ─────────────
  // Livello di studio, versionata e mai sovrascritta (§7). Worst-case sui quattro fattori (§6, come
  // K3). Lettura ai ruoli interni; scrittura al responsabile/MLRO. Ogni POST crea una nuova versione.
  server.get('/tenant/business-risk', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;
    const storico = await prisma.businessRiskAssessment.findMany({ where: { tenantId }, orderBy: { versione: 'desc' }, take: 50 });
    return reply.send({ corrente: storico[0] ?? null, storico });
  });

  server.post('/tenant/business-risk', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;
    // Scrittura riservata al responsabile dello studio o all'MLRO nominato (§9).
    const settings = await prisma.tenantComplianceSettings.findUnique({ where: { tenantId }, select: { mlroUserId: true } });
    const puo = req.ruolo === 'advisor' || req.ruolo === 'super_admin' || (!!req.userId && req.userId === settings?.mlroUserId);
    if (!puo) return reply.code(403).send({ errore: 'La valutazione del rischio dello studio è riservata al responsabile o all’MLRO.' });

    const b = (req.body || {}) as Record<string, any>;
    const liv = (v: any): LivelloRischioK3 => (LIVELLI_RISCHIO.includes(v) ? v : 'basso');
    const fattori = {
      clientela: liv(b.clientelaLivello), servizi: liv(b.serviziLivello),
      geografia: liv(b.geografiaLivello), canali: liv(b.canaliLivello),
    };
    const motiv = {
      cliente: b.clientelaMotivazione, geografia: b.geografiaMotivazione,
      prodotto: b.serviziMotivazione, canale: b.canaliMotivazione,
    };
    // §6/§14 — ogni fattore va motivato: senza le quattro motivazioni la valutazione non si chiude.
    if (!assessmentCompleto(motiv)) return reply.code(400).send({ errore: 'Ogni fattore di rischio richiede una motivazione (§6).' });

    const complessivo = livelloComplessivo({ cliente: fattori.clientela, geografia: fattori.geografia, prodotto: fattori.servizi, canale: fattori.canali });
    const ora = new Date();
    const ultima = await prisma.businessRiskAssessment.findFirst({ where: { tenantId }, orderBy: { versione: 'desc' }, select: { versione: true } });

    const bra = await prisma.businessRiskAssessment.create({
      data: {
        tenantId,
        versione: (ultima?.versione ?? 0) + 1,
        clientelaLivello: fattori.clientela, clientelaMotivazione: String(motiv.cliente).trim(),
        serviziLivello: fattori.servizi, serviziMotivazione: String(motiv.prodotto).trim(),
        geografiaLivello: fattori.geografia, geografiaMotivazione: String(motiv.geografia).trim(),
        canaliLivello: fattori.canali, canaliMotivazione: String(motiv.canale).trim(),
        livelloComplessivo: complessivo,
        motivazioneComplessiva: b.motivazioneComplessiva ? String(b.motivazioneComplessiva).trim() : null,
        prossimaRevisione: prossimaRevisione(ora, complessivo),
        redattoDa: req.userId ?? null,
      },
    });
    await registraComplianceEvent(prisma, {
      tenantId, tipo: 'KYC_BUSINESS_RISK', attoreUserId: req.userId ?? null,
      payload: { businessRiskId: bra.id, versione: bra.versione, livelloComplessivo: complessivo },
    });
    return reply.send({ ok: true, corrente: bra });
  });

  // ── K9/§5.5 — registro della formazione AML (§7 TrainingRecord, §12 promemoria) ─────────────
  // Log a livello di studio. Lettura ai ruoli interni; scrittura al responsabile/MLRO. Ogni riga è
  // un evento formativo (non versionato); il cron avvisa se la cadenza è superata.
  server.get('/tenant/formazione', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;
    const record = await prisma.trainingRecord.findMany({ where: { tenantId }, orderBy: { data: 'desc' }, take: 200 });
    return reply.send({ record });
  });

  server.post('/tenant/formazione', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;
    const settings = await prisma.tenantComplianceSettings.findUnique({ where: { tenantId }, select: { mlroUserId: true } });
    const puo = req.ruolo === 'advisor' || req.ruolo === 'super_admin' || (!!req.userId && req.userId === settings?.mlroUserId);
    if (!puo) return reply.code(403).send({ errore: 'Il registro formazione è riservato al responsabile o all’MLRO.' });

    const b = (req.body || {}) as Record<string, any>;
    if (!b.titolo || String(b.titolo).trim().length < 2) return reply.code(400).send({ errore: 'Titolo obbligatorio.' });
    const data = b.data ? new Date(String(b.data)) : null;
    if (!data || Number.isNaN(data.getTime())) return reply.code(400).send({ errore: 'Data della formazione non valida.' });
    const TIPI = ['mlro', 'personale', 'amministratori', 'aggiornamento', 'altro'];

    const record = await prisma.trainingRecord.create({
      data: {
        tenantId,
        titolo: String(b.titolo).trim().slice(0, 200),
        tipo: TIPI.includes(b.tipo) ? b.tipo : 'personale',
        data,
        partecipanti: b.partecipanti ? String(b.partecipanti).trim().slice(0, 1000) : null,
        oreFormazione: Number.isFinite(Number(b.oreFormazione)) ? Number(b.oreFormazione) : null,
        ente: b.ente ? String(b.ente).trim().slice(0, 200) : null,
        note: b.note ? String(b.note).trim().slice(0, 1000) : null,
        registratoDa: req.userId ?? null,
      },
    });
    await registraComplianceEvent(prisma, {
      tenantId, tipo: 'KYC_FORMAZIONE_REGISTRATA', attoreUserId: req.userId ?? null,
      payload: { trainingId: record.id, tipo: record.tipo, data: data.toISOString() },
    });
    return reply.send({ ok: true, record });
  });
}
