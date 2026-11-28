// La pagina personale del cliente: a che punto sono i suoi incarichi e cosa tocca a lui, più le
// richieste dello studio (i passaggi «a carico del cliente» di un'attività) e la loro risposta.
//
// Permessi (regola 9), dichiarati rotta per rotta:
//  - GET  /portal/riepilogo                      cliente (il suo), o studio in anteprima con `clienteId`;
//  - POST /portal/richieste/:passaggioId/risposta solo il cliente della pratica;
//  - POST /progetti/:id/richieste-cliente/avviso  studio: sta sotto `/progetti`, modulo «projects» in
//    `rbacModuli.ts` (scrittura), e il cliente è escluso qui sotto.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avvisaClienteRichiesta } from '../services/avvisiCanaleProtetto.js';
import { CANALE_PROTETTO, preparaMessaggioProtetto, rispostaAErroreCanale } from '../services/canaleProtetto.js';
import { statoCifratura } from '../services/cifraturaCanale.js';
import { notificaStudio } from '../services/notificheService.js';
import { controllaRisposte, riepilogoCliente, type ContestoRiepilogo, type FatturaDaPagare, type ProgettoLetto } from '../services/riepilogoCliente.js';
import { rifirmaUrlUpload, rinnovaUrlSupabaseSeServe } from '../services/storageService.js';
import { conContestoInTransazione, prisma } from '../util/prismaClient.js';
import { clienteDellaRichiesta, recordAudit } from '../util/serverHelpers.js';
import { leggiMetaComunicazione } from '../util/statoComunicazione.js';

/** Chi, dallo studio, può aprire l'anteprima del portale di un cliente. */
const RUOLI_ANTEPRIMA = ['super_admin', 'advisor', 'collaboratore_interno', 'operator'];

const SELEZIONE_PASSAGGIO = {
  id: true,
  titolo: true,
  tipo: true,
  chi: true,
  stato: true,
  ordine: true,
  descrizione: true,
  campiFormJson: true,
  risposteFormJson: true,
  risposteClienteJson: true,
  rispostaClienteAt: true,
  documentoAllegatoUrl: true,
  linkIstruzioni: true,
} as const;

const SELEZIONE_PROGETTO = {
  id: true,
  nome: true,
  stato: true,
  numeroContratto: true,
  moduli: {
    select: {
      id: true,
      nome: true,
      categoria: true,
      stato: true,
      orePreventivate: true,
      dipendenze: { select: { dipendeDaModuloProgettoId: true } },
      microvoci: {
        orderBy: { ordine: 'asc' as const },
        select: {
          id: true,
          nome: true,
          stato: true,
          ordine: true,
          orePreventivate: true,
          oreConsuntivate: true,
          passaggi: { orderBy: { ordine: 'asc' as const }, select: SELEZIONE_PASSAGGIO },
        },
      },
      microvociCondivise: {
        select: { microvoceProgetto: { select: { id: true, stato: true, orePreventivate: true, oreConsuntivate: true } } },
      },
    },
  },
} as const;

