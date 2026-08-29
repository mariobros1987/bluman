// Rotte progetti ed esecuzione: anagrafica progetti, comunicazioni, timesheet,
// operatori suggeriti, ricerca globale, checklist SOP, preventivi, microvoci e
// passaggi — §15, §16, §17, blocchi 4, 6.1, 6.2.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. Nel monolite vivevano in SETTE punti diversi (le
// comunicazioni in coda alla sezione STREAM, i progetti dopo l'anagrafica
// clienti, timesheet e operatori nella sezione 6, la ricerca globale, checklist
// e preventivi, l'esecuzione §17): qui sono riunite nell'ordine di
// registrazione originale. `registraRotteProgetti` viene chiamata DENTRO il
// wrapper `server.register(...)` di `buildServer`, quindi il rate-limit e
// l'hook auth onRequest continuano ad applicarsi esattamente come prima
// (stesso contesto di incapsulamento, nessuna nuova barriera).

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { notificaStudio } from '../services/notificheService.js';
// §16 — le percentuali e gli stati aggregati arrivano da qui, non dal frontend.
import { arricchisciProgetti, calcolaAvanzamento, ricalcolaProgetto } from '../services/calcoloService.js';
import { ricercaGlobale } from '../services/ricercaGlobaleService.js';
import { TENANT_DEFAULT, STATI_MICROVOCE, STATI_PROGETTO, recordAudit } from '../util/serverHelpers.js';
import { livelloFirmaValido } from '../services/livelloFirmaService.js';

