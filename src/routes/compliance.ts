// KYC/AML Fase K0 (Malta, spec v0.2) — rotte delle impostazioni di compliance dello studio.
// Lettura riservata ai ruoli interni (mai `cliente`); scrittura solo advisor/super_admin.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { moduloKycAttivo } from '../util/guardiaModuli.js';
import { modalitaBozza, calcolaHashEvento, verificaCatena } from '../services/complianceService.js';

const PACCHETTI = ['MT', 'IT'];
const PROFILI = ['CSP_MFSA', 'ALTRO_SOGGETTO_OBBLIGATO'];

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
}