/** I progetti del cliente come servono al riepilogo. Gli archiviati non si mostrano. */
async function progettiDelCliente(tenantId: string, clienteId: string, soloProgettoId?: string): Promise<ProgettoLetto[]> {
  return prisma.progetto.findMany({
    where: { tenantId, clienteId, stato: { not: 'archived' }, ...(soloProgettoId ? { id: soloProgettoId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: SELEZIONE_PROGETTO,
  });
}

async function contestoDelRiepilogo(tenantId: string, clienteId: string, progetti: ProgettoLetto[]): Promise<ContestoRiepilogo> {
  const idProgetti = progetti.map((p) => p.id);
  const [firme, messaggi, fatture] = await Promise.all([
    // Stesso criterio delle schede «Proposta e firma» e «Avanzamento», dove queste azioni si
    // compiono: una firma vale per il progetto o la fase a cui si riferisce (`riferimentoId`).
    prisma.firmaElettronica.findMany({
      where: { tenantId, clienteId, ambito: { in: ['engagement_letter', 'modulo_completato'] }, riferimentoId: { not: null } },
      select: { ambito: true, riferimentoId: true },
    }),
    prisma.comunicazioneProgetto.findMany({
      where: { tenantId, progettoId: { in: idProgetti }, canale: CANALE_PROTETTO, direzione: 'uscita' },
      select: { progettoId: true, externalId: true },
    }),
    prisma.fattura.findMany({
      where: { tenantId, progettoId: { in: idProgetti }, stato: 'emessa' },
      select: {
        id: true,
        numero: true,
        serie: true,
        numeroProgressivoSerie: true,
        progettoId: true,
        scadenzeIncasso: {
          where: { stato: 'in_attesa' },
          orderBy: { dataScadenza: 'asc' },
          select: { dataScadenza: true, importoCentesimi: true },
          take: 1,
        },
      },
    }),
  ]);

  const messaggiNonLetti = new Map<string, number>();
  for (const m of messaggi) {
    const meta = leggiMetaComunicazione(m.externalId);
    if (meta.stato === 'letto' || meta.lettoAt) continue;
    messaggiNonLetti.set(m.progettoId, (messaggiNonLetti.get(m.progettoId) ?? 0) + 1);
  }

  // «Scaduta» lo dice il server, con la stessa regola di `GET /portal/fatture`: rata non pagata
  // con la data di scadenza prima di oggi.
  const inizioDiOggi = new Date();
  inizioDiOggi.setHours(0, 0, 0, 0);
  const fattureDaPagare: FatturaDaPagare[] = [];
  for (const f of fatture) {
    const rata = f.scadenzeIncasso[0];
    if (!rata || !f.progettoId) continue;
    fattureDaPagare.push({
      id: f.id,
      numero: f.numero || `${f.serie}-${f.numeroProgressivoSerie}`,
      progettoId: f.progettoId,
      dataScadenza: rata.dataScadenza,
      importoCentesimi: rata.importoCentesimi,
      scaduta: rata.dataScadenza < inizioDiOggi,
    });
  }

  // Gli indirizzi dei documenti allegati alle richieste hanno una firma che scade: si rinnova qui,
  // altrimenti una richiesta vecchia di una settimana avrebbe un modulo che non si apre più.
  const indirizzi = new Map<string, string>();
  for (const progetto of progetti) {
    for (const modulo of progetto.moduli) {
      for (const microvoce of modulo.microvoci) {
        for (const passaggio of microvoce.passaggi) {
          const url = passaggio.documentoAllegatoUrl;
          if (passaggio.chi !== 'cliente' || !url || indirizzi.has(url)) continue;
          const rinnovato = await rinnovaUrlSupabaseSeServe(rifirmaUrlUpload(url));
          indirizzi.set(url, typeof rinnovato === 'string' ? rinnovato : url);
        }
      }
    }
  }

  return {
    lettereFirmate: new Set(firme.filter((f) => f.ambito === 'engagement_letter').map((f) => f.riferimentoId as string)),
    fasiConfermate: new Set(firme.filter((f) => f.ambito === 'modulo_completato').map((f) => f.riferimentoId as string)),
    messaggiNonLetti,
    fattureDaPagare,
    indirizzoFile: (url) => indirizzi.get(url) ?? url,
  };
}

const RispostaRichiestaSchema = z.object({
  risposte: z.record(z.string(), z.string().max(2000)).optional().nullable(),
  nota: z.string().max(5000).optional().nullable(),
  allegatiProtetti: z
    .array(z.object({ nome: z.string().min(1).max(200), contentBase64: z.string().max(21_000_000) }))
    .max(5)
    .optional()
    .nullable(),
});

export async function registraRottePortaleRiepilogo(server: FastifyInstance): Promise<void> {
  server.get<{ Querystring: { clienteId?: string } }>('/portal/riepilogo', async (req, reply) => {
    if (req.ruolo !== 'cliente' && !RUOLI_ANTEPRIMA.includes(req.ruolo ?? '')) {
      return reply.code(403).send({ errore: 'Non autorizzato.' });
    }
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, req.query?.clienteId);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    try {
      const progetti = await progettiDelCliente(tenantId, clienteId);
      const contesto = await contestoDelRiepilogo(tenantId, clienteId, progetti);
      const cifratura = statoCifratura();
      return reply.send({
        ok: true,
        // Il portale mostra il lucchetto solo se i messaggi nuovi vengono davvero cifrati.
        canaleProtetto: { cifraturaAttiva: cifratura.attiva, disponibile: cifratura.errore === null },
        progetti: riepilogoCliente(progetti, contesto),
      });
    } catch (err) {
      req.log.error({ err, tenantId }, 'GET /portal/riepilogo — lettura fallita');
      return reply.code(500).send({ errore: 'Non è stato possibile leggere lo stato dei tuoi incarichi. Riprova tra poco.' });
    }
  });

  server.post<{ Params: { passaggioId: string } }>('/portal/richieste/:passaggioId/risposta', async (req, reply) => {
    // Rispondere è un atto del cliente: lo studio registra le risposte dal fascicolo, dove resta
    // scritto che le ha inserite un operatore.
    if (req.ruolo !== 'cliente') return reply.code(403).send({ errore: 'Solo il cliente può rispondere dal portale.' });
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req);
    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    const letto = RispostaRichiestaSchema.safeParse(req.body ?? {});
    if (!letto.success) return reply.code(400).send({ errore: letto.error.issues[0]?.message || 'Risposta non valida.' });
    const corpo = letto.data;

    // La richiesta dev'essere di una pratica di QUESTO cliente in QUESTO studio: l'id di un
    // passaggio altrui non trova niente.
    const passaggio = await prisma.passaggioProgetto.findFirst({
      where: {
        id: req.params.passaggioId,
        tenantId,
        chi: 'cliente',
        microvoceProgetto: { moduloProgetto: { progetto: { clienteId, tenantId } } },
      },
      select: {
        id: true,
        titolo: true,
        tipo: true,
        stato: true,
        campiFormJson: true,
        microvoceProgetto: {
          select: { id: true, nome: true, moduloProgetto: { select: { nome: true, progetto: { select: { id: true, nome: true, cliente: { select: { nome: true } } } } } } },
        },
      },
    });
    if (!passaggio) return reply.code(404).send({ errore: 'Richiesta non trovata.' });
    if (passaggio.stato === 'done') {
      return reply.code(409).send({ errore: 'Lo studio ha già chiuso questa richiesta: per aggiungere qualcosa scrivi nei Messaggi.' });
    }

    const controllo = controllaRisposte(passaggio.campiFormJson, corpo.risposte);
    if (!controllo.ok) return reply.code(400).send({ errore: controllo.errore });
    const allegati = corpo.allegatiProtetti ?? [];
    const nota = (corpo.nota ?? '').trim();
    if (passaggio.tipo === 'documento' && allegati.length === 0) {
      return reply.code(400).send({ errore: 'Questa richiesta aspetta un documento: allega il file prima di inviare.' });
    }
    if (passaggio.tipo === 'form' && Object.keys(controllo.risposte).length === 0 && !nota && allegati.length === 0) {
      return reply.code(400).send({ errore: 'Scrivi la risposta o allega un file prima di inviare.' });
    }

    const progetto = passaggio.microvoceProgetto.moduloProgetto.progetto;
    const microvoce = passaggio.microvoceProgetto;
    const nomeCliente = progetto.cliente.nome;

    // Nota e file viaggiano nel canale protetto, legati all'attività: lo studio li trova nella
    // conversazione della pratica e nella scheda dell'attività, cifrati come ogni altro messaggio.
    let messaggio: { testo: string; allegatiJson: string | null } | null = null;
    if (nota || allegati.length > 0) {
      try {
        messaggio = await preparaMessaggioProtetto(tenantId, progetto.id, {
          testo: nota ? `Risposta alla richiesta «${passaggio.titolo}»\n\n${nota}` : `Risposta alla richiesta «${passaggio.titolo}»`,
          allegatiProtetti: allegati,
        });
      } catch (err) {
        const risposta = rispostaAErroreCanale(err, true);
        if (!risposta) throw err;
        req.log.warn({ err, passaggioId: passaggio.id }, 'risposta del cliente rifiutata dal canale protetto');
        return reply.code(risposta.stato).send({ errore: risposta.errore });
      }
    }

    const adesso = new Date();
    try {
      await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          await tx.passaggioProgetto.update({
            where: { id: passaggio.id },
            // Lo stato del passaggio non cambia: il cliente risponde, l'operatore controlla e chiude.
            data: { risposteClienteJson: controllo.risposte, rispostaClienteAt: adesso },
          });
          if (!messaggio) return;
          const creato = await tx.comunicazioneProgetto.create({
            data: {
              tenantId,
              progettoId: progetto.id,
              canale: CANALE_PROTETTO,
              mittente: `${nomeCliente} (Cliente)`,
              destinatario: 'Studio',
              direzione: 'entrata',
              testo: messaggio.testo,
              allegatiJson: messaggio.allegatiJson,
              chatId: clienteId,
              externalId: JSON.stringify({ stato: 'consegnato', consegnatoAt: adesso.toISOString() }),
            },
          });
          await tx.comunicazioneMicrovoce.create({
            data: { tenantId, comunicazioneId: creato.id, microvoceProgettoId: microvoce.id, origine: 'microvoce' },
          });
        }),
      );
    } catch (err) {
      req.log.error({ err, passaggioId: passaggio.id }, 'POST /portal/richieste/:passaggioId/risposta — salvataggio fallito');
      return reply.code(500).send({ errore: 'La risposta non è stata salvata. Riprova: quello che hai scritto è ancora qui.' });
    }

    await recordAudit({
      tenantId,
      userId: req.userId ?? null,
      userNome: nomeCliente,
      ruolo: req.ruolo,
      azione: 'RICHIESTA_CLIENTE_EVASA',
      entita: `Passaggio ${passaggio.id}`,
      dettagli: `«${passaggio.titolo}» (${microvoce.nome}) — ${Object.keys(controllo.risposte).length} campi, ${allegati.length} allegati, dal portale`,
      ipAddress: req.ip,
    });
    // L'avviso non porta le risposte: dice dove andarle a leggere.
    try {
      await notificaStudio(tenantId, {
        tipoEvento: 'risposta_cliente',
        oggetto: 'Il cliente ha risposto a una richiesta',
        corpo: `${nomeCliente} ha evaso «${passaggio.titolo}» (${microvoce.nome}) su «${progetto.nome}». Controlla e chiudi il passaggio.`,
        link: `/projects/${progetto.id}`,
      });
    } catch (err) {
      req.log.error({ err, passaggioId: passaggio.id }, 'avviso allo studio della risposta non riuscito');
    }
    return reply.send({ ok: true, inviataIl: adesso.toISOString() });
  });

  server.post<{ Params: { id: string } }>('/progetti/:id/richieste-cliente/avviso', async (req, reply) => {
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });
    const tenantId = req.tenantId;
    const progetto = await prisma.progetto.findFirst({
      where: { id: req.params.id, tenantId },
      select: { id: true, nome: true, clienteId: true },
    });
    if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato.' });
    try {
      const [letto] = await progettiDelCliente(tenantId, progetto.clienteId, progetto.id);
      const aperte = letto
        ? riepilogoCliente([letto], {
            lettereFirmate: new Set(),
            fasiConfermate: new Set(),
            messaggiNonLetti: new Map(),
            fattureDaPagare: [],
            indirizzoFile: (url) => url,
          })[0]!.richieste.filter((r) => r.stato === 'da_fare' && r.quando === 'ora').length
        : 0;
      if (aperte === 0) {
        return reply.code(409).send({
          errore: 'Non ci sono richieste aperte da segnalare: il cliente viene avvisato dei passaggi «a carico del cliente» salvati, non ancora evasi, nelle fasi già avviate.',
        });
      }
      await avvisaClienteRichiesta(tenantId, progetto.clienteId, progetto.nome, aperte);
      await recordAudit({
        tenantId,
        userId: req.userId ?? null,
        ruolo: req.ruolo,
        azione: 'RICHIESTE_CLIENTE_SEGNALATE',
        entita: `Progetto ${progetto.id}`,
        dettagli: `${aperte} richieste aperte segnalate al cliente su «${progetto.nome}»`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, richieste: aperte });
    } catch (err) {
      req.log.error({ err, progettoId: progetto.id }, 'POST /progetti/:id/richieste-cliente/avviso — fallito');
      return reply.code(500).send({ errore: 'Il cliente non è stato avvisato. Riprova.' });
    }
  });
}