// ─── PROGETTI, COMUNICAZIONI, TIMESHEET, CHECKLIST & ESECUZIONE ─────
export async function registraRotteProgetti(server: FastifyInstance, app: AppPort): Promise<void> {
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
      // Blocco 3 — messaggio in arrivo dal cliente: lo studio viene avvisato subito.
      if (body.direzione === 'entrata' || body.direzione === 'ingresso') {
        const progetto = await prisma.progetto.findUnique({
          where: { id: req.params.id },
          include: { cliente: { select: { nome: true } } },
        });
        if (progetto) {
          await notificaStudio(tenantId, {
            tipoEvento: 'messaggio_cliente',
            oggetto: 'Nuovo messaggio dal cliente',
            corpo: `${progetto.cliente.nome} ha scritto su «${progetto.nome}»: ${(body.testo || '').slice(0, 120)}`,
            link: `/projects/${progetto.id}`,
          }).catch(() => {});
        }
      }
      // Qui c'era un secondo invio WhatsApp, fatto di nascosto da questa rotta con
      // `process.env.WHATSAPP_ACCESS_TOKEN` e `process.env.WA_PHONE_ID`. Tre guasti in venti
      // righe: il browser spediva già il messaggio per conto suo, quindi al cliente arrivavano
      // due copie identiche; le credenziali erano quelle dell'ambiente e non quelle della riga
      // Tenant, cioè su un'installazione multi-studio il messaggio di un cliente partiva dal
      // numero di un altro studio; e `destinatario` qui è l'etichetta mostrata a schermo
      // («Referente (numero)»), da cui si ricavavano cifre che non erano un numero di telefono.
      // L'esito non veniva nemmeno guardato (`.catch(console.warn)`), quindi un rifiuto di Meta
      // restava invisibile. Questa rotta registra la comunicazione nel fascicolo; la consegna
      // si chiede a `POST /comunicazioni/invia-whatsapp`, che legge le credenziali dello studio
      // e risponde con il motivo quando WhatsApp non accetta.

      return reply.code(201).send(msg);
    } catch {
      return reply.code(201).send({ ok: true, ...body });
    }
  });

  server.get('/progetti', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const projs = await prisma.progetto.findMany({
        where: { tenantId },
        include: {
          cliente: true,
          giurisdizionePrimaria: true,
          moduli: {
            include: {
              microvoci: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' },
      });
      // §16 — l'avanzamento viaggia già calcolato: il client lo legge, non lo deduce.
      // `arricchisciProgetti` non emette query, lavora sui moduli e micro-voci appena letti.
      if (projs && projs.length > 0) return arricchisciProgetti(projs);
      return (app as any).listaProgetti?.() || [];
    } catch {
      return (app as any).listaProgetti?.() || [];
    }
  });

  /**
   * §2.8 — Numero progressivo della lettera d'incarico per tenant e anno: `EL-<anno>-<seq>`.
   *
   * Prima il portale mostrava a tutti lo stesso numero cablato (`EL-2026-089`). Il numero
   * invece è un atto per cliente: il backend lo assegna alla creazione del progetto,
   * leggendo l'ultimo progressivo già usato dal tenant nell'anno corrente. La migrazione
   * `20260824130000_portale_dati_addendum_contratto` ha già numerato i progetti esistenti.
   */
  async function prossimoNumeroContratto(tenantId: string): Promise<string> {
    const anno = new Date().getUTCFullYear();
    const prefisso = `EL-${anno}-`;
    const esistenti = await prisma.progetto.findMany({
      where: { tenantId, numeroContratto: { startsWith: prefisso } },
      select: { numeroContratto: true },
    });
    let max = 0;
    for (const p of esistenti) {
      const coda = (p.numeroContratto ?? '').slice(prefisso.length);
      const n = parseInt(coda, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
    return `${prefisso}${String(max + 1).padStart(3, '0')}`;
  }

  server.post<{ Body: { clienteId: string; nome: string; giurisdizioneId?: string; giurisdizionePrimariaId?: string; dataInizio?: string; dataScadenza?: string } }>('/progetti', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { clienteId, nome, giurisdizioneId, giurisdizionePrimariaId } = req.body;
    if (!clienteId || !nome) return reply.code(400).send({ errore: 'clienteId e nome sono obbligatori' });

    const jurId = giurisdizionePrimariaId || giurisdizioneId || null;

    try {
      const progetto = await prisma.progetto.create({
        data: {
          tenantId,
          clienteId,
          nome,
          stato: 'pre_project',
          // Il valore nasce a 0 e lo alza l'accettazione del preventivo (§16): il campo è
          // obbligatorio a schema, ometterlo impediva la compilazione con `tsc`.
          valoreTotale: 0,
          giurisdizionePrimariaId: jurId,
          // §2.8 — il numero del contratto è assegnato dal backend, non dal frontend.
          numeroContratto: await prossimoNumeroContratto(tenantId),
        },
        include: { cliente: true, giurisdizionePrimaria: true }
      });
      return reply.code(201).send(progetto);
    } catch {
      const progetto = await app.creaProgetto({ clienteId, nome });
      return reply.code(201).send(progetto);
    }
  });

  /**
   * Il dettaglio del progetto, con l'avanzamento calcolato (§16).
   *
   * Qui c'era una `Map` in memoria (`projectStateStore`) che conservava l'ultimo corpo inviato
   * dal client e lo sovrapponeva alla lettura da database. Faceva danni in tre modi: si azzerava
   * a ogni rilascio, quindi lo "stato salvato" scompariva senza che nessuno lo sapesse; era
   * locale al processo, quindi due istanze rispondevano cose diverse; e restituiva come dato di
   * database quello che il client aveva mandato, coprendo il fatto che a database non era mai
   * arrivato. Ora si legge quello che c'è scritto, e se non c'è scritto niente si vede.
   */
  server.get<{ Params: { id: string } }>('/progetti/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      const dbProj: any = await app.getProgetto(id);
      if (!dbProj) return reply.code(404).send({ errore: `Progetto ${id} non trovato` });
      return reply.send({ ...dbProj, avanzamento: calcolaAvanzamento(dbProj) });
    } catch (err) {
      console.warn(`Lettura progetto ${id} non riuscita:`, err);
      return reply.code(404).send({ errore: 'Progetto non trovato' });
    }
  });

  // §1.1 (PIANO_DI_MIGLIORAMENTO) — l'eliminazione transazionale esisteva già
  // nell'adapter (PrismaApp.eliminaProgetto) ma non era esposta via HTTP: il frontend
  // chiamava DELETE /progetti/:id e riceveva 404. La rotta riusa quell'unica
  // implementazione (niente logica duplicata): progetto inesistente → 404, blocco in
  // presenza di Fatture/Note di Credito → 409 (TransizioneNonValidaError); entrambi
  // sono tradotti dal gestore centrale degli errori. Come le altre scritture
  // distruttive (es. /progetti/:id/ricalcola) è riservata a chi risponde dello studio.
  server.delete<{ Params: { id: string } }>('/progetti/:id', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || TENANT_DEFAULT;

    const ruoloRichiedente = (req as any).ruolo as string | undefined;
    if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
      return reply
        .code(403)
        .send({ errore: 'Solo il responsabile dello studio può eliminare un progetto.' });
    }

    await app.eliminaProgetto(id, tenantId);

    await recordAudit({
      tenantId,
      userId: (req as any).user?.userId,
      userEmail: (req as any).user?.email,
      ruolo: ruoloRichiedente,
      azione: 'PROGETTO_ELIMINATO',
      entita: 'Progetto',
      dettagli: `Progetto ${id} eliminato`,
      ipAddress: req.ip,
    });

    return reply.send({ ok: true, id });
  });

  /**
   * DELETE /progetti/:id/moduli/:moduloId — §1.1bis
   *
   * Rimuove un singolo modulo (con tutte le sue micro-voci e documenti) da un progetto.
   * Bloccato con 409 se il modulo ha ore consuntivate: si perderebbe la storia operativa.
   * Solo advisor e super_admin possono eseguire questa operazione.
   */
  server.delete<{ Params: { id: string; moduloId: string } }>(
    '/progetti/:id/moduli/:moduloId',
    async (req, reply) => {
      const { id, moduloId } = req.params;
      const tenantId = (req as any).tenantId || TENANT_DEFAULT;
      const ruoloRichiedente = (req as any).ruolo as string | undefined;

      if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
        return reply.code(403).send({ errore: 'Solo advisor e super_admin possono eliminare moduli da un progetto.' });
      }

      const modulo = await prisma.moduloProgetto.findFirst({
        where: { id: moduloId, progettoId: id, tenantId },
        include: {
          microvoci: { select: { id: true, oreConsuntivate: true, nome: true } },
        },
      });

      if (!modulo) {
        return reply.code(404).send({ errore: 'Modulo non trovato in questo progetto.' });
      }

      const totaleOreConsuntivate = modulo.microvoci.reduce(
        (acc, mv) => acc + (mv.oreConsuntivate ?? 0),
        0,
      );
      if (totaleOreConsuntivate > 0) {
        return reply.code(409).send({
          errore: `Il modulo «${modulo.nome}» ha ${totaleOreConsuntivate} ore consuntivate e non può essere eliminato. Azzerare prima le ore.`,
        });
      }

      // Un modulo già richiamato in fattura è memoria fiscale: non si elimina.
      const righeFattura = await prisma.fatturaRiga.count({ where: { moduloProgettoId: moduloId } });
      if (righeFattura > 0) {
        return reply.code(409).send({
          errore: `Il modulo «${modulo.nome}» è richiamato in ${righeFattura} righe di fattura e non può essere eliminato.`,
        });
      }

      // Senza questa pulizia il delete moriva con 500: micro-voci, passaggi, accessi e
      // dipendenze referenziano il modulo con FK senza CASCADE, quindi anche un modulo
      // appena istanziato (micro-voci a zero ore) non era cancellabile. Si toglie solo lo
      // scaffolding: i documenti prodotti dai passaggi restano nel fascicolo
      // (microvoce_progetto_id → NULL via ON DELETE SET NULL), le checklist cascano a DB.
      try {
        await prisma.$transaction(async (tx) => {
          const microvoceIds = modulo.microvoci.map((mv) => mv.id);
          await tx.accessoRisorsa.deleteMany({
            where: {
              OR: [{ moduloProgettoId: moduloId }, ...(microvoceIds.length ? [{ microvoceProgettoId: { in: microvoceIds } }] : [])],
            },
          });
          if (microvoceIds.length) {
            await tx.passaggioProgetto.deleteMany({ where: { microvoceProgettoId: { in: microvoceIds } } });
            await tx.microvoceProgetto.deleteMany({ where: { id: { in: microvoceIds } } });
          }
          await tx.moduloProgettoDipendenza.deleteMany({
            where: { OR: [{ moduloProgettoId: moduloId }, { dipendeDaModuloProgettoId: moduloId }] },
          });
          await tx.moduloProgetto.delete({ where: { id: moduloId } });
        });
      } catch (err) {
        req.log.error(err, 'Errore eliminazione modulo');
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione modulo' });
      }

      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        userEmail: (req as any).user?.email,
        ruolo: ruoloRichiedente,
        azione: 'MODULO_ELIMINATO',
        entita: 'ModuloProgetto',
        dettagli: `Modulo ${moduloId} («${modulo.nome}») eliminato dal progetto ${id}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, moduloId });
    },
  );

  /**
   * §16 — Ricalcolo esplicito della cascata micro-voce → modulo → progetto (Fase 1, task 1.3).
   *
   * Serve dopo un'importazione, una correzione manuale a database o il rilascio di una
   * modifica alle regole: i normali percorsi (consuntivazione, completamento) aggiornano già
   * lo stato mano a mano, ma niente rimette in pari le righe scritte fuori da quei percorsi.
   *
   * Il nome della route resta in italiano come tutte le altre di questo file (`/progetti`,
   * `/clienti`): il piano lo chiamava `/projects/:id/recalculate`.
   */
  server.post<{ Params: { id: string } }>('/progetti/:id/ricalcola', async (req, reply) => {
    const { id } = req.params;
    const tenantId = (req as any).tenantId || TENANT_DEFAULT;

    // Il ricalcolo SCRIVE (stati di moduli e micro-voci): non è una lettura e non lo autorizza
    // il fatto di essere entrati. RLS confina la scrittura al tenant, ma dentro il tenant
    // qualunque collaboratore potrebbe riallineare gli stati del progetto di un altro: qui
    // decide chi risponde dello studio. Il filtro nel frontend (pulsante nascosto in
    // ProjectDetail.tsx) è solo cortesia di interfaccia, non è questa difesa.
    const ruoloRichiedente = (req as any).ruolo as string | undefined;
    if (ruoloRichiedente !== 'super_admin' && ruoloRichiedente !== 'advisor') {
      return reply
        .code(403)
        .send({ errore: 'Solo il responsabile dello studio o il super admin possono ricalcolare l\'avanzamento.' });
    }

    const avanzamento = await ricalcolaProgetto(id);

    await recordAudit({
      tenantId,
      azione: 'PROGETTO_RICALCOLATO',
      entita: id,
      dettagli: `Ricalcolo stato progetto ${id}: ${avanzamento.stato}, ${avanzamento.percentuale}%`,
      ipAddress: req.ip,
    });

    return reply.send(avanzamento);
  });

  /**
   * Salva su database lo stato di un progetto così come l'operatore l'ha modificato.
   *
   * Prima questa funzione scriveva il corpo della richiesta in una `Map` in memoria e aggiornava
   * a database soltanto tre campi del progetto — nome, stato e valore. **Moduli e micro-voci non
   * venivano mai salvati.** Le ore consuntivate, gli stati delle micro-voci e le note di causa
   * restavano nel browser di chi le aveva scritte e nella memoria del processo, che si azzera a
   * ogni rilascio. Chi apriva lo stesso progetto da un'altra postazione — o il cliente dal
   * portale, che legge il database — vedeva il progetto fermo a come era stato istanziato.
   *
   * Il `catch` peggiorava le cose: rispondeva `ok: true` con «memorizzato in fallback locale»
   * anche quando la scrittura era andata male, quindi il frontend non aveva modo di accorgersene.
   *
   * Cosa viene salvato e cosa no, per scelta:
   *
   * - **si salva** quello che l'operatore inserisce: ore consuntivate e preventivate, stato della
   *   micro-voce, causa del ritardo, nome e prezzo del modulo, nome e valore del progetto.
   * - **non si salva** quello che il motore calcola (§16): lo stato del modulo e la percentuale
   *   di avanzamento arrivano dalla cascata micro-voce → modulo → progetto, che gira in fondo a
   *   questa funzione. Accettarli dal client vorrebbe dire lasciargli riscrivere un valore
   *   derivato con uno che ha calcolato per conto suo.
   * - **non ha una colonna** il blocco note libero della micro-voce (`note`) e resta dove sta
   *   oggi, in `localStorage`. Va aggiunto allo schema, non finto qui.
   *
   * Le righe si riconoscono per identificativo di database (`dbId`), che il frontend porta con
   * sé da quando legge il progetto. Per i progetti salvati prima di questa modifica il `dbId`
   * non c'è: si ripiega sul nome, ma solo quando è univoco — due moduli omonimi non si possono
   * distinguere e la riga viene dichiarata non salvata invece di aggiornare quella sbagliata.
   */
  server.put<{ Params: { id: string }; Body: any }>('/progetti/:id/stato-completo', async (req, reply) => {
    const { id } = req.params;
    const body: any = req.body || {};
    const tenantId = (req as any).tenantId || TENANT_DEFAULT;

    const progetto = await prisma.progetto.findUnique({
      where: { id },
      include: {
        moduli: {
          select: {
            id: true,
            nome: true,
            microvoci: { select: { id: true, nome: true, ordine: true, stato: true, causaNota: true } },
          },
        },
      },
    });

    if (!progetto) {
      return reply.code(404).send({
        errore:
          `Il progetto ${id} non esiste a database: le modifiche non sono state salvate. ` +
          'Se il progetto è stato creato mentre la sessione era scaduta esiste solo in questo browser e va ricreato.',
      });
    }

    /** Righe che non si è potuto salvare, con il motivo. Non vengono mai passate sotto silenzio. */
    const nonSalvate: string[] = [];
    let moduliSalvati = 0;
    let microvociSalvate = 0;

    const modsRichiesti: any[] = Array.isArray(body.mods) ? body.mods : [];

    for (const mod of modsRichiesti) {
      const perNome = progetto.moduli.filter(
        (m) => m.nome.trim().toLowerCase() === String(mod.n ?? '').trim().toLowerCase(),
      );
      const riga =
        (mod.dbId ? progetto.moduli.find((m) => m.id === mod.dbId) : undefined) ||
        (perNome.length === 1 ? perNome[0] : undefined);

      if (!riga) {
        nonSalvate.push(
          perNome.length > 1
            ? `modulo «${mod.n}»: a database ce ne sono ${perNome.length} con lo stesso nome e la richiesta non porta l'identificativo`
            : `modulo «${mod.n ?? '(senza nome)'}»: nessun modulo corrispondente a database`,
        );
        continue;
      }

      const datiModulo: any = {};
      if (typeof mod.n === 'string' && mod.n.trim() && mod.n.trim() !== riga.nome) datiModulo.nome = mod.n.trim();
      if (Number.isFinite(mod.h)) datiModulo.orePreventivate = Math.max(0, Math.round(Number(mod.h)));
      if (Number.isFinite(mod.a)) datiModulo.oreConsuntivate = Math.max(0, Math.round(Number(mod.a)));
      if (Number.isFinite(mod.p)) datiModulo.prezzo = Math.max(0, Math.round(Number(mod.p) * 100));

      if (Object.keys(datiModulo).length > 0) {
        await prisma.moduloProgetto.update({ where: { id: riga.id }, data: datiModulo });
        moduliSalvati++;
      }

      const microRichieste: any[] = Array.isArray(mod.v) ? mod.v : [];
      for (let indice = 0; indice < microRichieste.length; indice++) {
        const mv = microRichieste[indice];
        const mvPerNome = riga.microvoci.filter(
          (r) => r.nome.trim().toLowerCase() === String(mv.n ?? '').trim().toLowerCase(),
        );
        // L'indice è l'ultimo appiglio: l'elenco nel frontend nasce dall'ordine con cui le
        // micro-voci arrivano da database, quindi le posizioni combaciano finché nessuno ne
        // aggiunge o toglie. Vale come ripiego, non come regola: per questo viene dopo il
        // nome, e il nome dopo l'identificativo.
        const rigaMv =
          (mv.dbId ? riga.microvoci.find((r) => r.id === mv.dbId) : undefined) ||
          (mvPerNome.length === 1 ? mvPerNome[0] : undefined) ||
          (riga.microvoci.length === microRichieste.length ? riga.microvoci[indice] : undefined);

        if (!rigaMv) {
          nonSalvate.push(
            `micro-voce «${mv.n ?? indice + 1}» del modulo «${riga.nome}»: nessuna riga corrispondente a database`,
          );
          continue;
        }

        const datiMv: any = {};
        if (Number.isFinite(mv.hE)) datiMv.orePreventivate = Math.max(0, Math.round(Number(mv.hE)));
        if (Number.isFinite(mv.hA)) datiMv.oreConsuntivate = Math.max(0, Math.round(Number(mv.hA)));

        const causa = typeof mv.vn === 'string' && mv.vn.trim() ? mv.vn.trim() : null;
        if (causa !== rigaMv.causaNota) datiMv.causaNota = causa;

        if (typeof mv.s === 'string' && STATI_MICROVOCE.includes(mv.s) && mv.s !== rigaMv.stato) {
          // §7bis — «in ritardo» e «bloccata» senza causa non sono uno stato, sono un buco nel
          // fascicolo: chi legge il progetto un mese dopo non sa perché si è fermato.
          if ((mv.s === 'delayed' || mv.s === 'blocked') && !(causa || rigaMv.causaNota)) {
            nonSalvate.push(
              `micro-voce «${rigaMv.nome}»: lo stato «${mv.s === 'delayed' ? 'in ritardo' : 'bloccata'}» richiede la causa (§7bis) e la richiesta non la porta`,
            );
          } else {
            datiMv.stato = mv.s;
          }
        }

        if (Object.keys(datiMv).length > 0) {
          await prisma.microvoceProgetto.update({ where: { id: rigaMv.id }, data: datiMv });
          microvociSalvate++;
        }

        // Persistenza dei passaggi checklist e documenti allegati alla micro-voce
        if (Array.isArray(mv.proc) && mv.proc.length > 0) {
          try {
            for (let pIdx = 0; pIdx < mv.proc.length; pIdx++) {
              const p = mv.proc[pIdx];
              const pId = p.id && !String(p.id).startsWith('p-') && p.id.length > 10 ? p.id : undefined;
              const tipo = ['documento', 'form', 'info', 'check'].includes(p.type || p.tipo) ? (p.type || p.tipo) : 'check';
              const chi = ['operatore', 'cliente'].includes(p.who || p.chi) ? (p.who || p.chi) : 'operatore';
              const statoP = p.stato === 'done' ? 'done' : 'pending';
              const titolo = p.title || p.titolo || `Passaggio ${pIdx + 1}`;
              const docAllegato = p.documentoAllegatoUrl || p.file || null;
              const richiedeFirma = Boolean(p.richiedeFirmaCliente);
              // Piano firma §3.1 — il livello (ses|fea|feq) che il singolo passaggio esige
              // per la conferma firmata del modulo. Valori non validi si scartano: un
              // client che manda dati sporchi non deve sovrascrivere il livello esistente.
              const livelloRichiesta = typeof p.livelloFirmaRichiesto === 'string' && livelloFirmaValido(p.livelloFirmaRichiesto)
                ? p.livelloFirmaRichiesto
                : undefined;

              if (pId) {
                await prisma.passaggioProgetto.upsert({
                  where: { id: pId },
                  update: {
                    titolo,
                    tipo,
                    chi,
                    stato: statoP,
                    ordine: pIdx,
                    descrizione: p.desc || p.descrizione || null,
                    documentoAllegatoUrl: docAllegato,
                    richiedeFirmaCliente: richiedeFirma,
                    ...(livelloRichiesta && { livelloFirmaRichiesto: livelloRichiesta }),
                  },
                  create: {
                    id: pId,
                    tenantId,
                    microvoceProgettoId: rigaMv.id,
                    titolo,
                    tipo,
                    chi,
                    stato: statoP,
                    ordine: pIdx,
                    descrizione: p.desc || p.descrizione || null,
                    documentoAllegatoUrl: docAllegato,
                    richiedeFirmaCliente: richiedeFirma,
                    livelloFirmaRichiesto: livelloRichiesta ?? 'ses',
                  },
                });
              } else {
                await prisma.passaggioProgetto.create({
                  data: {
                    tenantId,
                    microvoceProgettoId: rigaMv.id,
                    titolo,
                    tipo,
                    chi,
                    stato: statoP,
                    ordine: pIdx,
                    descrizione: p.desc || p.descrizione || null,
                    documentoAllegatoUrl: docAllegato,
                    richiedeFirmaCliente: richiedeFirma,
                    livelloFirmaRichiesto: livelloRichiesta ?? 'ses',
                  },
                });
              }
            }
          } catch (errPassaggi) {
            console.warn(`Errore salvataggio passaggi per micro-voce ${rigaMv.id}:`, errPassaggi);
          }
        }
      }
    }

    const datiProgetto: any = {};
    if (typeof body.n === 'string' && body.n.trim() && body.n.trim() !== progetto.nome) {
      datiProgetto.nome = body.n.trim();
    }
    if (Number.isFinite(body.val)) datiProgetto.valoreTotale = Math.max(0, Math.round(Number(body.val) * 100));
    // Lo stato del progetto si accetta solo per far uscire un progetto da `pre_project`: da lì
    // in poi lo calcola la cascata in fondo a questa funzione, e prenderlo dal client
    // significherebbe sovrascrivere il risultato con una stima fatta nel browser.
    if (progetto.stato === 'pre_project' && typeof body.st === 'string' && STATI_PROGETTO.includes(body.st) && body.st !== 'pre_project') {
      datiProgetto.stato = body.st;
    }
    if (Object.keys(datiProgetto).length > 0) {
      await prisma.progetto.update({ where: { id }, data: datiProgetto });
    }

    // §16 — la cascata risale dopo la scrittura: ore nuove significano segnale di rischio,
    // stato del modulo e stato del progetto da rifare.
    let avanzamento: any = null;
    try {
      avanzamento = await ricalcolaProgetto(id);
    } catch (err) {
      console.warn(`Ricalcolo avanzamento non riuscito per il progetto ${id}:`, err);
    }

    await recordAudit({
      tenantId,
      azione: 'PROGETTO_STATO_AGGIORNATO',
      entita: id,
      dettagli:
        `Progetto «${datiProgetto.nome || progetto.nome}»: ${moduliSalvati} moduli e ${microvociSalvate} micro-voci aggiornati` +
        (nonSalvate.length ? `; ${nonSalvate.length} righe non salvate` : ''),
      ipAddress: req.ip,
    });

    // Il corpo dice quante righe sono finite a database e quali no. Un `ok: true` senza numeri
    // era indistinguibile da un salvataggio che non aveva scritto niente.
    return reply.send({
      ok: true,
      id,
      moduliSalvati,
      microvociSalvate,
      nonSalvate,
      avanzamento,
    });
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

  // ── TIMESHEET SETTIMANALE (BLOCCO 6.1) ─────────────────────────────
  // Griglia delle ore registrate per membro × giorno: ogni operatore segna
  // le proprie ore in stato `bozza`; advisor/super_admin le approvano o le
  // rifiutano. Solo le ore approvate alimentano il report "Ore per Operatore"
  // (Blocco 5, reportsService). Nessuna squadra finta: i membri della griglia
  // sono gli utenti reali del tenant.

  const MS_SETTIMANA = 7 * 24 * 60 * 60 * 1000;
  const MS_GIORNO = 24 * 60 * 60 * 1000;

  /** Data YYYY-MM-DD → Date a mezzanotte UTC, oppure null se non valida. */
  function parseDataIso(iso: string | undefined): Date | null {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const parti = iso.split('-').map(Number);
    const data = new Date(Date.UTC(parti[0] ?? 0, (parti[1] ?? 1) - 1, parti[2] ?? 1));
    if (Number.isNaN(data.getTime())) return null;
    // Difesa da date ambigue tipo 2026-02-30 che Date farebbe slittare a marzo.
    if (data.getUTCFullYear() !== parti[0] || data.getUTCMonth() !== (parti[1] ?? 1) - 1 || data.getUTCDate() !== parti[2]) return null;
    return data;
  }

  /** Lunedì (UTC) della settimana che contiene la data; senza data, settimana corrente. */
  function lunediSettimana(iso?: string): Date | null {
    let base: Date;
    if (iso !== undefined) {
      const trovata = parseDataIso(iso);
      if (!trovata) return null;
      base = trovata;
    } else {
      const oggi = new Date();
      base = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), oggi.getUTCDate()));
    }
    const giornoSettimana = base.getUTCDay(); // 0 = domenica
    const delta = giornoSettimana === 0 ? -6 : 1 - giornoSettimana;
    base.setUTCDate(base.getUTCDate() + delta);
    return base;
  }

  const isoData = (d: Date): string => d.toISOString().slice(0, 10);

  server.get<{ Querystring: { inizio?: string } }>('/timesheet', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    const ruolo = (req as any).ruolo as string | undefined;
    const inizio = lunediSettimana(req.query.inizio);
    if (!inizio) {
      return reply.code(400).send({ errore: 'Parametro inizio non valido: usare una data YYYY-MM-DD' });
    }
    const fine = new Date(inizio.getTime() + MS_SETTIMANA);
    const puoApprovare = ruolo === 'advisor' || ruolo === 'super_admin';
    if (!puoApprovare && !userId) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }

    try {
      const voci = await prisma.oraTimesheet.findMany({
        where: {
          tenantId,
          giorno: { gte: inizio, lt: fine },
          // Chi non approva vede solo le proprie registrazioni: la griglia
          // completa del team è una vista da responsabile.
          ...(puoApprovare ? {} : { userId }),
        },
        orderBy: { giorno: 'asc' },
        include: {
          approvatoDa: { select: { nome: true } },
          rifiutatoDa: { select: { nome: true } },
          progetto: { select: { nome: true } },
        },
      });
      const membri = await prisma.user.findMany({
        where: puoApprovare ? { tenantId, ruolo: { not: 'cliente' } } : { id: userId },
        select: { id: true, nome: true, email: true, ruolo: true, specializzazione: true },
        orderBy: { createdAt: 'asc' },
      });
      const progetti = await prisma.progetto.findMany({
        where: { tenantId },
        select: { id: true, nome: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return reply.send({
        inizio: isoData(inizio),
        fine: isoData(new Date(fine.getTime() - MS_GIORNO)),
        puoApprovare,
        membri,
        progetti,
        voci: voci.map((v) => ({
          id: v.id,
          userId: v.userId,
          giorno: isoData(v.giorno),
          minuti: v.minuti,
          stato: v.stato,
          nota: v.nota,
          progettoId: v.progettoId,
          nomeProgetto: v.progetto?.nome ?? null,
          motivoRifiuto: v.motivoRifiuto,
          approvatoDa: v.approvatoDa?.nome ?? null,
          approvatoAt: v.approvatoAt,
        })),
      });
    } catch (err: any) {
      console.error('GET /timesheet —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel caricamento del timesheet' });
    }
  });

  // Upsert della propria giornata: minuti=0 svuota la cella. Le ore già
  // approvate sono intoccabili (409); una riga rifiutata torna in bozza e si
  // può correggere. L'unicità (tenant, utente, giorno) rende l'operazione
  // idempotente sulla stessa cella.
  server.post<{ Body: { giorno?: string; minuti?: number; nota?: string; progettoId?: string | null } }>('/timesheet', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    if (!userId) {
      return reply.code(401).send({ errore: 'Non autenticato' });
    }
    const { giorno: giornoIso, minuti, nota, progettoId } = req.body || {};
    const giorno = parseDataIso(giornoIso);
    if (!giorno) {
      return reply.code(400).send({ errore: 'Campo giorno non valido: usare una data YYYY-MM-DD' });
    }
    if (typeof minuti !== 'number' || !Number.isFinite(minuti) || minuti < 0 || minuti > 24 * 60) {
      return reply.code(400).send({ errore: 'Campo minuti non valido: numero tra 0 e 1440' });
    }
    const minutiArrotondati = Math.round(minuti);

    try {
      if (progettoId) {
        const progetto = await prisma.progetto.findUnique({ where: { id: progettoId }, select: { tenantId: true } });
        if (!progetto || progetto.tenantId !== tenantId) {
          return reply.code(400).send({ errore: 'Progetto non trovato nel tenant' });
        }
      }

      const esistente = await prisma.oraTimesheet.findUnique({
        where: { tenantId_userId_giorno: { tenantId, userId, giorno } },
      });
      if (esistente?.stato === 'approvato') {
        return reply.code(409).send({ errore: 'Queste ore sono già state approvate: chiedi al responsabile per modificarle.' });
      }

      if (minutiArrotondati === 0) {
        if (esistente) {
          await prisma.oraTimesheet.delete({ where: { id: esistente.id } });
        }
        return reply.send({ eliminata: true, giorno: isoData(giorno) });
      }

      const dati = {
        minuti: minutiArrotondati,
        nota: typeof nota === 'string' && nota.trim() ? nota.trim().slice(0, 500) : null,
        progettoId: progettoId || null,
        // Ogni (ri)registrazione riparte dalla bozza: anche dopo un rifiuto.
        stato: 'bozza' as const,
        motivoRifiuto: null,
        rifiutatoDaId: null,
        approvatoDaId: null,
        approvatoAt: null,
      };
      const salvata = esistente
        ? await prisma.oraTimesheet.update({ where: { id: esistente.id }, data: dati })
        : await prisma.oraTimesheet.create({ data: { ...dati, tenantId, userId, giorno } });
      return reply.send(salvata);
    } catch (err: any) {
      console.error('POST /timesheet —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel salvataggio delle ore' });
    }
  });

  const soloChiApprova = (ruolo: string | undefined, reply: any): boolean => {
    if (ruolo === 'advisor' || ruolo === 'super_admin') return true;
    reply.code(403).send({ errore: 'Solo il responsabile dello studio o il super admin possono approvare le ore.' });
    return false;
  };

  server.post<{ Params: { id: string } }>('/timesheet/:id/approva', async (req, reply) => {
    if (!soloChiApprova((req as any).ruolo as string | undefined, reply)) return;
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    try {
      // RLS limita già al tenant: una riga di un altro tenant qui non arriva.
      const voce = await prisma.oraTimesheet.findUnique({ where: { id: req.params.id } });
      if (!voce || voce.tenantId !== tenantId) {
        return reply.code(404).send({ errore: 'Registrazione non trovata' });
      }
      if (voce.stato === 'approvato') {
        return reply.code(409).send({ errore: 'Registrazione già approvata' });
      }
      const aggiornata = await prisma.oraTimesheet.update({
        where: { id: voce.id },
        data: { stato: 'approvato', approvatoDaId: userId ?? null, approvatoAt: new Date(), motivoRifiuto: null, rifiutatoDaId: null },
      });
      return reply.send(aggiornata);
    } catch (err: any) {
      console.error('POST /timesheet/:id/approva —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nell\'approvazione delle ore' });
    }
  });

  server.post<{ Params: { id: string }; Body: { motivo?: string } }>('/timesheet/:id/rifiuta', async (req, reply) => {
    if (!soloChiApprova((req as any).ruolo as string | undefined, reply)) return;
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId as string | undefined;
    try {
      const voce = await prisma.oraTimesheet.findUnique({ where: { id: req.params.id } });
      if (!voce || voce.tenantId !== tenantId) {
        return reply.code(404).send({ errore: 'Registrazione non trovata' });
      }
      if (voce.stato === 'approvato') {
        return reply.code(409).send({ errore: 'Una registrazione già approvata non può essere rifiutata' });
      }
      const motivo = req.body?.motivo;
      const aggiornata = await prisma.oraTimesheet.update({
        where: { id: voce.id },
        data: {
          stato: 'rifiutato',
          motivoRifiuto: typeof motivo === 'string' && motivo.trim() ? motivo.trim().slice(0, 500) : null,
          rifiutatoDaId: userId ?? null,
        },
      });
      return reply.send(aggiornata);
    } catch (err: any) {
      console.error('POST /timesheet/:id/rifiuta —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel rifiuto delle ore' });
    }
  });

  // Approvazione in blocco di tutte le bozze della settimana (opzionalmente di
  // un solo membro): è il bottone "approva settimana" della griglia.
  server.post<{ Body: { inizio?: string; userId?: string } }>('/timesheet/approva-settimana', async (req, reply) => {
    if (!soloChiApprova((req as any).ruolo as string | undefined, reply)) return;
    const tenantId = (req as any).tenantId;
    const userIdRichiedente = (req as any).userId as string | undefined;
    const inizio = lunediSettimana(req.body?.inizio);
    if (!inizio) {
      return reply.code(400).send({ errore: 'Parametro inizio non valido: usare una data YYYY-MM-DD' });
    }
    const fine = new Date(inizio.getTime() + MS_SETTIMANA);
    try {
      const risultato = await prisma.oraTimesheet.updateMany({
        where: {
          tenantId,
          giorno: { gte: inizio, lt: fine },
          stato: 'bozza',
          ...(req.body?.userId ? { userId: req.body.userId } : {}),
        },
        data: { stato: 'approvato', approvatoDaId: userIdRichiedente ?? null, approvatoAt: new Date() },
      });
      return reply.send({ approvate: risultato.count, inizio: isoData(inizio), fine: isoData(new Date(fine.getTime() - MS_GIORNO)) });
    } catch (err: any) {
      console.error('POST /timesheet/approva-settimana —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nell\'approvazione della settimana' });
    }
  });

  // ── ASSEGNAZIONE AUTOMATICA OPERATORE (BLOCCO 6.2) ─────────────────
  // Suggerimento per l'assegnazione di moduli/micro-voci: prima la
  // specializzazione (corrispondenza con la categoria del lavoro), poi il
  // minor carico: ore registrate nella settimana corrente + ore residue sulle
  // voci aperte già assegnate. Nessun dato inventato: se il tenant non ha
  // utenti la risposta è un elenco vuoto.
  server.get<{ Querystring: { categoria?: string } }>('/operatori-suggeriti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const categoria = (req.query.categoria || '').trim().toLowerCase();
    try {
      const inizio = lunediSettimana();
      const fine = inizio ? new Date(inizio.getTime() + MS_SETTIMANA) : null;
      const utenti = await prisma.user.findMany({
        where: { tenantId, ruolo: { not: 'cliente' }, stato: { not: 'disattivato' } },
        select: { id: true, nome: true, ruolo: true, specializzazione: true },
        orderBy: { createdAt: 'asc' },
      });
      if (utenti.length === 0) {
        return reply.send({ criterio: 'specializzazione + minor carico di lavoro', categoria: categoria || null, suggeriti: [] });
      }
      const ids = utenti.map((u) => u.id);

      // Carico: ore già registrate questa settimana (tutti gli stati — il lavoro
      // è comunque fatto) + ore da fare sulle voci aperte assegnate.
      const registrazioniSettimana = await prisma.oraTimesheet.groupBy({
        by: ['userId'],
        where: { tenantId, userId: { in: ids }, ...(fine ? { giorno: { gte: inizio!, lt: fine } } : {}) },
        _sum: { minuti: true },
      });
      const vociAperte = await prisma.microvoceProgetto.groupBy({
        by: ['risorsaId'],
        where: { tenantId, risorsaId: { in: ids }, stato: { not: 'done' } },
        _sum: { orePreventivate: true, oreConsuntivate: true },
      });
      const oreSettimanaPerUtente = new Map(registrazioniSettimana.map((r) => [r.userId, (r._sum.minuti ?? 0) / 60]));
      const residuePerUtente = new Map(
        vociAperte.map((v) => [v.risorsaId ?? '', Math.max(0, (v._sum.orePreventivate ?? 0) - (v._sum.oreConsuntivate ?? 0))]),
      );

      const righe = utenti.map((u) => {
        const specializzazione = (u.specializzazione || '').trim().toLowerCase();
        const corrisponde = Boolean(categoria) && Boolean(specializzazione) &&
          (specializzazione.includes(categoria) || categoria.includes(specializzazione));
        const oreSettimana = oreSettimanaPerUtente.get(u.id) ?? 0;
        const oreResidue = residuePerUtente.get(u.id) ?? 0;
        const caricoOre = Math.round((oreSettimana + oreResidue) * 10) / 10;
        return {
          id: u.id,
          nome: u.nome,
          ruolo: u.ruolo,
          specializzazione: u.specializzazione || null,
          corrisponde,
          oreSettimana: Math.round(oreSettimana * 10) / 10,
          oreResidue: Math.round(oreResidue * 10) / 10,
          caricoOre,
        };
      });
      righe.sort(
        (a, b) =>
          Number(b.corrisponde) - Number(a.corrisponde) ||
          a.caricoOre - b.caricoOre ||
          a.nome.localeCompare(b.nome),
      );
      return reply.send({ criterio: 'specializzazione + minor carico di lavoro', categoria: categoria || null, suggeriti: righe });
    } catch (err: any) {
      console.error('GET /operatori-suggeriti —', err instanceof Error ? err.message : err);
      return reply.code(500).send({ errore: 'Errore nel calcolo degli operatori suggeriti' });
    }
  });

  // ── RICERCA GLOBALE (BLOCCO 4) ─────────────────────────────────────
  // Ricerca trasversale server-side (ILIKE + indici trigram) su clienti,
  // progetti, fatture, documenti, team, calendario e retainer. Sempre
  // limitata al tenant della richiesta. Minimo 2 caratteri per evitare
  // scansioni inutili su prefissi di un solo carattere.
  server.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return reply.code(400).send({ errore: 'Inserisci almeno 2 caratteri per la ricerca' });
    }
    try {
      const gruppi = await ricercaGlobale(tenantId, q);
      const totale = gruppi.reduce((s, g) => s + g.risultati.length, 0);
      return reply.send({ query: q, totale, gruppi });
    } catch (err: any) {
      console.error(`Errore ricerca globale ("${q}"):`, err);
      return reply.code(500).send({ errore: err?.message || 'Errore durante la ricerca' });
    }
  });

  // ── CHECKLIST SOP COMPLIANCE (STYLE OPENSTAMANAGER) ───────────────
  server.get<{ Params: { passaggioId: string } }>('/passaggi/:passaggioId/checklist', async (req, reply) => {
    try {
      const voci = await (prisma as any).checklistVoce.findMany({
        where: { passaggioProgettoId: req.params.passaggioId },
        orderBy: { titolo: 'asc' },
      });
      return reply.send(voci);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{
    Params: { passaggioId: string };
    Body: { titolo: string; obbligatorio?: boolean };
  }>('/passaggi/:passaggioId/checklist', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { passaggioId } = req.params;
    const { titolo, obbligatorio } = req.body;

    if (!titolo) return reply.code(400).send({ errore: 'Titolo voce checklist obbligatorio' });

    try {
      const voce = await (prisma as any).checklistVoce.create({
        data: {
          tenantId,
          passaggioProgettoId: passaggioId,
          titolo,
          obbligatorio: obbligatorio ?? false,
        },
      });
      return reply.code(201).send(voce);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore creazione voce checklist' });
    }
  });

  server.patch<{ Params: { id: string } }>('/checklist/:id/toggle', async (req, reply) => {
    try {
      const voce = await (prisma as any).checklistVoce.findUnique({ where: { id: req.params.id } });
      if (!voce) return reply.code(404).send({ errore: 'Voce non trovata' });

      const updated = await (prisma as any).checklistVoce.update({
        where: { id: req.params.id },
        data: {
          completato: !voce.completato,
          completatoAt: !voce.completato ? new Date() : null,
        },
      });
      return reply.send(updated);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore aggiornamento checklist' });
    }
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
}
