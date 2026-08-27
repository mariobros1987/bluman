// Rotte catalogo: articoli, upload, moduli-template — §Prisma Persistenza Cloud, §3bis, §36.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. `registraRotteCatalogo` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma, conContestoInTransazione } from '../util/prismaClient.js';
import { uploadDocumento, CARTELLA_UPLOADS, nomeFileValido } from '../services/storageService.js';
import { verificaFirmaDownload } from '../util/jwt.js';
import { recordAudit } from '../util/serverHelpers.js';

// ─── ARTICOLI & PRESTAZIONI API (§Prisma Persistenza Cloud) ───────
export async function registraRotteCatalogo(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── GIURISDIZIONI API (§8 Estensione) ───────────────────────────
  server.get('/giurisdizioni', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const items = await prisma.giurisdizione.findMany({
        where: { tenantId },
        orderBy: { nome: 'asc' },
      });
      return items;
    } catch {
      return [
        { id: 'giur-mt', nome: 'Malta', codice: 'MT', tipo: 'ue', note: 'Repubblica di Malta' },
        { id: 'giur-gi', nome: 'Gibilterra', codice: 'GI', tipo: 'extra_ue', note: 'Territorio d Oltremare Britannico' },
        { id: 'giur-fl', nome: 'Florida (USA)', codice: 'US-FL', tipo: 'stato_usa', note: 'Stato della Florida' },
        { id: 'giur-de', nome: 'Delaware (USA)', codice: 'US-DE', tipo: 'stato_usa', note: 'Stato del Delaware' },
        { id: 'giur-ae', nome: 'Emirati Arabi Uniti', codice: 'AE', tipo: 'extra_ue', note: 'Dubai / Abu Dhabi Free Zones' },
      ];
    }
  });

  server.post<{ Body: { nome: string; codice: string; tipo: 'ue' | 'extra_ue' | 'stato_usa' | 'altro'; note?: string } }>('/giurisdizioni', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const body = req.body || {};
    try {
      const item = await prisma.giurisdizione.create({
        data: {
          tenantId,
          nome: body.nome,
          codice: body.codice,
          tipo: body.tipo || 'ue',
          note: body.note,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'GIURISDIZIONE_CREATA',
        entita: body.nome,
        dettagli: `Aggiunta nuova giurisdizione ${body.nome} (${body.codice})`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(item);
    } catch {
      return reply.code(201).send({ id: `giur-${Date.now()}`, tenantId, ...body });
    }
  });

  server.put<{ Params: { id: string }; Body: { nome?: string; codice?: string; tipo?: 'ue' | 'extra_ue' | 'stato_usa' | 'altro'; note?: string } }>('/giurisdizioni/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    const body = req.body || {};
    try {
      const updated = await prisma.giurisdizione.update({
        where: { id },
        data: {
          nome: body.nome,
          codice: body.codice,
          tipo: body.tipo,
          note: body.note,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'GIURISDIZIONE_AGGIORNATA',
        entita: updated.nome,
        dettagli: `Modificata giurisdizione ${updated.nome} (${updated.codice})`,
        ipAddress: req.ip,
      });
      return reply.send(updated);
    } catch (err: any) {
      return reply.code(400).send({ errore: err.message || 'Errore aggiornamento giurisdizione' });
    }
  });

  server.delete<{ Params: { id: string } }>('/giurisdizioni/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    try {
      await prisma.giurisdizione.delete({ where: { id } });
      await recordAudit({
        tenantId,
        azione: 'GIURISDIZIONE_ELIMINATA',
        entita: id,
        dettagli: `Eliminata giurisdizione ${id}`,
        ipAddress: req.ip,
      });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.code(400).send({ errore: err.message || 'Errore eliminazione giurisdizione' });
    }
  });

  server.get<{ Querystring: { giurisdizioneId?: string } }>('/moduli', async (req) => {
    const { giurisdizioneId } = req.query || {};
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      if (giurisdizioneId) {
        // Restituisce i moduli specifici di quella giurisdizione PIÙ quelli generici (giurisdizioneId null)
        const dbModuli = await prisma.moduloTemplate.findMany({
          where: {
            tenantId,
            isAttivo: true,
            OR: [
              { giurisdizioneId: giurisdizioneId },
              { giurisdizioneId: null },
            ],
          },
          include: {
            giurisdizione: true,
            dipendenze: true,
            righeDistinta: { include: { articolo: true } },
          },
        });
        return dbModuli;
      }
      return await prisma.moduloTemplate.findMany({
        where: { tenantId, isAttivo: true },
        include: {
          giurisdizione: true,
          dipendenze: true,
          righeDistinta: { include: { articolo: true } },
        },
      });
    } catch {
      return app.listaModuli();
    }
  });

  // ─── ARTICOLI & PRESTAZIONI API (§Prisma Persistenza Cloud) ───────
  server.get('/articoli', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      // Una lista vuota è una risposta legittima (studio appena iscritto senza
      // catalogo): prima veniva scambiata per un errore e sostituita coi dati
      // dell'adapter in-memory. Il ripiego resta solo se il DB non risponde.
      return await prisma.articolo.findMany({
        where: { tenantId, isAttivo: true },
        orderBy: { nome: 'asc' },
      });
    } catch {
      return app.listaArticoli();
    }
  });

  // Upload Documento Endpoint (Base64 file upload & static download)
  server.post<{
    Body: { filename: string; contentBase64: string };
  }>('/upload', async (req) => {
    const { filename, contentBase64 } = req.body;
    const res = await uploadDocumento(filename, contentBase64);
    await recordAudit({
      tenantId: (req as any).tenantId,
      azione: 'DOCUMENTO_CARICATO',
      entita: filename,
      dettagli: `Caricato nuovo file (${res.size}) con URL ${res.url}`,
      ipAddress: req.ip,
    });
    return res;
  });

  server.get<{ Params: { filename: string }; Querystring: { firma?: string; scad?: string } }>(
    '/uploads/:filename',
    async (req, reply) => {
      const fs = await import('fs');
      const path = await import('path');
      const filename = req.params.filename;

      // 1. Il nome file. Prima il parametro veniva concatenato così com'era, e Fastify
      // decodifica i parametri di rotta: `..%2f..%2f.env` arrivava qui come `../../.env` e
      // `path.join` usciva dalla cartella. Si rifiuta invece di sanificare, perché un nome
      // riscritto in silenzio darebbe 404 e nasconderebbe il tentativo.
      if (!nomeFileValido(filename)) {
        return reply.code(400).send({ errore: 'Nome file non valido' });
      }

      // 2. Il titolo per leggerlo. Due prove alternative, e non solo il Bearer, perché
      // questi URL finiscono in `<img src>` (logo dello studio nella sidebar, nelle fatture,
      // dentro l'HTML delle stampe PDF) e in href diretti: nessuno dei due può inviare un
      // header Authorization. La firma in query string è HMAC sullo stesso segreto dei JWT.
      const autenticato = Boolean((req as any).ruolo);
      const firmato = verificaFirmaDownload(filename, req.query?.firma, req.query?.scad);
      if (!autenticato && !firmato) {
        return reply.code(401).send({ errore: 'Accesso al file non autorizzato' });
      }

      const filePath = path.join(CARTELLA_UPLOADS, filename);
      // Terza rete: si verifica sul percorso risolto che il file stia davvero sotto
      // `uploads/`. Il controllo sul nome dovrebbe già bastare, ma questo regge anche alle
      // codifiche che quello non prevede — ed è l'unico che non dipende da una regex.
      const radice = path.resolve(CARTELLA_UPLOADS);
      if (!path.resolve(filePath).startsWith(radice + path.sep)) {
        return reply.code(400).send({ errore: 'Nome file non valido' });
      }

      if (!fs.existsSync(filePath)) {
        return reply.code(404).send({ errore: 'File non trovato' });
      }
      const ext = path.extname(filename).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.svg') mimeType = 'image/svg+xml';
      else if (ext === '.pdf') mimeType = 'application/pdf';
      else if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (ext === '.doc') mimeType = 'application/msword';
      else if (ext === '.xlsx') mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (ext === '.xls') mimeType = 'application/vnd.ms-excel';
      else if (ext === '.zip') mimeType = 'application/zip';
      else if (ext === '.txt') mimeType = 'text/plain; charset=utf-8';
      else if (ext === '.html') mimeType = 'text/html; charset=utf-8';

      const nomePulito = filename.replace(/^\d+_/, '') || filename;
      const isAnteprima = ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.svg' || ext === '.pdf';
      const disposition = isAnteprima ? `inline; filename="${nomePulito}"` : `attachment; filename="${nomePulito}"`;
      reply.header('Content-Disposition', disposition);

      const fileStream = fs.createReadStream(filePath);
      return reply.type(mimeType).send(fileStream);
    },
  );

  // Aggiornamento Prezzo & Ore Articolo (§Admin)
  server.patch<{
    Params: { id: string };
    Body: { prezzoDefault?: number; oreDefault?: number; nome?: string };
  }>('/articoli/:id', async (req, reply) => {
    const { id } = req.params;
    const { prezzoDefault, oreDefault, nome } = req.body;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const updated = await prisma.articolo.update({
        where: { id },
        data: {
          prezzoDefault: prezzoDefault !== undefined ? prezzoDefault : undefined,
          oreDefault: oreDefault !== undefined ? oreDefault : undefined,
          nome: nome !== undefined ? nome : undefined,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'ARTICOLO_AGGIORNATO',
        entita: updated.nome,
        dettagli: `Aggiornato prezzo (€${(updated.prezzoDefault || 0)/100}) e ore (${updated.oreDefault}h)`,
        ipAddress: req.ip,
      });
      return reply.send(updated);
    } catch (err: any) {
      // §3.3 — il catch rispondeva { ok: true } anche quando l'aggiornamento non
      // aveva toccato nessuna riga (id sbagliato, articolo di un altro tenant
      // invisibile per RLS): la UI ringraziava e il dato restava com'era.
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Articolo non trovato' });
      }
      return reply.code(500).send({ errore: err?.message || 'Errore aggiornamento articolo' });
    }
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
    const { nome, categoria, oreDefault, prezzoDefault, passaggi } = req.body;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    if (!nome || !categoria) {
      return reply.code(400).send({ errore: 'nome e categoria sono obbligatori' });
    }
    try {
      const art = await prisma.articolo.create({
        data: {
          tenantId,
          nome,
          categoria,
          oreDefault: oreDefault || 1,
          prezzoDefault: prezzoDefault || 0,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'ARTICOLO_CREATO',
        entita: art.nome,
        dettagli: `Creato articolo prestazione ${art.nome} (${art.categoria}) - €${art.prezzoDefault/100}`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(art);
    } catch {
      const articolo = await app.creaArticolo(req.body);
      return reply.code(201).send(articolo);
    }
  });

  server.post<{
    Body: {
      nome: string;
      categoria: string;
      giurisdizioneId?: string | null;
      prezzoPacchetto?: number | null;
      righe: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
      dipendenzeDaIds?: string[];
    };
  }>('/moduli-template', async (req, reply) => {
    const { nome, categoria, giurisdizioneId, prezzoPacchetto, righe, dipendenzeDaIds } = req.body;
    // §14 — il tenant è quello della richiesta (JWT), NON un valore fisso: prima la
    // creazione passava da app.creaModuloTemplate() che è legato al tenant Bluecode,
    // quindi per ogni altro studio l'inserimento veniva rifiutato dalle policy RLS.
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    if (!nome || !categoria || !righe || righe.length === 0) {
      return reply.code(400).send({ errore: 'nome, categoria e almeno un articolo nella distinta sono obbligatori' });
    }
    try {
      // Validazioni lette fuori dalla transazione: le risposte 400 devono uscire
      // pulite senza essere scambiate per guasti del DB dal catch qui sotto.
      if (giurisdizioneId) {
        const giur = await prisma.giurisdizione.findUnique({ where: { id: giurisdizioneId } });
        if (!giur) {
          return reply.code(400).send({ errore: 'La giurisdizione selezionata non esiste' });
        }
      }
      for (const r of righe) {
        const art = await prisma.articolo.findUnique({ where: { id: r.articoloId } });
        if (!art) {
          return reply.code(400).send({ errore: `Articolo non trovato nella distinta: ${r.articoloId}` });
        }
      }

      const modulo = await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          const creato = await tx.moduloTemplate.create({
            data: {
              tenantId,
              nome,
              categoria,
              // Prima andava perso: il body lo portava ma la vecchia creazione non lo
              // raccoglieva, e ogni modulo nuovo risultava «generico».
              giurisdizioneId: giurisdizioneId || null,
              prezzoPacchetto: prezzoPacchetto ?? null,
              versione: 1,
            },
          });

          for (const [idx, r] of righe.entries()) {
            // §3bis — la riga pinna la versione corrente dell'articolo: i progetti
            // già istanziati non devono cambiare quando il catalogo si aggiorna.
            const art = await tx.articolo.findUniqueOrThrow({ where: { id: r.articoloId } });
            await tx.rigaDistinta.create({
              data: {
                tenantId,
                moduloTemplateId: creato.id,
                articoloId: r.articoloId,
                articoloVersione: art.versione,
                ordine: idx + 1,
                quantita: r.quantita || 1,
                overrideOre: r.overrideOre || null,
                overridePrezzo: r.overridePrezzo || null,
              },
            });
          }

          for (const depId of dipendenzeDaIds || []) {
            await tx.moduloDipendenzaTemplate.create({
              data: {
                tenantId,
                moduloTemplateId: creato.id,
                dipendeDaModuloTemplateId: depId,
              },
            });
          }

          return tx.moduloTemplate.findUnique({
            where: { id: creato.id },
            include: { giurisdizione: true, righeDistinta: { include: { articolo: true } }, dipendenze: true },
          });
        }),
      );

      await recordAudit({
        tenantId,
        azione: 'MODULO_TEMPLATE_CREATO',
        entita: nome,
        dettagli: `Creato modulo libreria ${nome} (${categoria}) con ${righe.length} articoli in distinta`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(modulo);
    } catch (err: any) {
      // Errori di vincolo (articolo/giurisdizione spariti fra validazione e
      // inserimento): messaggio pulito, non un 500 generico.
      if (err?.code === 'P2025' || err?.code === 'P2003') {
        return reply.code(400).send({ errore: 'Un riferimento della distinta non è più valido' });
      }
      // Modalità test/demo senza DB raggiungibile: stesso ripiego in-memory di POST /articoli.
      const modulo = await app.creaModuloTemplate(req.body);
      return reply.code(201).send(modulo);
    }
  });

  // §36 — modifica di un modulo della libreria. Campi intestazione sempre; distinta
  // e dipendenze solo se presenti nel body, con sostituzione completa (deleteMany +
  // ricreazione). Tutto in una transazione: un errore a metà non deve lasciare il
  // modulo con una distinta parziale.
  server.put<{
    Params: { id: string };
    Body: {
      nome?: string;
      categoria?: string;
      giurisdizioneId?: string | null;
      prezzoPacchetto?: number | null;
      righe?: Array<{ articoloId: string; quantita: number; overrideOre?: number; overridePrezzo?: number }>;
      dipendenzeDaIds?: string[];
    };
  }>('/moduli-template/:id', async (req, reply) => {
    const { id } = req.params;
    const body = req.body || {};
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const esistente = await prisma.moduloTemplate.findUnique({ where: { id } });
      // RLS rende invisibili i moduli degli altri tenant: chi prova a modificarne
      // uno altrui riceve 404, come se non esistesse.
      if (!esistente) {
        return reply.code(404).send({ errore: 'Modulo non trovato' });
      }
      if (body.giurisdizioneId) {
        const giur = await prisma.giurisdizione.findUnique({ where: { id: body.giurisdizioneId } });
        if (!giur) {
          return reply.code(400).send({ errore: 'La giurisdizione selezionata non esiste' });
        }
      }
      if (body.righe && body.righe.length === 0) {
        return reply.code(400).send({ errore: 'La distinta non può essere vuota' });
      }

      // §14 — come per la creazione: prisma diretto col tenant della richiesta,
      // non app.aggiornaModuloTemplate() che è legato a un tenant fisso.
      const aggiornato = await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          const data: Record<string, unknown> = {};
          if (body.nome !== undefined) data.nome = body.nome;
          if (body.categoria !== undefined) data.categoria = body.categoria;
          if (body.giurisdizioneId !== undefined) data.giurisdizioneId = body.giurisdizioneId;
          if (body.prezzoPacchetto !== undefined) data.prezzoPacchetto = body.prezzoPacchetto;
          await tx.moduloTemplate.update({ where: { id }, data });

          if (body.righe) {
            await tx.rigaDistinta.deleteMany({ where: { tenantId, moduloTemplateId: id } });
            for (const [idx, r] of body.righe.entries()) {
              const art = await tx.articolo.findUniqueOrThrow({ where: { id: r.articoloId } });
              await tx.rigaDistinta.create({
                data: {
                  tenantId,
                  moduloTemplateId: id,
                  articoloId: r.articoloId,
                  articoloVersione: art.versione,
                  ordine: idx + 1,
                  quantita: r.quantita || 1,
                  overrideOre: r.overrideOre || null,
                  overridePrezzo: r.overridePrezzo || null,
                },
              });
            }
          }

          if (body.dipendenzeDaIds) {
            await tx.moduloDipendenzaTemplate.deleteMany({ where: { tenantId, moduloTemplateId: id } });
            for (const depId of body.dipendenzeDaIds) {
              await tx.moduloDipendenzaTemplate.create({
                data: { tenantId, moduloTemplateId: id, dipendeDaModuloTemplateId: depId },
              });
            }
          }

          return tx.moduloTemplate.findUnique({
            where: { id },
            include: { giurisdizione: true, righeDistinta: { include: { articolo: true } }, dipendenze: true },
          });
        }),
      );

      await recordAudit({
        tenantId,
        azione: 'MODULO_TEMPLATE_AGGIORNATO',
        entita: esistente.nome,
        dettagli: `Aggiornato modulo libreria ${id}` + (body.righe ? ` con nuova distinta di ${body.righe.length} articoli` : ''),
        ipAddress: req.ip,
      });
      return reply.send(aggiornato);
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(400).send({ errore: 'Un articolo della nuova distinta non esiste' });
      }
      if (err?.code === 'P2003') {
        return reply.code(400).send({ errore: 'Un riferimento di distinta o dipendenza non è valido' });
      }
      // Modalità test/demo senza DB raggiungibile: ripiego in-memory.
      return reply.send(await app.aggiornaModuloTemplate(id, body));
    }
  });

  // §36 / §30 — «eliminazione» = disattivazione: i progetti e i preventivi già
  // creati referenziano ancora il template, che quindi non può essere cancellato
  // davvero. Smettere di mostrarlo in libreria (isAttivo=false) ottiene lo scopo
  // senza rompere lo storico.
  server.delete<{ Params: { id: string } }>('/moduli-template/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const esistente = await prisma.moduloTemplate.findUnique({ where: { id } });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Modulo non trovato' });
      }
      await prisma.moduloTemplate.update({ where: { id }, data: { isAttivo: false } });
      await recordAudit({
        tenantId,
        azione: 'MODULO_TEMPLATE_DISATTIVATO',
        entita: esistente.nome,
        dettagli: `Disattivato modulo libreria ${esistente.nome} (${id}): non compare più nella libreria, restano attivi i progetti esistenti`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, id, isAttivo: false });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Modulo non trovato' });
      }
      // Modalità test/demo senza DB raggiungibile: ripiego in-memory.
      return reply.send(app.disattivaModuloTemplate(id));
    }
  });

  // §36 / §30 — stessa regola dei moduli: l'articolo sparisce dal catalogo ma le
  // distinte e le microvoci dei progetti continuano a referenziarlo.
  server.delete<{ Params: { id: string } }>('/articoli/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const esistente = await prisma.articolo.findUnique({ where: { id } });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Articolo non trovato' });
      }
      await prisma.articolo.update({ where: { id }, data: { isAttivo: false } });
      await recordAudit({
        tenantId,
        azione: 'ARTICOLO_DISATTIVATO',
        entita: esistente.nome,
        dettagli: `Disattivato articolo ${esistente.nome} (${id}): non compare più nel catalogo`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, id, isAttivo: false });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Articolo non trovato' });
      }
      // Modalità test/demo senza DB raggiungibile: ripiego in-memory.
      return reply.send(app.disattivaArticolo(id));
    }
  });
}
