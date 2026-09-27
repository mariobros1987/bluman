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
import { uploadDocumento, CARTELLA_UPLOADS, nomeFileValido, mimeDaEstensione, tenantDaNomeFile } from '../services/storageService.js';
import { verificaFirmaDownload } from '../util/jwt.js';
import { recordAudit } from '../util/serverHelpers.js';
import { trovaCicloDipendenze } from '../services/dipendenzeModuli.js';
import { UploadSchema } from '../schemas/upload.schema.js';
import { condizioneModuliPerGiurisdizione } from '../domain/giurisdizioni.js';
import { leggiDaCacheOCalcola, invalidaCachePrefisso } from '../services/backendCache.js';

// ─── ARTICOLI & PRESTAZIONI API (§Prisma Persistenza Cloud) ───────
export async function registraRotteCatalogo(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── GIURISDIZIONI API (§8 Estensione) ───────────────────────────
  server.get('/giurisdizioni', async (req) => {
    const tenantId = req.tenantId;
    return leggiDaCacheOCalcola(`giurisdizioni:${tenantId}`, () =>
      prisma.giurisdizione.findMany({
        where: { tenantId },
        orderBy: { nome: 'asc' },
      }),
    );
  });

  server.post<{ Body: { nome: string; codice: string; tipo: 'ue' | 'extra_ue' | 'stato_usa' | 'altro'; note?: string } }>('/giurisdizioni', async (req, reply) => {
    const tenantId = req.tenantId;
    const body = req.body || {};
    const item = await prisma.giurisdizione.create({
      data: {
        tenantId,
        nome: body.nome,
        codice: body.codice,
        tipo: body.tipo || 'ue',
        note: body.note,
      },
    });
    await invalidaCachePrefisso(`giurisdizioni:${tenantId}`);
    await invalidaCachePrefisso(`moduli:${tenantId}`);
    await recordAudit({
      tenantId,
      azione: 'GIURISDIZIONE_CREATA',
      entita: body.nome,
      dettagli: `Aggiunta nuova giurisdizione ${body.nome} (${body.codice})`,
      ipAddress: req.ip,
    });
    return reply.code(201).send(item);
  });

  server.put<{ Params: { id: string }; Body: { nome?: string; codice?: string; tipo?: 'ue' | 'extra_ue' | 'stato_usa' | 'altro'; note?: string } }>('/giurisdizioni/:id', async (req, reply) => {
    const tenantId = req.tenantId;
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
      await invalidaCachePrefisso(`giurisdizioni:${tenantId}`);
      await invalidaCachePrefisso(`moduli:${tenantId}`);
      return reply.send(updated);
    } catch (err: any) {
      // RLS rende invisibile la giurisdizione di un altro tenant: 404, non 400.
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Giurisdizione non trovata' });
      }
      throw err;
    }
  });

  server.delete<{ Params: { id: string } }>('/giurisdizioni/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      await prisma.giurisdizione.delete({ where: { id } });
      await invalidaCachePrefisso(`giurisdizioni:${tenantId}`);
      await invalidaCachePrefisso(`moduli:${tenantId}`);
      await recordAudit({
        tenantId,
        azione: 'GIURISDIZIONE_ELIMINATA',
        entita: id,
        dettagli: `Eliminata giurisdizione ${id}`,
        ipAddress: req.ip,
      });
      return reply.send({ success: true });
    } catch (err: any) {
      // RLS rende invisibile la giurisdizione di un altro tenant: 404, non 400.
      if (err?.code === 'P2025') {
        return reply.code(404).send({ errore: 'Giurisdizione non trovata' });
      }
      // FK referenziata da moduli template o progetti: non eliminabile finché
      // qualcuno la usa. 409 conflitto, con un messaggio che dice quale vincolo.
      if (err?.code === 'P2003') {
        return reply.code(409).send({ errore: 'Giurisdizione referenziata da moduli o progetti: impossibile eliminarla' });
      }
      throw err;
    }
  });

  server.get<{ Querystring: { giurisdizioneId?: string } }>('/moduli', async (req) => {
    const { giurisdizioneId } = req.query || {};
    const { tenantId } = req;
    return leggiDaCacheOCalcola(`moduli:${tenantId}:${giurisdizioneId || 'all'}`, () =>
      prisma.moduloTemplate.findMany({
        where: condizioneModuliPerGiurisdizione(tenantId, giurisdizioneId),
        // Ordine deterministico: senza, l'elenco arrivava in ordine arbitrario e il default «primo
        // modulo» nella dialog di aggiunta poteva cadere su una giurisdizione non voluta (es. il
        // gemello svizzero). Raggruppa per giurisdizione, poi per nome.
        orderBy: [{ giurisdizioneId: 'asc' }, { nome: 'asc' }],
        include: {
          giurisdizione: true,
          dipendenze: true,
          righeDistinta: { include: { articolo: true } },
        },
      }),
    );
  });

  // ─── ARTICOLI & PRESTAZIONI API (§Prisma Persistenza Cloud) ───────
  server.get('/articoli', async (req) => {
    const tenantId = req.tenantId;
    // Una lista vuota è una risposta legittima (studio appena iscritto senza
    // catalogo): prima veniva scambiata per un errore e sostituita coi dati
    // dell'adapter in-memory, fingendo un catalogo che non esiste.
    return leggiDaCacheOCalcola(`articoli:${tenantId}`, () =>
      prisma.articolo.findMany({
        where: { tenantId, isAttivo: true },
        orderBy: { nome: 'asc' },
      }),
    );
  });

  // Upload Documento Endpoint (Base64 file upload & static download)
  server.post<{
    Body: { filename: string; contentBase64: string };
  }>('/upload', async (req, reply) => {
    const validato = UploadSchema.safeParse(req.body || {});
    if (!validato.success) {
      return reply.code(400).send({ errore: validato.error.issues.map(i => i.message).join('; ') });
    }
    const { filename, contentBase64 } = validato.data;
    // Il tenant della sessione entra nel nome del file: `GET /uploads` lo rilegge per
    // rifiutare allo studio A il file caricato dallo studio B. Regola 1: l'isolamento
    // non è un dettaglio, è la difesa.
    const res = await uploadDocumento(filename, contentBase64, req.tenantId);
    await recordAudit({
      tenantId: req.tenantId,
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
      const autenticato = Boolean(req.ruolo);
      const firmato = verificaFirmaDownload(filename, req.query?.firma, req.query?.scad);
      if (!autenticato && !firmato) {
        return reply.code(401).send({ errore: 'Accesso al file non autorizzato' });
      }

      // 2b. Il file appartiene a chi lo chiede. Il nome dei file caricati da `POST /upload`
      // dichiara il tenant (`<tenantId>_<timestamp>_<nome>`): un operatore autenticato
      // dello studio A che indovini l'URL di un file dello studio B riceve 404, non il
      // contenuto. RLS protegge le righe di database, ma questi file stanno su disco dove
      // non esistono policy: il prefisso è l'unica chiave disponibile in lettura.
      // Le eccezioni sono deliberate:
      //   - la firma HMAC viene emessa dal server al tenant giusto e non porta un contesto
      //     utente: vale per se stessa (indovinarla equivale a indovinare il segreto dei JWT);
      //   - i file storici senza prefisso non dichiarano nessun tenant e seguono le regole
      //     di prima — negarli romperebbe loghi e allegati caricati prima dell'isolamento;
      //   - il super_admin vede tutti i tenant per costruzione (tenant_id NULL, §2bis).
      const tenantDelFile = tenantDaNomeFile(filename);
      const superAdmin = req.ruolo === 'super_admin';
      if (autenticato && !superAdmin && tenantDelFile && tenantDelFile !== req.tenantId) {
        return reply.code(404).send({ errore: 'File non trovato' });
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
      // Tutti i file dell'archivio sono download: niente rendering nel contesto dell'app.
      // `nosniff` impedisce al browser di reinterpretare un octet-stream come HTML attivo.
      const mimeType = mimeDaEstensione(filename);
      const nomePulito = (filename.replace(/^\d+_/, '') || filename).replace(/["\\\r\n]/g, '_');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Content-Disposition', `attachment; filename="${nomePulito}"`);
      reply.header('Content-Security-Policy', "default-src 'none'; sandbox");

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
    const tenantId = req.tenantId;
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
      await invalidaCachePrefisso(`articoli:${tenantId}`);
      await invalidaCachePrefisso(`moduli:${tenantId}`);
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
    const tenantId = req.tenantId;
    if (!nome || !categoria) {
      return reply.code(400).send({ errore: 'nome e categoria sono obbligatori' });
    }
    const art = await prisma.articolo.create({
      data: {
        tenantId,
        nome,
        categoria,
        oreDefault: oreDefault || 1,
        prezzoDefault: prezzoDefault || 0,
      },
    });
    await invalidaCachePrefisso(`articoli:${tenantId}`);
    await invalidaCachePrefisso(`moduli:${tenantId}`);
    await recordAudit({
      tenantId,
      azione: 'ARTICOLO_CREATO',
      entita: art.nome,
      dettagli: `Creato articolo prestazione ${art.nome} (${art.categoria}) - €${art.prezzoDefault/100}`,
      ipAddress: req.ip,
    });
    return reply.code(201).send(art);
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
    const tenantId = req.tenantId;
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
                // Lo zero è un override legittimo («ore incluse: 0»): con || chi
                // azzera un campo vedeva il default riemergere nel salvataggio.
                overrideOre: r.overrideOre ?? null,
                overridePrezzo: r.overridePrezzo ?? null,
              },
            });
          }

          // §7ter — qui il grafo non può chiudere cicli PER COSTRUZIONE: il modulo
          // è nuovo (id generato ora dal DB), quindi nessun arco esistente può
          // puntare a lui. Il check anti-ciclo è necessario solo nella modifica
          // (PUT): lì un modulo già referenziato può diventare prerequisito del
          // proprio prerequisito.
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
      await invalidaCachePrefisso(`moduli:${tenantId}`);
      return reply.code(201).send(modulo);
    } catch (err: any) {
      // Errori di vincolo (articolo/giurisdizione spariti fra validazione e
      // inserimento): messaggio pulito, non un 500 generico.
      if (err?.code === 'P2025' || err?.code === 'P2003') {
        return reply.code(400).send({ errore: 'Un riferimento della distinta non è più valido' });
      }
      throw err;
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
    const tenantId = req.tenantId;
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

      // §7ter — il grafo delle dipendenze dev'essere un DAG: rifiutare qui la
      // modifica che chiuderebbe un ciclo (A→B→A). Letto fuori dalla
      // transazione, come le altre validazioni 400. La verifica è chirurgica:
      // si rifiuta solo se È QUESTA modifica a chiudere il ciclo che passa per
      // il modulo editato — un ciclo già presente altrove (dati corrotti) non
      // viene attribuito a chi edita, così resta sempre possibile ripararlo
      // svuotando le dipendenze con [].
      if (body.dipendenzeDaIds) {
        const archi = await prisma.moduloDipendenzaTemplate.findMany({
          where: { tenantId },
          select: { moduloTemplateId: true, dipendeDaModuloTemplateId: true },
        });
        const ciclo = trovaCicloDipendenze(archi, id, body.dipendenzeDaIds);
        if (ciclo) {
          const nomi = await prisma.moduloTemplate.findMany({
            where: { id: { in: Array.from(new Set(ciclo)) } },
            select: { id: true, nome: true },
          });
          const nomeDi = new Map(nomi.map((n) => [n.id, n.nome] as const));
          const descrizione = ciclo.map((mid) => nomeDi.get(mid) ?? mid).join(' → ');
          return reply.code(400).send({ errore: `Ciclo nelle dipendenze (§7ter): ${descrizione}` });
        }
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
                  // Come nella creazione: lo zero è un override legittimo
                  // («ore incluse: 0»), || null lo cancellava di nascosto.
                  overrideOre: r.overrideOre ?? null,
                  overridePrezzo: r.overridePrezzo ?? null,
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
      await invalidaCachePrefisso(`moduli:${tenantId}`);
      return reply.send(aggiornato);
    } catch (err: any) {
      if (err?.code === 'P2025') {
        return reply.code(400).send({ errore: 'Un articolo della nuova distinta non esiste' });
      }
      if (err?.code === 'P2003') {
        return reply.code(400).send({ errore: 'Un riferimento di distinta o dipendenza non è valido' });
      }
      throw err;
    }
  });

  // §36 / §30 — «eliminazione» = disattivazione: i progetti e i preventivi già
  // creati referenziano ancora il template, che quindi non può essere cancellato
  // davvero. Smettere di mostrarlo in libreria (isAttivo=false) ottiene lo scopo
  // senza rompere lo storico.
  server.delete<{ Params: { id: string } }>('/moduli-template/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = req.tenantId;
    try {
      const esistente = await prisma.moduloTemplate.findUnique({ where: { id } });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Modulo non trovato' });
      }
      await prisma.moduloTemplate.update({ where: { id }, data: { isAttivo: false } });
      await invalidaCachePrefisso(`moduli:${tenantId}`);
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
      throw err;
    }
  });

  // §36 / §30 — stessa regola dei moduli: l'articolo sparisce dal catalogo ma le
  // distinte e le microvoci dei progetti continuano a referenziarlo.
  server.delete<{ Params: { id: string } }>('/articoli/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = req.tenantId;
    try {
      const esistente = await prisma.articolo.findUnique({ where: { id } });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Articolo non trovato' });
      }
      await prisma.articolo.update({ where: { id }, data: { isAttivo: false } });
      await invalidaCachePrefisso(`articoli:${tenantId}`);
      await invalidaCachePrefisso(`moduli:${tenantId}`);
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
      throw err;
    }
  });
}
