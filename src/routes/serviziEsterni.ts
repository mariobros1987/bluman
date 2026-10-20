// Credenziali dei servizi esterni usati dallo studio (KYC/AML e firma).
//
// Perché esistono: il fornitore di visura, quello di screening PEP e il servizio di marca
// temporale non sono ancora scelti, ma la piattaforma deve poterli ricevere senza un nuovo deploy.
// Ogni studio ha il proprio contratto e le proprie credenziali, quindi i valori stanno nel
// database per tenant, non in una variabile d'ambiente della piattaforma.
//
// Regole di uscita (regola 6): il segreto NON torna mai al browser. La lettura restituisce solo
// `segretoConfigurato` e una coda mascherata. Il registro di compliance annota *che* una
// credenziale è stata aggiornata, mai il suo valore: `calcolaHashEvento` firma il payload, e un
// segreto lì dentro resterebbe scritto per sempre nella catena append-only.
//
// L'endpoint è una URL che il server chiamerà: è configurazione di un responsabile dello studio
// (advisor/super_admin), non un input pubblico. La validazione qui impedisce refusi e protocolli
// inattesi; la fiducia nell'host è quella che l'amministratore ha deciso di dare al fornitore.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../util/prismaClient.js';
import { registraComplianceEvent } from '../services/complianceEventLog.js';
import { verificaCollegamentoTsa } from '../services/marcaTemporaleService.js';

export const SERVIZI_ESTERNI = {
  kyc_visura: {
    etichetta: 'Visura / Registro Imprese',
    descrizione: 'Recupero della visura e del titolare effettivo dalla partita IVA.',
  },
  kyc_screening: {
    etichetta: 'Screening PEP e liste sanzioni',
    descrizione: 'Controllo del nominativo sulle liste PEP, sanzioni e media negativi.',
  },
  tsa: {
    etichetta: 'Marca temporale (RFC 3161)',
    descrizione: 'Prova dell’ora esatta della firma apposta sui documenti.',
  },
} as const;

export type ServizioEsternoKey = keyof typeof SERVIZI_ESTERNI;
export const CHIAVI_SERVIZIO = Object.keys(SERVIZI_ESTERNI) as ServizioEsternoKey[];

type RigaCredenziale = {
  servizio: string;
  etichetta: string | null;
  endpoint: string | null;
  username: string | null;
  segreto: string | null;
  extra: unknown;
  aggiornatoDa: string | null;
  updatedAt: Date;
};

type DatiAggiornamento = {
  endpoint?: string | null;
  username?: string | null;
  etichetta?: string | null;
  segreto?: string | null;
  extra?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  aggiornatoDa?: string | null;
};

/**
 * Maschera il segreto lasciando visibili le ultime 4 cifre. Meno di 8 caratteri non ha una coda
 * abbastanza anonima: si mostra solo la maschera. Il valore completo non lascia mai il server.
 */
export function mascheraSegreto(segreto: string | null | undefined): string | null {
  if (!segreto) return null;
  const coda = segreto.length >= 8 ? segreto.slice(-4) : '';
  return coda ? `••••••••${coda}` : '••••••••';
}

/** Forma pubblica di una riga: nessun valore segreto, solo stato e coda mascherata. */
export function servizioPubblico(servizio: ServizioEsternoKey, riga: RigaCredenziale | null) {
  return {
    servizio,
    etichetta: SERVIZI_ESTERNI[servizio].etichetta,
    descrizione: SERVIZI_ESTERNI[servizio].descrizione,
    endpoint: riga?.endpoint ?? null,
    username: riga?.username ?? null,
    segretoMascherato: mascheraSegreto(riga?.segreto),
    segretoConfigurato: Boolean(riga?.segreto),
    extra: (riga?.extra as Record<string, unknown> | null) ?? null,
    aggiornatoDa: riga?.aggiornatoDa ?? null,
    updatedAt: riga?.updatedAt ? riga.updatedAt.toISOString() : null,
  };
}

