// §41 — La cartella dei modelli dello studio: quali carte esistono, e se sono state revisionate.
//
// Le quattro rotte `/documenti-template` vivevano in testa a `routes/documenti.ts`, che è a
// ~1000 righe e ha un altro mestiere (il fascicolo del progetto). Qui sono spostate senza
// cambio di contratto — stessi percorsi, stessi verbi, stessi corpi — e completate con quello
// che mancava: lo stato di revisione, l'archiviazione a database, l'adozione dei modelli di
// serie e la traccia di chi ha deciso (regola 8 per lo spostamento, regola 3 per il resto).
//
// Cosa mancava, in concreto. L'archiviazione di un modello viveva in `localStorage` del browser
// (`bluman_archived_template_ids`): un modello archiviato dal computer del titolare restava
// attivo su tutti gli altri e riappariva svuotando la cache. Non era un dato dello studio, era
// una preferenza di quel browser — e la regola 7 dice che un pulsante che scrive solo in
// localStorage non ha salvato niente. Lo stato di revisione, poi, non esisteva affatto: in
// elenco un modello abbozzato e uno riletto dal titolare erano identici.
//
// La decisione su cosa può diventare cosa sta in `services/revisioneModello.ts`, presidiato a
// parte e senza database. Qui si leggono le righe, si scrive e si verbalizza.

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { livelloFirmaValido } from '../services/livelloFirmaService.js';
import {
  decidiRevisione,
  descriviRevisione,
  descriviDecadenza,
  effettoModifica,
  etichettaStato,
} from '../services/revisioneModello.js';

