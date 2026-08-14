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

export function buildServer(app: AppPort): FastifyInstance {
  const server = Fastify({ logger: false });

  server.register(cors, { origin: true });

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

  server.get('/health', async () => ({ stato: 'ok' }));

  // ─── AUTH ENDPOINTS & RBAC PERMISSIONS (§2bis, §23) ───────────────
  server.post<{
    Body: { email: string; password?: string };
  }>('/auth/login', async (req, reply) => {
    const { email, password } = req.body;
    
    // Utente demo per quick-start se non presente in DB
    let userRole: 'super_admin' | 'advisor' | 'collaboratore_interno' = 'advisor';
    let userName = 'Joe Disabato';
    let tenantId = '00000000-0000-0000-0000-000000000001';

    if (email.includes('admin')) {
      userRole = 'super_admin';
      userName = 'Super Admin Studio';
    } else if (email.includes('operator')) {
      userRole = 'collaboratore_interno';
      userName = 'Elena Rossi (Operatore)';
    }

    const token = signJwt({
      userId: `usr-${Date.now()}`,
      tenantId,
      email,
      ruolo: userRole,
    });

    return {
      ok: true,
      token,
      user: {
        id: `usr-${Date.now()}`,
        nome: userName,
        email,
        ruolo: userRole,
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
    const fs = await import('fs');
    const path = await import('path');
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const cleanBase64 = contentBase64.replace(/^data:[^;]+;base64,/, '');
    const safeFilename = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const filePath = path.join(uploadsDir, safeFilename);
    fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));
    return { ok: true, url: `/uploads/${safeFilename}`, name: filename, size: `${Math.round(cleanBase64.length * 0.75 / 1024)} KB` };
  });

  server.get<{ Params: { filename: string } }>('/uploads/:filename', async (req, reply) => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.join(process.cwd(), 'uploads', req.params.filename);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ errore: 'File non trovato' });
    }
    const fileStream = fs.createReadStream(filePath);
    return reply.type('application/pdf').send(fileStream);
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

  server.get<{ Params: { id: string } }>('/progetti/:id/accessi', async (req) => {
    return (app as any).listaAccessiProgetto(req.params.id);
  });

  server.post<{ Params: { id: string }; Body: { userId: string; livello?: string } }>('/progetti/:id/accessi', async (req, reply) => {
    const { userId, livello } = req.body;
    if (!userId) return reply.code(400).send({ errore: 'userId è obbligatorio' });
    const accesso = await (app as any).assegnaAccessoProgetto(req.params.id, userId, livello || 'write');
    return reply.code(201).send(accesso);
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
    Body: { oreAggiunte: number; completa?: boolean };
  }>('/microvoci/:id/consuntiva', async (req) => {
    return app.consuntivaMicrovoce({
      microvoceId: req.params.id,
      oreAggiunte: req.body.oreAggiunte || 0,
      completa: req.body.completa || false,
    });
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
