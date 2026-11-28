// Accentratore delle mail — la configurazione: le caselle lette e gli inoltri dei clienti.
//
// Permessi (regola 9): oltre al modulo `posta` della matrice, ogni rotta qui ha il controllo
// esplicito del ruolo. Collegare una casella o attivare la raccolta per un cliente è una scelta
// di chi risponde dello studio (advisor, super admin), non di chi smista i messaggi.
//
// La password di una casella entra da qui e non esce più: si salva cifrata
// (`cifraturaSegreti.ts`) e le risposte portano solo `passwordSalvata: true|false`.
import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { cifraSegreto, decifraSegreto } from '../util/cifraturaSegreti.js';
import { validaCartellaImap, validaHost, validaServername } from '../util/networkPolicy.js';
import { spiegaErrorePosta } from '../services/diagnosiPosta.js';
import { lettoreImap } from '../services/postaImap.js';
import { AMBITO_PASSWORD_CASELLA } from '../services/postaRaccolta.js';
import { indirizzoDiInoltro, nuovoAliasPosta } from '../services/postaAttribuzione.js';
import { AggiornaCasellaSchema, CreaCasellaSchema, InoltroClienteSchema, ProvaCasellaSchema } from '../schemas/posta.schema.js';

function soloResponsabili(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.ruolo === 'advisor' || req.ruolo === 'super_admin') return true;
  reply.code(403).send({ errore: 'La configurazione della posta è riservata al responsabile dello studio.' });
  return false;
}

const CAMPI_CASELLA = {
  id: true, nome: true, indirizzo: true, host: true, servername: true, porta: true, utente: true,
  cartella: true, tipo: true, clienteId: true, attiva: true, raccogliDal: true,
  consensoDichiaratoAt: true, ultimaRaccoltaAt: true, ultimoSuccessoAt: true, ultimoErrore: true,
  createdAt: true, passwordCifrata: true,
  cliente: { select: { id: true, nome: true } },
} as const;

/** La casella come esce dalle API: la password diventa un sì/no. */
function senzaPassword<T extends { passwordCifrata: string | null }>(casella: T): Omit<T, 'passwordCifrata'> & { passwordSalvata: boolean } {
  const { passwordCifrata, ...resto } = casella;
  return { ...resto, passwordSalvata: Boolean(passwordCifrata) };
}

/** Host, nome del certificato e cartella passano dalla stessa politica delle altre connessioni di posta. */
function validaDestinazione(d: { host?: string; servername?: string | null; cartella?: string }): string | null {
  try {
    if (d.host !== undefined) validaHost(d.host, 'Server IMAP');
    if (d.servername) validaServername(d.servername);
    if (d.cartella !== undefined) validaCartellaImap(d.cartella);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Configurazione IMAP non valida.';
  }
}