function urlAmmessa(valore: string): boolean {
  try {
    const u = new URL(valore);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function registraRotteServiziEsterni(server: FastifyInstance): Promise<void> {
  const soloResponsabile = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
      reply.code(403).send({ errore: 'Le credenziali dei servizi esterni sono riservate al responsabile dello studio.' });
      return true;
    }
    return false;
  };

  // Lettura: elenco completo dei servizi noti. Quelli mai configurati tornano con i campi vuoti,
  // così l'interfaccia non deve indovinare quali card mostrare.
  server.get('/tenant/servizi-esterni', async (req, reply) => {
    if (soloResponsabile(req, reply)) return;
    const righe = await prisma.credenzialeServizioEsterno.findMany({ where: { tenantId: req.tenantId } });
    const perServizio = new Map(righe.map((r) => [r.servizio, r as unknown as RigaCredenziale]));
    return reply.send({ servizi: CHIAVI_SERVIZIO.map((s) => servizioPubblico(s, perServizio.get(s) ?? null)) });
  });

  // Scrittura di UNA credenziale. La semantica del segreto è quella delle altre impostazioni:
  //   · campo assente  → invariato (il browser non lo rimanda perché non lo riceve)
  //   · stringa vuota  → cancella il segreto salvato
  //   · maschera (••••) → invariato, nel caso l'interfaccia rimandi indietro ciò che ha letto
  //   · altro          → sostituisce il segreto
  server.put<{ Params: { servizio: string }; Body: Record<string, unknown> }>(
    '/tenant/servizi-esterni/:servizio',
    async (req, reply) => {
      if (soloResponsabile(req, reply)) return;
      const servizio = req.params.servizio as ServizioEsternoKey;
      if (!CHIAVI_SERVIZIO.includes(servizio)) {
        return reply.code(404).send({ errore: 'Servizio esterno non riconosciuto.' });
      }

      const b = (req.body || {}) as Record<string, unknown>;
      const dati: DatiAggiornamento = {};

      if (b.endpoint !== undefined) {
        const v = b.endpoint === null ? '' : String(b.endpoint).trim();
        if (v.length > 500) return reply.code(400).send({ errore: 'Indirizzo del servizio troppo lungo.' });
        if (v && !urlAmmessa(v)) return reply.code(400).send({ errore: 'L’indirizzo del servizio deve iniziare con https:// o http://.' });
        dati.endpoint = v || null;
      }
      if (b.username !== undefined) {
        const v = b.username === null ? '' : String(b.username).trim();
        if (v.length > 200) return reply.code(400).send({ errore: 'Nome utente troppo lungo.' });
        dati.username = v || null;
      }
      if (b.etichetta !== undefined) {
        const v = b.etichetta === null ? '' : String(b.etichetta).trim();
        if (v.length > 120) return reply.code(400).send({ errore: 'Etichetta troppo lunga.' });
        dati.etichetta = v || null;
      }
      if (b.extra !== undefined) {
        if (b.extra !== null && (typeof b.extra !== 'object' || Array.isArray(b.extra))) {
          return reply.code(400).send({ errore: 'I parametri aggiuntivi devono essere un oggetto JSON.' });
        }
        if (b.extra !== null && JSON.stringify(b.extra).length > 4000) {
          return reply.code(400).send({ errore: 'Parametri aggiuntivi troppo lunghi.' });
        }
        dati.extra = b.extra === null ? Prisma.DbNull : (b.extra as Prisma.InputJsonValue);
      }
      if (b.segreto !== undefined) {
        const v = b.segreto === null ? '' : String(b.segreto);
        if (v === '') {
          dati.segreto = null;
        } else if (v.startsWith('••')) {
          // Maschera rimandata indietro dall'interfaccia: il segreto vero resta quello salvato.
        } else if (v.length > 4000) {
          return reply.code(400).send({ errore: 'Il segreto è troppo lungo.' });
        } else {
          dati.segreto = v;
        }
      }

      dati.aggiornatoDa = req.userId ?? null;
      const riga = await prisma.credenzialeServizioEsterno.upsert({
        where: { tenantId_servizio: { tenantId: req.tenantId, servizio } },
        update: dati,
        create: { tenantId: req.tenantId, servizio, ...dati },
      });

      // Il payload dice QUALI campi sono cambiati, non i loro valori. Un segreto scritto qui
      // resterebbe nella catena append-only per sempre, e la catena non si riscrive.
      await registraComplianceEvent(prisma, {
        tenantId: req.tenantId,
        tipo: 'SERVIZIO_ESTERNO_CONFIGURATO',
        attoreUserId: req.userId ?? null,
        payload: { servizio, campi: Object.keys(dati).filter((k) => k !== 'aggiornatoDa') },
      });

      return reply.send({ ok: true, servizio: servizioPubblico(servizio, riga as unknown as RigaCredenziale) });
    },
  );

  // Prova di collegamento della TSA: marca un'impronta casuale e non conserva nulla.
  // Serve a distinguere «indirizzo salvato» da «la TSA risponde davvero». Usa le credenziali
  // SALVATE, non quelle eventualmente digitate ma non ancora salvate nella scheda.
  server.post('/tenant/servizi-esterni/tsa/verifica', async (req, reply) => {
    if (soloResponsabile(req, reply)) return;

    let esito;
    try {
      esito = await verificaCollegamentoTsa(req.tenantId);
    } catch (err) {
      return reply.code(503).send({
        ok: false,
        errore: `Credenziali TSA non leggibili: ${err instanceof Error ? err.message : 'errore del database'}.`,
      });
    }

    // Il token restituito dalla prova non serve a nessun documento: non si rimanda al browser.
    return reply.send({
      ok: esito.ok,
      stato: esito.stato,
      endpoint: esito.endpoint,
      genTime: esito.genTime,
      policy: esito.policy,
      serialNumber: esito.serialNumber,
      hashVerificato: esito.hashVerificato,
      avviso: esito.avviso,
      errore: esito.errore,
    });
  });
}
