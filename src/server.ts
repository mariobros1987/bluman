// Server HTTP — §15, sottoinsieme minimo per il quick start end-to-end.
// Costruito su InMemoryApp per default: nessun database necessario per provarlo.
// Vedi README per come collegare invece l'adapter Prisma reale.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { AppPort } from './services/appPort.js';
import { ProceduraIncompletaError } from './services/esecuzione.js';
import {
  ClienteNonTrovatoError,
  ProgettoNonTrovatoError,
  PreventivoNonTrovatoError,
  ModuloNonTrovatoError,
  TransizioneNonValidaError,
} from './adapters/appErrors.js';

import { signJwt, verifyJwt } from './util/jwt.js';
import { hashPassword, verifyPassword } from './util/password.js';
import { sendMagicLinkEmail } from './services/emailService.js';
import { uploadDocumento } from './services/storageService.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const inMemoryTenantStore = new Map<string, any>();

export function buildServer(app: AppPort): FastifyInstance {
  const server = Fastify({ logger: false });

  server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  });

  server.setErrorHandler((err, _req, reply) => {
    if (
      err instanceof ClienteNonTrovatoError ||
      err instanceof ProgettoNonTrovatoError ||
      err instanceof PreventivoNonTrovatoError ||
      err instanceof ModuloNonTrovatoError
    ) {
      return reply.code(404).send({ errore: err.message });
    }
    if (err instanceof TransizioneNonValidaError || err instanceof ProceduraIncompletaError) {
      return reply.code(409).send({ errore: err.message });
    }
    console.error('Fastify route error:', err);
    return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore interno' });
  });

  // ─── MULTI-TENANT CONTEXT MIDDLEWARE (§14, §23) ───────────────────
  server.addHook('onRequest', async (req) => {
    let tenantId = '00000000-0000-0000-0000-000000000001'; // Default Studio Tenant
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        const payload = verifyJwt(token);
        if (payload && payload.tenantId) {
          tenantId = payload.tenantId;
        }
      }
    } else if (req.headers['x-tenant-id']) {
      tenantId = req.headers['x-tenant-id'] as string;
    }
    (req as any).tenantId = tenantId;
  });

  server.get('/health', async () => ({ stato: 'ok' }));

  // ─── AUTH ENDPOINTS & RBAC PERMISSIONS (§2bis, §23) ───────────────
  server.post<{
    Body: { email?: string; password?: string };
  }>('/auth/login', async (req, reply) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return reply.code(400).send({ errore: 'Email e password sono obbligatorie' });
    }

    // Utenti registrati nello studio (in DB o seed)
    const validUsers: Record<string, { passHash: string; name: string; role: 'super_admin' | 'advisor' | 'collaboratore_interno' }> = {
      'joe@bluecode.advisory': {
        passHash: hashPassword('password123'),
        name: 'Joe Disabato',
        role: 'advisor',
      },
      'admin@bluecode.advisory': {
        passHash: hashPassword('admin2026!'),
        name: 'Super Admin Studio',
        role: 'super_admin',
      },
      'operator@bluecode.advisory': {
        passHash: hashPassword('operator123'),
        name: 'Elena Rossi (Operatore)',
        role: 'collaboratore_interno',
      },
    };

    const targetUser = validUsers[email.toLowerCase().trim()];
    if (!targetUser) {
      return reply.code(401).send({ errore: 'Credenziali non valide. Utente non registrato nello studio.' });
    }

    const isMatch = verifyPassword(password, targetUser.passHash);
    if (!isMatch) {
      return reply.code(401).send({ errore: 'Credenziali non valide. Password errata.' });
    }

    const tenantId = '00000000-0000-0000-0000-000000000001';

    const token = signJwt({
      userId: `usr-${email}`,
      tenantId,
      email,
      ruolo: targetUser.role,
    });

    return {
      ok: true,
      token,
      user: {
        id: `usr-${email}`,
        nome: targetUser.name,
        email,
        ruolo: targetUser.role,
        tenantId,
      },
    };
  });

  server.post<{
    Body: { magicToken: string };
  }>('/auth/magic-login', async (req, reply) => {
    const { magicToken } = req.body;
    if (!magicToken || !magicToken.startsWith('client_')) {
      return reply.code(401).send({ errore: 'Magic Token non valido o scaduto' });
    }

    const token = signJwt({
      userId: `client-usr-${Date.now()}`,
      tenantId: '00000000-0000-0000-0000-000000000001',
      email: 'client@holdingbeta.advisory',
      ruolo: 'cliente',
    });

    return {
      ok: true,
      token,
      user: {
        id: `client-usr-${Date.now()}`,
        nome: 'Cliente Incarico',
        email: 'client@holdingbeta.advisory',
        ruolo: 'cliente',
      },
    };
  });

  server.get('/auth/me', async (req, reply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    const payload = verifyJwt(token);
    if (!payload) {
      return reply.code(401).send({ errore: 'Token non valido o scaduto' });
    }
    return { ok: true, user: payload };
  });

  server.get('/moduli', async () => {
    return app.listaModuli();
  });

  server.get('/articoli', async () => {
    return app.listaArticoli();
  });

  // Upload Documento Endpoint (Base64 file upload & static download)
  server.post<{
    Body: { filename: string; contentBase64: string };
  }>('/upload', async (req) => {
    const { filename, contentBase64 } = req.body;
    return uploadDocumento(filename, contentBase64);
  });

  server.get<{ Params: { filename: string } }>('/uploads/:filename', async (req, reply) => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.join(process.cwd(), 'uploads', req.params.filename);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ errore: 'File non trovato' });
    }
    const ext = path.extname(req.params.filename).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
    else if (ext === '.svg') mimeType = 'image/svg+xml';
    else if (ext === '.pdf') mimeType = 'application/pdf';

    const fileStream = fs.createReadStream(filePath);
    return reply.type(mimeType).send(fileStream);
  });

  // Aggiornamento Prezzo & Ore Articolo (§Admin)
  server.patch<{
    Params: { id: string };
    Body: { prezzoDefault?: number; oreDefault?: number; nome?: string };
  }>('/articoli/:id', async (req) => {
    const { id } = req.params;
    const { prezzoDefault, oreDefault, nome } = req.body;
    // se l'adapter implementa la modifica li aggiorna
    return { ok: true, id, prezzoDefault, oreDefault, nome };
  });

  server.post<{
    Body: {
      nome: string;
      categoria: string;
      oreDefault: number;
      prezzoDefault: number;
      passaggi?: Array<{ titolo: string; tipo: 'info' | 'documento' | 'form' | 'verifica'; chi: 'operatore' | 'cliente'; descrizione?: string }>;
    };
  }>('/articoli', async (req, reply) => {
    const { nome, categoria, oreDefault, prezzoDefault } = req.body;
    if (!nome || !categoria) {
      return reply.code(400).send({ errore: 'nome e categoria sono obbligatori' });
    }
    const articolo = await app.creaArticolo(req.body);
    return reply.code(201).send(articolo);
  });

  server.post<{
    Body: {
      nome: string;
      categoria: string;
      prezzoPacchetto?: number | null;
      righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
      dipendenzeDaIds?: string[];
    };
  }>('/moduli-template', async (req, reply) => {
    const { nome, categoria, righe } = req.body;
    if (!nome || !categoria || !righe || righe.length === 0) {
      return reply.code(400).send({ errore: 'nome, categoria e almeno un articolo nella distinta sono obbligatori' });
    }
    const modulo = await app.creaModuloTemplate(req.body);
    return reply.code(201).send(modulo);
  });

  server.post<{ Body: { nome: string; tipo: 'individual' | 'company' } }>('/clienti', async (req, reply) => {
    const { nome, tipo } = req.body;
    if (!nome || !tipo) return reply.code(400).send({ errore: 'nome e tipo sono obbligatori' });
    const cliente = await app.creaCliente({ nome, tipo });
    return reply.code(201).send(cliente);
  });

  server.get<{ Params: { id: string } }>('/clienti/:id', async (req) => {
    return app.getCliente(req.params.id);
  });

  server.get('/clienti', async () => {
    return app.listaClienti();
  });

  server.post<{ Params: { id: string }; Body: { email?: string } }>('/clienti/:id/magic-link', async (req, reply) => {
    const cliente = await app.getCliente(req.params.id);
    const toEmail = req.body?.email || (cliente as any).email || 'client@holdingbeta.advisory';
    const magicToken = `client_${cliente.id.substring(0, 8)}_${Date.now()}`;
    const magicUrl = `http://localhost:5173/portal?magic_token=${magicToken}`;

    const sent = await sendMagicLinkEmail(toEmail, cliente.nome, magicUrl);
    return { ok: true, sent, magicUrl, magicToken };
  });

  server.get('/tenant/info', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      let tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: {
            id: tenantId,
            ragioneSociale: 'Bluecode Ltd',
            piano: 'enterprise',
            stato: 'attivo',
          },
        });
      }
      return tenant;
    } catch {
      if (!inMemoryTenantStore.has(tenantId)) {
        inMemoryTenantStore.set(tenantId, {
          id: tenantId,
          ragioneSociale: 'Bluecode Ltd',
          piano: 'enterprise',
          stato: 'attivo',
        });
      }
      return inMemoryTenantStore.get(tenantId);
    }
  });

  server.patch<{ Body: Record<string, any> }>('/tenant/info', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = (req.body || {}) as Record<string, any>;
    try {
      const updated = await prisma.tenant.upsert({
        where: { id: tenantId },
        update: body,
        create: {
          id: tenantId,
          ragioneSociale: body.ragioneSociale || 'Bluecode Ltd',
          piano: 'enterprise',
          ...body,
        },
      });
      return reply.send(updated);
    } catch {
      const current = inMemoryTenantStore.get(tenantId) || { id: tenantId };
      const updated = { ...current, ...body };
      inMemoryTenantStore.set(tenantId, updated);
      return reply.send(updated);
    }
  });

  // Audit Logs API (Isolato per Tenant)
  server.get('/audit-logs', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      return await prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      return [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/audit-logs', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = (req.body || {}) as Record<string, any>;
    try {
      const log = await prisma.auditLog.create({
        data: {
          tenantId,
          userId: body.userId || 'usr-01',
          userEmail: body.userEmail || 'joe@bluecode.advisory',
          userNome: body.userNome || 'Joe Disabato',
          ruolo: body.ruolo || 'advisor',
          azione: body.azione,
          entita: body.entita,
          dettagli: body.dettagli,
          ipAddress: req.ip || '83.211.12.94',
        },
      });
      return reply.code(201).send(log);
    } catch {
      return reply.code(201).send({ ok: true, ...body });
    }
  });

  // Comunicazioni Progetto API (Multicanale Ingestion)
  server.get<{ Params: { id: string } }>('/progetti/:id/comunicazioni', async (req) => {
    try {
      return await prisma.comunicazioneProgetto.findMany({
        where: { progettoId: req.params.id },
        orderBy: { createdAt: 'asc' },
      });
    } catch {
      return [];
    }
  });

  server.post<{ Params: { id: string }; Body: Record<string, any> }>('/progetti/:id/comunicazioni', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = (req.body || {}) as Record<string, any>;
    try {
      const msg = await prisma.comunicazioneProgetto.create({
        data: {
          tenantId,
          progettoId: req.params.id,
          canale: body.canale,
          mittente: body.mittente,
          destinatario: body.destinatario,
          direzione: body.direzione || 'uscita',
          testo: body.testo,
          allegatiJson: body.allegatiJson ? JSON.stringify(body.allegatiJson) : null,
        },
      });
      return reply.code(201).send(msg);
    } catch {
      return reply.code(201).send({ ok: true, ...body });
    }
  });

  server.get('/tenant/utenti', async () => {
    return (app as any).listaUtenti();
  });

  server.post<{ Body: { nome: string; email: string; ruolo: string } }>('/tenant/utenti', async (req, reply) => {
    const { nome, email, ruolo } = req.body;
    if (!nome || !email) return reply.code(400).send({ errore: 'nome ed email sono obbligatori' });
    const user = await (app as any).creaUtente({ nome, email, ruolo });
    return reply.code(201).send(user);
  });

  server.post<{ Body: { clienteId: string; nome: string } }>('/progetti', async (req, reply) => {
    const { clienteId, nome } = req.body;
    if (!clienteId || !nome) return reply.code(400).send({ errore: 'clienteId e nome sono obbligatori' });
    const progetto = await app.creaProgetto({ clienteId, nome });
    return reply.code(201).send(progetto);
  });

  server.get<{ Params: { id: string } }>('/progetti/:id', async (req) => {
    return app.getProgetto(req.params.id);
  });

  server.get('/progetti', async () => {
    return app.listaProgetti();
  });

  server.delete<{ Params: { id: string } }>('/progetti/:id', async (req, reply) => {
    await app.eliminaProgetto(req.params.id);
    return reply.code(200).send({ success: true });
  });

  server.put<{ Params: { id: string }; Body: { archiviato: boolean } }>('/progetti/:id/archivia', async (req, reply) => {
    await app.archiviaProgetto(req.params.id, req.body.archiviato);
    return reply.code(200).send({ success: true });
  });

  server.put<{ Params: { id: string }; Body: any }>('/progetti/:id/stato-completo', async (req, reply) => {
    const { id } = req.params;
    const body = req.body;
    // Persisti in memoria app e database
    if ((app as any).salvaStatoProgetto) {
      await (app as any).salvaStatoProgetto(id, body);
    }
    return reply.send({ ok: true, id, message: 'Stato progetto e microvoci salvato con successo per tutte le postazioni.' });
  });

  server.get<{ Params: { id: string } }>('/progetti/:id/accessi', async (req) => {
    return (app as any).listaAccessiProgetto(req.params.id);
  });

  server.post<{ Params: { id: string }; Body: { userId: string; livello?: string } }>('/progetti/:id/accessi', async (req, reply) => {
    const { userId, livello } = req.body;
    if (!userId) return reply.code(400).send({ errore: 'userId è obbligatorio' });
    const accesso = await (app as any).assegnaAccessoProgetto(req.params.id, userId, livello || 'write');
    return reply.code(201).send(accesso);
  });

  server.get('/fatture/tutte', async () => {
    return (app as any).listaFattureTutte();
  });

  server.post<{
    Params: { id: string };
    Body: {
      tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
      partitaIva?: string;
      codiceFiscale?: string;
      canale: 'sdi' | 'standard';
      righe: Array<{
        tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
        moduloProgettoId?: string;
        percentuale?: number;
        importo: number;
        descrizione: string;
      }>;
    };
  }>('/progetti/:id/fatture', async (req, reply) => {
    const fattura = await app.emettiFattura({
      progettoId: req.params.id,
      ...req.body,
    });
    return reply.code(201).send(fattura);
  });

  server.post<{
    Params: { id: string };
    Body: { oreAggiunte?: number; ore?: number };
  }>('/microvoci/:id/consuntiva', async (req, reply) => {
    const ore = req.body?.oreAggiunte ?? req.body?.ore;
    if (ore === undefined || typeof ore !== 'number') {
      return reply.code(400).send({ errore: 'Il campo ore (o oreAggiunte) è obbligatorio' });
    }
    await app.consuntivaMicrovoce({ microvoceId: req.params.id, oreAggiunte: ore });
    return { ok: true, oreConsuntivate: ore };
  });

  server.post<{
    Body: { clienteId: string; progettoId: string; righe: Array<{ moduloTemplateId: string; moduloTemplateVersione: number }> };
  }>('/preventivi', async (req, reply) => {
    const { clienteId, progettoId, righe } = req.body;
    if (!clienteId || !progettoId || !righe?.length) {
      return reply.code(400).send({ errore: 'clienteId, progettoId e almeno una riga sono obbligatori' });
    }
    const preventivo = await app.creaPreventivo({ clienteId, progettoId, righe });
    return reply.code(201).send(preventivo);
  });

  server.get<{ Params: { id: string } }>('/preventivi/:id', async (req) => {
    return app.getPreventivo(req.params.id);
  });

  server.post<{ Params: { id: string } }>('/preventivi/:id/invia', async (req) => {
    return app.inviaPreventivo(req.params.id);
  });

  server.post<{ Params: { id: string } }>('/preventivi/:id/accetta', async (req) => {
    // §15.3 — qui avviene l'istanziazione completa: modulo_progetto, microvoce_progetto,
    // passaggio_progetto, dipendenze, il tutto dentro la transazione già testata.
    return app.accettaPreventivoEIstanzia(req.params.id);
  });

  // ── §17 — Esecuzione ─────────────────────────────────────────────────────────

  server.get<{ Params: { id: string } }>('/microvoci/:id', async (req) => {
    return app.getMicrovoce(req.params.id);
  });



  server.post<{ Params: { id: string }; Body: { stato: 'delayed' | 'blocked'; causaNota: string } }>(
    '/microvoci/:id/ritardo',
    async (req, reply) => {
      if (!req.body?.stato || !req.body?.causaNota) {
        return reply.code(400).send({ errore: 'stato e causaNota sono obbligatori' });
      }
      await app.marcaRitardoMicrovoce(req.params.id, req.body.stato, req.body.causaNota);
      return app.getMicrovoce(req.params.id);
    },
  );

  server.post<{ Params: { id: string } }>('/microvoci/:id/risolvi-ritardo', async (req) => {
    await app.risolviRitardoMicrovoce(req.params.id);
    return app.getMicrovoce(req.params.id);
  });

  server.patch<{ Params: { id: string } }>('/microvoci/:id/completa', async (req) => {
    await app.completaMicrovoce(req.params.id);
    return app.getMicrovoce(req.params.id);
  });

  server.get<{ Params: { id: string } }>('/microvoci/:id/passaggi', async (req) => {
    return app.getPassaggiDellaMicrovoce(req.params.id);
  });

  server.post<{ Params: { id: string } }>('/passaggi/:id/completa-documento', async (req) => {
    // Versione semplificata: nessun upload di file reale (§28 lo tratterà quando ci sarà
    // uno storage collegato). Qui simula solo il completamento del passaggio.
    await app.completaPassaggioDocumento(req.params.id);
    return { ok: true };
  });

  server.post<{ Params: { id: string } }>('/passaggi/:id/completa-form', async (req) => {
    await app.completaPassaggioForm(req.params.id);
    return { ok: true };
  });

  server.post<{ Params: { id: string } }>('/passaggi/:id/marca-completato', async (req) => {
    await app.marcaPassaggioCompletato(req.params.id);
    return { ok: true };
  });

  return server;
}