export async function registraRottePostaConfigurazione(server: FastifyInstance): Promise<void> {
  // GET /posta/caselle
  server.get('/posta/caselle', async (req, reply) => {
    if (!soloResponsabili(req, reply)) return reply;
    const tenantId = req.tenantId as string;
    try {
      const caselle = await prisma.casellaPosta.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: CAMPI_CASELLA });
      return reply.send(caselle.map(senzaPassword));
    } catch (err) {
      req.log.error(err, 'Errore lettura caselle di posta');
      return reply.code(500).send({ errore: 'Le caselle non sono state lette.' });
    }
  });

  // POST /posta/caselle — collega una casella (di raccolta, o di un cliente).
  server.post<{ Body: unknown }>('/posta/caselle', async (req, reply) => {
    if (!soloResponsabili(req, reply)) return reply;
    const parse = CreaCasellaSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Casella non valida' });
    const tenantId = req.tenantId as string;
    const c = parse.data;
    const nonValida = validaDestinazione(c);
    if (nonValida) return reply.code(400).send({ errore: nonValida });

    try {
      let nomeCliente: string | null = null;
      if (c.tipo === 'cliente') {
        const cliente = await prisma.cliente.findFirst({ where: { id: c.clienteId as string, tenantId }, select: { nome: true } });
        if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato' });
        nomeCliente = cliente.nome;
      }
      const adesso = new Date();
      const casella = await prisma.casellaPosta.create({
        data: {
          tenantId,
          nome: c.nome,
          indirizzo: c.indirizzo,
          host: c.host,
          servername: c.servername || null,
          porta: c.porta,
          utente: c.utente,
          passwordCifrata: cifraSegreto(c.password, AMBITO_PASSWORD_CASELLA),
          cartella: c.cartella,
          tipo: c.tipo,
          clienteId: c.tipo === 'cliente' ? (c.clienteId as string) : null,
          consensoDichiaratoAt: c.tipo === 'cliente' ? adesso : null,
          consensoDichiaratoDa: c.tipo === 'cliente' ? ((req.userId as string | undefined) ?? null) : null,
          raccogliDal: c.raccogliDal ? new Date(`${c.raccogliDal}T00:00:00.000Z`) : null,
          creataDa: (req.userId as string | undefined) ?? null,
        },
        select: CAMPI_CASELLA,
      });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'POSTA_CASELLA_COLLEGATA',
        entita: 'casella_posta',
        dettagli:
          c.tipo === 'cliente'
            ? `Collegata la casella ${c.indirizzo} del cliente ${nomeCliente}: chi l'ha collegata ha dichiarato l'autorizzazione scritta del cliente alla lettura`
            : `Collegata la casella di raccolta ${c.indirizzo} («${c.nome}»)`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(senzaPassword(casella));
    } catch (err) {
      req.log.error(err, 'Errore collegamento casella di posta');
      return reply.code(500).send({ errore: 'La casella non è stata salvata.' });
    }
  });

  // PATCH /posta/caselle/:id — corregge i dati, cambia la password, mette in pausa.
  server.patch<{ Params: { id: string }; Body: unknown }>('/posta/caselle/:id', async (req, reply) => {
    if (!soloResponsabili(req, reply)) return reply;
    const parse = AggiornaCasellaSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Modifica non valida' });
    const tenantId = req.tenantId as string;
    const m = parse.data;
    const nonValida = validaDestinazione(m);
    if (nonValida) return reply.code(400).send({ errore: nonValida });

    try {
      const attuale = await prisma.casellaPosta.findFirst({ where: { id: req.params.id, tenantId } });
      if (!attuale) return reply.code(404).send({ errore: 'Casella non trovata' });

      const nuovaPassword = m.password ? m.password : undefined;
      if (m.attiva === true && !attuale.passwordCifrata && !nuovaPassword) {
        return reply.code(400).send({ errore: 'Per riattivare la casella serve la password: è stata cancellata quando l’hai scollegata.' });
      }
      // Server, utenza o cartella diversi sono un'altra casella: il segnalibro di prima non vale.
      const altraCasella =
        (m.host !== undefined && m.host !== attuale.host) ||
        (m.utente !== undefined && m.utente !== attuale.utente) ||
        (m.cartella !== undefined && m.cartella !== attuale.cartella);

      const casella = await prisma.casellaPosta.update({
        where: { id: attuale.id },
        data: {
          ...(m.nome !== undefined ? { nome: m.nome } : {}),
          ...(m.indirizzo !== undefined ? { indirizzo: m.indirizzo } : {}),
          ...(m.host !== undefined ? { host: m.host } : {}),
          ...(m.servername !== undefined ? { servername: m.servername || null } : {}),
          ...(m.porta !== undefined ? { porta: m.porta } : {}),
          ...(m.utente !== undefined ? { utente: m.utente } : {}),
          ...(m.cartella !== undefined ? { cartella: m.cartella } : {}),
          ...(m.attiva !== undefined ? { attiva: m.attiva } : {}),
          ...(nuovaPassword ? { passwordCifrata: cifraSegreto(nuovaPassword, AMBITO_PASSWORD_CASELLA), ultimoErrore: null } : {}),
          ...(altraCasella ? { uidValidity: null, ultimoUid: 0 } : {}),
        },
        select: CAMPI_CASELLA,
      });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'POSTA_CASELLA_MODIFICATA',
        entita: 'casella_posta',
        // I nomi dei campi cambiati, mai i valori: fra loro c'è la password.
        dettagli: `Casella ${attuale.indirizzo}: modificati ${Object.keys(m).filter((k) => (m as Record<string, unknown>)[k] !== undefined).join(', ')}`,
        ipAddress: req.ip,
      });
      return reply.send(senzaPassword(casella));
    } catch (err) {
      req.log.error(err, 'Errore modifica casella di posta');
      return reply.code(500).send({ errore: 'La casella non è stata aggiornata.' });
    }
  });

  // POST /posta/caselle/:id/scollega — ferma la raccolta e cancella la password. I messaggi restano.
  server.post<{ Params: { id: string } }>('/posta/caselle/:id/scollega', async (req, reply) => {
    if (!soloResponsabili(req, reply)) return reply;
    const tenantId = req.tenantId as string;
    try {
      const attuale = await prisma.casellaPosta.findFirst({ where: { id: req.params.id, tenantId }, select: { id: true, indirizzo: true } });
      if (!attuale) return reply.code(404).send({ errore: 'Casella non trovata' });
      const casella = await prisma.casellaPosta.update({
        where: { id: attuale.id },
        data: { attiva: false, passwordCifrata: null, ultimoErrore: null },
        select: CAMPI_CASELLA,
      });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'POSTA_CASELLA_SCOLLEGATA',
        entita: 'casella_posta',
        dettagli: `Scollegata la casella ${attuale.indirizzo}: raccolta ferma e password cancellata, i messaggi già raccolti restano`,
        ipAddress: req.ip,
      });
      return reply.send(senzaPassword(casella));
    } catch (err) {
      req.log.error(err, 'Errore scollegamento casella di posta');
      return reply.code(500).send({ errore: 'La casella non è stata scollegata.' });
    }
  });

  // POST /posta/caselle/prova — apre la casella in sola lettura e la richiude, senza salvare niente.
  server.post<{ Body: unknown }>('/posta/caselle/prova', async (req, reply) => {
    if (!soloResponsabili(req, reply)) return reply;
    const parse = ProvaCasellaSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ ok: false, errore: parse.error.issues[0]?.message || 'Dati non validi' });
    const tenantId = req.tenantId as string;
    const p = parse.data;

    let salvata: { host: string; servername: string | null; porta: number; utente: string; cartella: string; passwordCifrata: string | null } | null = null;
    if (p.casellaId) {
      salvata = await prisma.casellaPosta.findFirst({
        where: { id: p.casellaId, tenantId },
        select: { host: true, servername: true, porta: true, utente: true, cartella: true, passwordCifrata: true },
      });
      if (!salvata) return reply.code(404).send({ ok: false, errore: 'Casella non trovata' });
    }

    let password = p.password || '';
    if (!password && salvata?.passwordCifrata) {
      try {
        password = decifraSegreto(salvata.passwordCifrata, AMBITO_PASSWORD_CASELLA).chiaro;
      } catch {
        return reply.code(400).send({ ok: false, errore: 'La password salvata non si legge più con le chiavi di questo ambiente: reinseriscila.' });
      }
    }
    const host = p.host || salvata?.host || '';
    const utente = p.utente || salvata?.utente || '';
    const porta = p.porta ?? salvata?.porta ?? 993;
    const mancanti = [!host && 'il server IMAP', !utente && "l'utenza", !password && 'la password'].filter(Boolean);
    if (mancanti.length) return reply.code(400).send({ ok: false, errore: `Per provare la casella manca ${mancanti.join(', ')}.` });

    const lettore = lettoreImap({
      host,
      servername: p.servername !== undefined ? p.servername : salvata?.servername,
      porta,
      utente,
      password,
      cartella: p.cartella || salvata?.cartella || 'INBOX',
    });
    try {
      await lettore.apri();
      return reply.send({ ok: true, messaggio: 'Casella raggiunta e aperta in sola lettura.' });
    } catch (err) {
      const e = err as { authenticationFailed?: boolean; code?: string; message?: string; responseText?: string };
      const errore = e?.authenticationFailed
        ? `${host} ha rifiutato utenza o password.`
        : spiegaErrorePosta({ protocollo: 'IMAP', host, porta, messaggio: `${e?.code ? `${e.code}: ` : ''}${e?.responseText || e?.message || 'errore non riportato'}`, codice: e?.code });
      return reply.code(400).send({ ok: false, errore });
    } finally {
      await lettore.chiudi();
    }
  });

  // GET /posta/clienti — per ogni cliente: l'inoltro (alias e indirizzo) e le caselle collegate.
  server.get('/posta/clienti', async (req, reply) => {
    if (!soloResponsabili(req, reply)) return reply;
    const tenantId = req.tenantId as string;
    try {
      const [clienti, raccolta] = await Promise.all([
        prisma.cliente.findMany({
          where: { tenantId },
          orderBy: { nome: 'asc' },
          select: { id: true, nome: true, email: true, aliasPosta: true, postaAttivataAt: true },
        }),
        // L'indirizzo di inoltro si costruisce sulla prima casella di raccolta attiva.
        prisma.casellaPosta.findFirst({ where: { tenantId, tipo: 'raccolta', attiva: true }, orderBy: { createdAt: 'asc' }, select: { indirizzo: true } }),
      ]);
      return reply.send({
        casellaDiRaccolta: raccolta?.indirizzo ?? null,
        clienti: clienti.map((c) => ({ ...c, indirizzoInoltro: indirizzoDiInoltro(raccolta?.indirizzo, c.aliasPosta) })),
      });
    } catch (err) {
      req.log.error(err, 'Errore lettura inoltri dei clienti');
      return reply.code(500).send({ errore: 'Gli inoltri dei clienti non sono stati letti.' });
    }
  });

  // POST /posta/clienti/:id/inoltro — attiva (genera l'alias) o disattiva la raccolta per inoltro.
  server.post<{ Params: { id: string }; Body: unknown }>('/posta/clienti/:id/inoltro', async (req, reply) => {
    if (!soloResponsabili(req, reply)) return reply;
    const parse = InoltroClienteSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const tenantId = req.tenantId as string;

    try {
      const cliente = await prisma.cliente.findFirst({ where: { id: req.params.id, tenantId }, select: { id: true, nome: true, aliasPosta: true } });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato' });

      let alias: string | null = null;
      if (parse.data.attivo) {
        // Chi è già attivo tiene il suo alias: cambiarlo spezzerebbe l'inoltro che il cliente ha impostato.
        alias = cliente.aliasPosta;
        for (let tentativo = 0; !alias && tentativo < 5; tentativo++) {
          const candidato = nuovoAliasPosta(randomInt);
          const occupato = await prisma.cliente.findFirst({ where: { tenantId, aliasPosta: candidato }, select: { id: true } });
          if (!occupato) alias = candidato;
        }
        if (!alias) return reply.code(500).send({ errore: 'Non sono riuscito a generare un indirizzo di inoltro libero: riprova.' });
      }

      const aggiornato = await prisma.cliente.update({
        where: { id: cliente.id },
        data: parse.data.attivo
          ? { aliasPosta: alias, ...(cliente.aliasPosta ? {} : { postaAttivataAt: new Date(), postaAttivataDa: (req.userId as string | undefined) ?? null }) }
          : { aliasPosta: null, postaAttivataAt: null, postaAttivataDa: null },
        select: { id: true, nome: true, email: true, aliasPosta: true, postaAttivataAt: true },
      });
      if (Boolean(cliente.aliasPosta) !== parse.data.attivo) {
        await recordAudit({
          tenantId,
          userId: req.userId,
          ruolo: req.ruolo,
          azione: parse.data.attivo ? 'POSTA_INOLTRO_ATTIVATO' : 'POSTA_INOLTRO_DISATTIVATO',
          entita: 'cliente',
          dettagli: parse.data.attivo
            ? `Attivata la raccolta della posta per inoltro del cliente ${cliente.nome}`
            : `Disattivata la raccolta della posta per inoltro del cliente ${cliente.nome}: i messaggi già raccolti restano`,
          ipAddress: req.ip,
        });
      }
      const raccolta = await prisma.casellaPosta.findFirst({ where: { tenantId, tipo: 'raccolta', attiva: true }, orderBy: { createdAt: 'asc' }, select: { indirizzo: true } });
      return reply.send({ ...aggiornato, indirizzoInoltro: indirizzoDiInoltro(raccolta?.indirizzo, aggiornato.aliasPosta) });
    } catch (err) {
      req.log.error(err, 'Errore attivazione inoltro del cliente');
      return reply.code(500).send({ errore: 'L’inoltro del cliente non è stato aggiornato.' });
    }
  });
}