/** I campi che l'interfaccia legge di un modello. Il testo completo c'è: serve all'editor. */
const CAMPI_MODELLO = {
  id: true,
  titolo: true,
  categoria: true,
  descrizione: true,
  contenutoHtml: true,
  livelloFirmaRichiesto: true,
  statoRevisione: true,
  versione: true,
  noteRevisione: true,
  revisionatoDaUserId: true,
  revisionatoDaNome: true,
  revisionatoAt: true,
  archiviatoAt: true,
  riferimentoSerie: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Il nome di chi sta operando, per scriverlo sulla riga.
 *
 * Il payload del token porta `userId`, `email` e `ruolo` ma NON il nome (vedi `signJwt` in
 * `routes/auth.ts`), quindi il nome si rilegge dall'utenza. Se la lettura non riesce si
 * restituisce `null` e la riga porta solo l'id: un nome inventato in un registro è peggio di
 * un campo vuoto, perché sembra una prova.
 */
async function nomeOperatore(userId: unknown): Promise<string | null> {
  if (typeof userId !== 'string' || !userId) return null;
  try {
    const utente = await prisma.user.findFirst({ where: { id: userId }, select: { nome: true } });
    return utente?.nome ?? null;
  } catch {
    return null;
  }
}

export async function registraRotteModelliDocumento(server: FastifyInstance): Promise<void> {
  /**
   * GET /documenti-template
   *
   * L'elenco dei modelli dello studio. Per default esclude gli archiviati — sono fuori dagli
   * elenchi operativi, non cancellati — e li include con `?includiArchiviati=1`.
   *
   * Nessun `catch` che risponde `[]`: era la forma precedente, e trasformava un guasto di
   * lettura in «lo studio non ha modelli». Sono due cose diverse e vanno dette diverse
   * (regola 7): chi legge questa rotta deve poter distinguere il vuoto dal silenzio.
   */
  server.get<{ Querystring: { includiArchiviati?: string } }>('/documenti-template', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const includiArchiviati = req.query?.includiArchiviati === '1' || req.query?.includiArchiviati === 'true';
    try {
      const modelli = await prisma.modelloDocumentoCustom.findMany({
        where: { tenantId, ...(includiArchiviati ? {} : { archiviatoAt: null }) },
        select: CAMPI_MODELLO,
        orderBy: [{ categoria: 'asc' }, { titolo: 'asc' }],
      });
      return reply.send(modelli);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura modelli documento' });
    }
  });

  server.post<{
    Body: {
      titolo: string;
      categoria?: string;
      descrizione?: string;
      contenutoHtml: string;
      livelloFirmaRichiesto?: string;
      riferimentoSerie?: string | null;
    };
  }>('/documenti-template', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const { titolo, categoria, descrizione, contenutoHtml, livelloFirmaRichiesto, riferimentoSerie } = req.body;
    if (livelloFirmaRichiesto !== undefined && !livelloFirmaValido(livelloFirmaRichiesto)) {
      return reply.code(400).send({ errore: 'livelloFirmaRichiesto non valido: i valori ammessi sono ses, fea, feq.' });
    }
    try {
      const nuovo = await prisma.modelloDocumentoCustom.create({
        data: {
          tenantId,
          titolo: titolo || 'Nuovo Modello Documento',
          categoria: categoria || 'contratto',
          descrizione: descrizione || '',
          contenutoHtml: contenutoHtml || '',
          // Piano §3.1 — il livello scelto sul template viene copiato sul documento alla
          // generazione (POST /documenti/genera); 'ses' se lo studio non lo specifica.
          livelloFirmaRichiesto: livelloFirmaRichiesto ?? 'ses',
          // §41 — un modello nasce sempre in bozza: nessuno lo ha ancora riletto, e dire
          // altro sarebbe un'attestazione che nessuno ha dato.
          riferimentoSerie: (riferimentoSerie ?? '').trim() || null,
        },
        select: CAMPI_MODELLO,
      });
      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        userEmail: (req as any).user?.email,
        userNome: await nomeOperatore((req as any).userId),
        ruolo: (req as any).ruolo,
        azione: 'MODELLO_DOCUMENTO_CREATO',
        entita: `Modello #${nuovo.id}`,
        dettagli: `Creato nuovo modello «${nuovo.titolo}» nella cartella modelli dello studio (stato ${etichettaStato('bozza')})`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(nuovo);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore creazione modello' });
    }
  });

  /**
   * PUT /documenti-template/:id — modifica del modello.
   *
   * Qui sta la regola che §41 aggiunge: se il TESTO di un modello approvato cambia,
   * l'approvazione decade, il modello torna in bozza e la versione sale. Lasciare
   * l'approvazione appesa a un contenuto diverso da quello approvato sarebbe peggio di non
   * averla: in elenco sembrerebbe una garanzia.
   *
   * Il `where` porta il tenant. RLS isola gli studi fra loro, ma un id di un altro studio
   * arriverebbe qui e produrrebbe un errore Prisma «record not found» invece di un 404 chiaro.
   */
  server.put<{
    Params: { id: string };
    Body: { titolo?: string; categoria?: string; descrizione?: string; contenutoHtml?: string; livelloFirmaRichiesto?: string };
  }>('/documenti-template/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const { id } = req.params;
    const { titolo, categoria, descrizione, contenutoHtml, livelloFirmaRichiesto } = req.body;
    if (livelloFirmaRichiesto !== undefined && !livelloFirmaValido(livelloFirmaRichiesto)) {
      return reply.code(400).send({ errore: 'livelloFirmaRichiesto non valido: i valori ammessi sono ses, fea, feq.' });
    }
    try {
      const attuale = await prisma.modelloDocumentoCustom.findFirst({
        where: { id, tenantId },
        select: { id: true, titolo: true, contenutoHtml: true, statoRevisione: true, versione: true },
      });
      if (!attuale) return reply.code(404).send({ errore: 'Modello non trovato.' });

      const contenutoCambiato = contenutoHtml !== undefined && contenutoHtml !== attuale.contenutoHtml;
      const effetto = effettoModifica({
        statoAttuale: attuale.statoRevisione,
        versioneAttuale: attuale.versione,
        contenutoCambiato,
      });

      const aggiornato = await prisma.modelloDocumentoCustom.update({
        where: { id: attuale.id },
        data: {
          ...(titolo && { titolo }),
          ...(categoria && { categoria }),
          ...(descrizione !== undefined && { descrizione }),
          ...(contenutoHtml !== undefined && { contenutoHtml }),
          ...(livelloFirmaRichiesto !== undefined && { livelloFirmaRichiesto }),
          ...(effetto.approvazioneDecaduta
            ? {
                statoRevisione: effetto.stato,
                versione: effetto.versione,
                // L'approvazione precedente non vale più: chi la aveva data non ha visto
                // questo testo. Lasciare il suo nome sulla riga lo farebbe sembrare l'autore
                // di un'approvazione che non ha dato.
                revisionatoDaUserId: null,
                revisionatoDaNome: null,
                revisionatoAt: null,
                noteRevisione: null,
              }
            : {}),
        },
        select: CAMPI_MODELLO,
      });

      if (effetto.approvazioneDecaduta) {
        await recordAudit({
          tenantId,
          userId: (req as any).userId,
          userEmail: (req as any).user?.email,
          userNome: await nomeOperatore((req as any).userId),
          ruolo: (req as any).ruolo,
          azione: 'MODELLO_DOCUMENTO_APPROVAZIONE_DECADUTA',
          entita: `Modello #${aggiornato.id}`,
          dettagli: descriviDecadenza(aggiornato.titolo, effetto.versione),
          ipAddress: req.ip,
        });
      }

      return reply.send({ ...aggiornato, approvazioneDecaduta: effetto.approvazioneDecaduta });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento modello' });
    }
  });

  /**
   * PATCH /documenti-template/:id/revisione — «questo testo l'ha riletto qualcuno?».
   *
   * È la rotta che dà senso alla cartella: dopo di questa, l'elenco distingue un modello
   * abbozzato da uno approvato dal titolare, e dice chi lo ha approvato e quando.
   */
  server.patch<{ Params: { id: string }; Body: { stato?: string; note?: string | null } }>(
    '/documenti-template/:id/revisione',
    async (req, reply) => {
      const tenantId = (req as any).tenantId;
      if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

      const { id } = req.params;
      const { stato, note } = req.body ?? {};
      try {
        const attuale = await prisma.modelloDocumentoCustom.findFirst({
          where: { id, tenantId },
          select: { id: true, titolo: true, statoRevisione: true },
        });
        if (!attuale) return reply.code(404).send({ errore: 'Modello non trovato.' });

        const esito = decidiRevisione(attuale.statoRevisione, stato);
        if (!esito.ok || !esito.stato) return reply.code(esito.codice ?? 400).send({ errore: esito.errore });

        const nome = await nomeOperatore((req as any).userId);
        const noteRipulite = (note ?? '').trim() || null;
        const aggiornato = await prisma.modelloDocumentoCustom.update({
          where: { id: attuale.id },
          data: {
            statoRevisione: esito.stato,
            noteRevisione: noteRipulite,
            revisionatoDaUserId: (req as any).userId ?? null,
            revisionatoDaNome: nome,
            revisionatoAt: new Date(),
          },
          select: CAMPI_MODELLO,
        });

        await recordAudit({
          tenantId,
          userId: (req as any).userId,
          userEmail: (req as any).user?.email,
          userNome: nome,
          ruolo: (req as any).ruolo,
          azione: 'MODELLO_DOCUMENTO_REVISIONATO',
          entita: `Modello #${aggiornato.id}`,
          dettagli: descriviRevisione({ titolo: aggiornato.titolo, da: attuale.statoRevisione, a: esito.stato, note: noteRipulite }),
          ipAddress: req.ip,
        });

        return reply.send(aggiornato);
      } catch (err) {
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore revisione modello' });
      }
    },
  );

  /**
   * PATCH /documenti-template/:id/archiviazione — fuori dagli elenchi operativi, non cancellato.
   *
   * Prima questo gesto scriveva un id in `localStorage`: valeva per quel browser e per nessun
   * altro. Ora è una data sulla riga, quindi vale per lo studio.
   */
  server.patch<{ Params: { id: string }; Body: { archiviato?: boolean } }>(
    '/documenti-template/:id/archiviazione',
    async (req, reply) => {
      const tenantId = (req as any).tenantId;
      if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

      const { id } = req.params;
      const archiviato = req.body?.archiviato;
      if (typeof archiviato !== 'boolean') {
        return reply.code(400).send({ errore: 'Indicare `archiviato`: true per archiviare il modello, false per ripristinarlo.' });
      }
      try {
        const attuale = await prisma.modelloDocumentoCustom.findFirst({
          where: { id, tenantId },
          select: { id: true, titolo: true, archiviatoAt: true },
        });
        if (!attuale) return reply.code(404).send({ errore: 'Modello non trovato.' });

        const giaCosi = archiviato === Boolean(attuale.archiviatoAt);
        if (giaCosi) {
          return reply.code(400).send({
            errore: archiviato
              ? 'Il modello è già archiviato.'
              : 'Il modello è già tra quelli attivi.',
          });
        }

        const aggiornato = await prisma.modelloDocumentoCustom.update({
          where: { id: attuale.id },
          data: { archiviatoAt: archiviato ? new Date() : null },
          select: CAMPI_MODELLO,
        });

        await recordAudit({
          tenantId,
          userId: (req as any).userId,
          userEmail: (req as any).user?.email,
          userNome: await nomeOperatore((req as any).userId),
          ruolo: (req as any).ruolo,
          azione: archiviato ? 'MODELLO_DOCUMENTO_ARCHIVIATO' : 'MODELLO_DOCUMENTO_RIPRISTINATO',
          entita: `Modello #${aggiornato.id}`,
          dettagli: archiviato
            ? `Modello «${aggiornato.titolo}» archiviato: esce dagli elenchi operativi e resta conservato a database`
            : `Modello «${aggiornato.titolo}» ripristinato tra i modelli attivi`,
          ipAddress: req.ip,
        });

        return reply.send(aggiornato);
      } catch (err) {
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore archiviazione modello' });
      }
    },
  );

  /**
   * POST /documenti-template/adotta — il modello di serie entra nella cartella dello studio.
   *
   * I modelli di serie (`PREBUILT_TEMPLATES`, scritti nel codice del frontend) non hanno una
   * riga a database: sono materiale di partenza uguale per tutti gli studi. Finché restano
   * tali non possono portare uno stato di revisione — e infatti l'interfaccia deve dire «di
   * serie, mai revisionato», non «bozza», che sarebbe uno stato inventato.
   *
   * Adottare significa farne una carta dello studio: da quel momento ha una riga, una versione
   * e un revisore. L'operazione è idempotente per via del vincolo unico
   * (tenant_id, riferimento_serie): due operatori che adottano lo stesso modello nello stesso
   * momento ottengono la stessa riga, non due copie.
   */
  server.post<{
    Body: {
      riferimentoSerie: string;
      titolo: string;
      categoria?: string;
      descrizione?: string;
      contenutoHtml: string;
      livelloFirmaRichiesto?: string;
    };
  }>('/documenti-template/adotta', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const { riferimentoSerie, titolo, categoria, descrizione, contenutoHtml, livelloFirmaRichiesto } = req.body ?? ({} as any);
    const riferimento = (riferimentoSerie ?? '').trim();
    if (!riferimento) {
      return reply.code(400).send({ errore: 'Indicare `riferimentoSerie`: è l\'identificativo del modello di serie da adottare.' });
    }
    if (!contenutoHtml || !contenutoHtml.trim()) {
      return reply.code(400).send({ errore: 'Il modello da adottare non ha testo: non c\'è niente da conservare.' });
    }
    if (livelloFirmaRichiesto !== undefined && !livelloFirmaValido(livelloFirmaRichiesto)) {
      return reply.code(400).send({ errore: 'livelloFirmaRichiesto non valido: i valori ammessi sono ses, fea, feq.' });
    }

    try {
      const esistente = await prisma.modelloDocumentoCustom.findFirst({
        where: { tenantId, riferimentoSerie: riferimento },
        select: CAMPI_MODELLO,
      });
      // Già adottato: si restituisce la riga che c'è. Crearne una seconda spezzerebbe lo
      // storico di revisione in due carte identiche.
      if (esistente) return reply.send({ ...esistente, giaAdottato: true });

      const nuovo = await prisma.modelloDocumentoCustom.create({
        data: {
          tenantId,
          titolo: titolo || 'Modello di serie',
          categoria: categoria || 'contratto',
          descrizione: descrizione || '',
          contenutoHtml,
          livelloFirmaRichiesto: livelloFirmaRichiesto ?? 'ses',
          riferimentoSerie: riferimento,
        },
        select: CAMPI_MODELLO,
      });

      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        userEmail: (req as any).user?.email,
        userNome: await nomeOperatore((req as any).userId),
        ruolo: (req as any).ruolo,
        azione: 'MODELLO_DOCUMENTO_ADOTTATO',
        entita: `Modello #${nuovo.id}`,
        dettagli: `Modello di serie «${nuovo.titolo}» (${riferimento}) adottato nella cartella modelli dello studio`,
        ipAddress: req.ip,
      });

      return reply.code(201).send({ ...nuovo, giaAdottato: false });
    } catch (err) {
      // Corsa fra due adozioni simultanee: il vincolo unico (tenant_id, riferimento_serie) ha
      // fatto il suo lavoro. Si rilegge la riga vincente invece di restituire un errore, che
      // per l'operatore sarebbe incomprensibile — il modello, dopo tutto, adesso c'è.
      const codice = (err as any)?.code;
      if (codice === 'P2002') {
        const vincente = await prisma.modelloDocumentoCustom.findFirst({
          where: { tenantId, riferimentoSerie: riferimento },
          select: CAMPI_MODELLO,
        });
        if (vincente) return reply.send({ ...vincente, giaAdottato: true });
      }
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore adozione modello' });
    }
  });

  /**
   * DELETE /documenti-template/:id
   *
   * L'eliminazione resta possibile, ma non è il gesto normale: per togliere un modello dagli
   * elenchi c'è l'archiviazione, che conserva la carta. I documenti già generati o firmati nei
   * progetti sono copie indipendenti e non ne risentono in nessun caso.
   */
  server.delete<{ Params: { id: string } }>('/documenti-template/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const { id } = req.params;
    try {
      const attuale = await prisma.modelloDocumentoCustom.findFirst({
        where: { id, tenantId },
        select: { id: true, titolo: true, statoRevisione: true, versione: true },
      });
      if (!attuale) return reply.code(404).send({ errore: 'Modello non trovato.' });

      await prisma.modelloDocumentoCustom.delete({ where: { id: attuale.id } });

      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        userEmail: (req as any).user?.email,
        userNome: await nomeOperatore((req as any).userId),
        ruolo: (req as any).ruolo,
        azione: 'MODELLO_DOCUMENTO_ELIMINATO',
        entita: `Modello #${attuale.id}`,
        dettagli:
          `Modello «${attuale.titolo}» eliminato definitivamente ` +
          `(stato ${etichettaStato(attuale.statoRevisione as any)}, versione ${attuale.versione}). ` +
          'I documenti già generati nei progetti restano invariati.',
        ipAddress: req.ip,
      });

      return reply.send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione modello' });
    }
  });
}
