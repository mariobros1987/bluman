// Rotte anagrafica clienti: dettaglio, magic link, CRUD portale — §2, §14, §23.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. Nel monolite vivevano in DUE punti diversi (il
// dettaglio con magic-link era in coda al blocco ARTICOLI, l'anagrafica completa
// più sotto): qui sono riunite nell'ordine di registrazione originale.
// `registraRotteClienti` viene chiamata DENTRO il wrapper `server.register(...)`
// di `buildServer`, quindi il rate-limit e l'hook auth onRequest continuano ad
// applicarsi esattamente come prima (stesso contesto di incapsulamento, nessuna
// nuova barriera).

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma, conContestoInTransazione } from '../util/prismaClient.js';
import { generateMagicToken, hashMagicToken } from '../util/jwt.js';
import { hashPassword, generaPasswordTemporanea } from '../util/password.js';
import { sendMagicLinkEmail, sendClientCredentialsEmail } from '../services/emailService.js';
import {
  pulisciRecapito,
  canaleOtpValido,
  GIORNI_VALIDITA_MAGIC_LINK,
  baseUrlApplicazione,
  recordAudit,
} from '../util/serverHelpers.js';
import { CreaClienteSchema } from '../schemas/clienti.schema.js';
import { chatIdTelegram } from '../services/telegramService.js';
import { clienteIdDalJwt, richiediRuolo } from '../util/authorization.js';
import { campoOrdinamento, creaMetaPaginazione, leggiPaginazione } from '../util/paginazione.js';

// ─── DETTAGLIO CLIENTE & MAGIC LINK (coda dell'ex blocco ARTICOLI) ──
export async function registraRotteClienti(server: FastifyInstance, app: AppPort): Promise<void> {
  const sanitizzaReferenti = (valore: unknown): Record<string, any> => {
    if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return {};
    const { passwordHash: _passwordHash, password: _password, ...referenti } = valore as Record<string, any>;
    return referenti;
  };

  const serializzaCliente = (cliente: any) => {
    const referenti = sanitizzaReferenti(cliente.referentiJson);
    const { passwordHash: _passwordHash, password: _password, ...clienteSicuro } = cliente;
    return {
      ...referenti,
      ...clienteSicuro,
      referentiJson: referenti,
      email: cliente.email || referenti.email || '',
      hasPassword: Boolean(cliente.passwordHash),
      codiceFiscale: cliente.codiceFiscale || referenti.codiceFiscale || referenti.codFisc,
      codFisc: cliente.codiceFiscale || referenti.codiceFiscale || referenti.codFisc,
      sdiCode: cliente.sdiCode || referenti.sdiCode || referenti.codiceSdi || '',
      codiceSdi: cliente.sdiCode || referenti.sdiCode || referenti.codiceSdi || '',
      iban: cliente.iban || referenti.iban,
      piva: cliente.piva || referenti.piva,
      sedeLegale: cliente.sedeLegale || referenti.sedeLegale,
      giurisdizione: cliente.giurisdizione || referenti.giurisdizione,
      rischioAml: cliente.rischioAml || referenti.rischioAml || 'medio',
      ubo: cliente.ubo || referenti.ubo,
      fontePatrimonio: cliente.fontePatrimonio || referenti.fontePatrimonio,
      dataKyc: cliente.dataKyc || referenti.dataKyc,
    };
  };

  server.get<{ Params: { id: string } }>('/clienti/:id', async (req, reply) => {
    if (req.ruolo === 'cliente') {
      const clienteId = clienteIdDalJwt(req.user);
      if (!clienteId || req.params.id !== clienteId) {
        return reply.code(404).send({ errore: 'Cliente non trovato' });
      }
    }
    try {
      const c = await prisma.cliente.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (c) return reply.send(serializzaCliente(c));
      if (req.ruolo === 'cliente') return reply.code(404).send({ errore: 'Cliente non trovato' });
      return app.getCliente(req.params.id);
    } catch {
      if (req.ruolo === 'cliente') return reply.code(503).send({ errore: 'Anagrafica non disponibile' });
      return app.getCliente(req.params.id);
    }
  });

  server.post<{ Params: { id: string }; Body: { email?: string } }>('/clienti/:id/magic-link', async (req, reply) => {
    if (!richiediRuolo(req, reply, ['advisor', 'super_admin'])) return reply;
    const tenantId = req.tenantId as string;

    try {
      const cliente = await prisma.cliente.findUnique({ where: { id: req.params.id } });
      if (!cliente) {
        return reply.code(404).send({ errore: 'Cliente non trovato' });
      }

      const toEmail = req.body?.email?.trim();
      if (!toEmail) {
        return reply.code(400).send({ errore: "Indirizzo email del destinatario obbligatorio" });
      }

      const magicToken = generateMagicToken(cliente.id);
      const scadenza = new Date(Date.now() + GIORNI_VALIDITA_MAGIC_LINK * 24 * 60 * 60 * 1000);

      await prisma.magicLink.create({
        data: {
          tenantId,
          clienteId: cliente.id,
          tokenHash: hashMagicToken(magicToken),
          scadenza,
          email: toEmail,
        },
      });

      const magicUrl = `${baseUrlApplicazione()}/portal?magic_token=${magicToken}`;

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const customSmtp = tenant?.smtpHost && tenant?.smtpUser && tenant?.smtpPass ? {
        host: tenant.smtpHost,
        servername: tenant.smtpServername || undefined,
        port: tenant.smtpPort || 465,
        secure: tenant.smtpSecure ?? true,
        user: tenant.smtpUser,
        pass: tenant.smtpPass,
        fromEmail: tenant.smtpFromEmail || tenant.smtpUser,
        fromName: tenant.smtpFromName || tenant.ragioneSociale || 'BluMan Advisory',
      } : undefined;

      const esitoInvio = await sendMagicLinkEmail(toEmail, cliente.nome, magicUrl, customSmtp);
      await recordAudit({
        tenantId,
        azione: 'MAGIC_LINK_GENERATO',
        entita: cliente.nome,
        dettagli: `Generato Magic Link per l'accesso passwordless del cliente (${toEmail}), valido fino al ${scadenza.toISOString()}`,
        ipAddress: req.ip,
      });

      // `sent: false` da solo non dice niente a chi sta guardando lo schermo: il motivo
      // dell'invio mancato arriva insieme, così l'operatore sa se deve correggere le
      // impostazioni della casella o mandare il link a mano.
      return {
        ok: true,
        sent: esitoInvio.ok,
        erroreInvio: esitoInvio.ok ? undefined : esitoInvio.errore,
        magicUrl,
        magicToken,
        scadenza: scadenza.toISOString(),
      };
    } catch (err: any) {
      req.log.error({ tenantId: req.tenantId, err: err instanceof Error ? err.message : err }, 'GET /clienti — errore generazione magic link');
      return reply.code(500).send({ errore: err.message || 'Errore generazione Magic Link' });
    }
  });

  // ─── ANAGRAFICA CLIENTI ERP API (§2, §14) ─────────────────────────
  server.get('/clienti', async (req, reply) => {
    const tenantId = req.tenantId;
    const paginazione = leggiPaginazione(req.query);
    if (paginazione.paginata && 'errore' in paginazione) {
      return reply.code(400).send({ errore: paginazione.errore });
    }

    try {
      if (!paginazione.paginata) {
        const clienti = await prisma.cliente.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
        return clienti.map(serializzaCliente);
      }

      const { page, limit, search, sortBy, sortOrder, tipo, skip } = paginazione.parametri;
      const campo = campoOrdinamento(sortBy, ['createdAt', 'nome', 'tipo', 'rischioAml'] as const, 'createdAt');
      if (!campo) return reply.code(400).send({ errore: 'Campo di ordinamento clienti non valido' });
      const tipiConsentiti = ['company', 'individual'] as const;
      if (tipo && !tipiConsentiti.includes(tipo as typeof tipiConsentiti[number])) {
        return reply.code(400).send({ errore: 'Tipo cliente non valido' });
      }
      const where = {
        tenantId,
        ...(tipo ? { tipo: tipo as typeof tipiConsentiti[number] } : {}),
        ...(search ? {
          OR: [
            { nome: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { piva: { contains: search, mode: 'insensitive' as const } },
            { codiceFiscale: { contains: search, mode: 'insensitive' as const } },
          ],
        } : {}),
      };
      const [clienti, totale, societa, persone] = await Promise.all([
        prisma.cliente.findMany({ where, skip, take: limit, orderBy: { [campo]: sortOrder } }),
        prisma.cliente.count({ where }),
        prisma.cliente.count({ where: { ...where, tipo: 'company' } }),
        prisma.cliente.count({ where: { ...where, tipo: 'individual' } }),
      ]);
      return reply.send({
        data: clienti.map(serializzaCliente),
        meta: creaMetaPaginazione(page, limit, totale),
        riepilogo: { societa, persone },
      });
    } catch (err: any) {
      if (paginazione.paginata) {
        return reply.code(503).send({ errore: err?.message || 'Database clienti non raggiungibile' });
      }
      return (await app.listaClienti()) || [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/clienti', async (req, reply) => {
    const tenantId = req.tenantId;
    const parseResult = CreaClienteSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati cliente non validi' });
    }
    const b = parseResult.data as Record<string, any>;

    const referentiObj = sanitizzaReferenti(b.referentiJson
      ? (typeof b.referentiJson === 'string' ? JSON.parse(b.referentiJson) : b.referentiJson)
      : {
          capitale: b.capitale,
          regImprese: b.regImprese,
          indirizzo: b.indirizzo,
          citta: b.citta,
          cap: b.cap,
          nazione: b.nazione,
          pec: b.pec,
          telefono: b.telefono,
          email: b.email,
          regimeFiscale: b.regimeFiscale,
        });

    const clientEmail = b.email ? b.email.trim().toLowerCase() : (referentiObj?.email ? String(referentiObj.email).trim().toLowerCase() : null);
    // Il cellulare non veniva scritto in colonna da nessuna delle due rotte: la scheda cliente
    // lo inviava, finiva solo dentro `referentiJson`, e `cliente.cellulare` restava NULL per
    // tutti. Conseguenza: il canale WhatsApp del portale risultava indisponibile con il motivo
    // «Nessun cellulare in anagrafica» anche per chi il numero ce l'aveva.
    const clientCellulare = pulisciRecapito(b.cellulare) ?? pulisciRecapito(referentiObj?.cellulare) ?? pulisciRecapito(referentiObj?.whatsapp);
    // Stessa storia, peggiore: `telegramChatId` era letto da quattro punti — l'OTP di firma, la
    // scheda cliente, i webhook e `recapitiCliente` — e non lo scriveva nessuno. Il campo del
    // form salvava uno `@username`, che `sendMessage` rifiuta: il canale risultava configurato
    // in anagrafica e restava per sempre indisponibile all'invio. Qui si tiene solo ciò che
    // `chatIdTelegram` riconosce come chat id; un username non diventa una chat id inventata.
    const clientTelegramChatId = chatIdTelegram(b.telegramChatId)
      ?? chatIdTelegram(referentiObj?.telegramChatId)
      ?? chatIdTelegram(b.telegram)
      ?? chatIdTelegram(referentiObj?.telegram);
    const passwordHash = b.password ? hashPassword(b.password) : null;

    try {
      const cliente = await prisma.cliente.create({
        data: {
          tenantId,
          nome: b.nome,
          tipo: b.tipo,
          email: clientEmail,
          cellulare: clientCellulare,
          telegramChatId: clientTelegramChatId,
          canaleOtpPreferito: canaleOtpValido(b.canaleOtpPreferito) ? b.canaleOtpPreferito : null,
          passwordHash,
          piva: b.piva || null,
          codiceFiscale: b.codiceFiscale || b.codFisc || null,
          giurisdizione: b.giurisdizione || null,
          sedeLegale: b.sedeLegale || b.sede || null,
          sdiCode: b.sdiCode || b.codiceSdi || null,
          // Regime IVA in colonna, non nel blob referentiJson: qui lo legge `emettiFattura`.
          // `?? null` e non `|| null`, perché 0 è un'aliquota valida (esente) e `||` la scarterebbe.
          aliquotaIvaDefault: b.aliquotaIvaDefault ?? null,
          naturaEsenzioneDefault: b.naturaEsenzioneDefault || null,
          iban: b.iban || null,
          rischioAml: b.rischioAml || 'medio',
          ubo: b.ubo || null,
          fontePatrimonio: b.fontePatrimonio || null,
          dataKyc: b.dataKyc || null,
          referentiJson: referentiObj,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'CLIENTE_CREATO',
        entita: cliente.nome,
        dettagli: `Creata anagrafica cliente ERP ${cliente.nome} (P.IVA: ${cliente.piva || 'N/D'})`,
        ipAddress: req.ip,
      });
      return reply.code(201).send(serializzaCliente(cliente));
    } catch (err: any) {
      // Database non raggiungibile: si crea il cliente sulla porta applicativa, così il
      // resto del flusso (progetto → preventivo → esecuzione) resta percorribile.
      try {
        const cliente = await app.creaCliente({ nome: b.nome, tipo: b.tipo });
        return reply.code(201).send({ ...referentiObj, ...cliente });
      } catch {
        req.log.error({ tenantId: req.tenantId, err: err instanceof Error ? err.message : err }, 'POST /clienti — errore creazione DB');
        return reply.code(500).send({ errore: err.message || 'Errore salvataggio cliente' });
      }
    }
  });

  server.put<{ Params: { id: string }; Body: Record<string, any> }>('/clienti/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const b = (req.body || {}) as Record<string, any>;
    // Le credenziali non fanno parte dell'anagrafica generica: altrimenti un ruolo che può
    // aggiornare i dati del cliente potrebbe anche prenderne il controllo. Il reset passa
    // esclusivamente dalla rotta dedicata, riservata ad advisor e super_admin.
    if (Object.prototype.hasOwnProperty.call(b, 'password')) {
      return reply.code(400).send({
        errore: 'La password può essere modificata solo tramite la procedura dedicata.',
      });
    }

    const referentiObj = sanitizzaReferenti(b.referentiJson !== undefined
      ? (typeof b.referentiJson === 'string' ? JSON.parse(b.referentiJson) : b.referentiJson)
      : {
          capitale: b.capitale,
          regImprese: b.regImprese,
          indirizzo: b.indirizzo,
          citta: b.citta,
          cap: b.cap,
          nazione: b.nazione,
          pec: b.pec,
          telefono: b.telefono,
          email: b.email,
          regimeFiscale: b.regimeFiscale,
        });

    const clientEmail = b.email !== undefined
      ? (b.email ? b.email.trim().toLowerCase() : null)
      : (referentiObj?.email ? String(referentiObj.email).trim().toLowerCase() : undefined);

    // Stesso ragionamento della creazione: il numero arriva in colonna, non solo nel JSON.
    // `undefined` quando la richiesta non parla di cellulare, così una modifica parziale non
    // cancella un numero già registrato.
    const clientCellulare = b.cellulare !== undefined
      ? pulisciRecapito(b.cellulare)
      : (pulisciRecapito(referentiObj?.cellulare) ?? pulisciRecapito(referentiObj?.whatsapp) ?? undefined);

    // Come per il cellulare: `undefined` quando la richiesta non parla di Telegram, così una
    // modifica parziale non cancella una chat id già registrata. Un valore presente ma non
    // numerico diventa `null`, che è il modo di dire «toglila»: lasciare la vecchia
    // significherebbe continuare a spedire a una chat che l'operatore ha appena svuotato.
    const clientTelegramChatId = (b.telegramChatId !== undefined || b.telegram !== undefined)
      ? chatIdTelegram(b.telegramChatId ?? b.telegram)
      : (chatIdTelegram(referentiObj?.telegramChatId) ?? chatIdTelegram(referentiObj?.telegram) ?? undefined);

    try {
      const updated = await prisma.cliente.update({
        where: { id },
        data: {
          nome: b.nome !== undefined ? b.nome : undefined,
          tipo: b.tipo !== undefined ? b.tipo : undefined,
          email: clientEmail,
          cellulare: clientCellulare,
          telegramChatId: clientTelegramChatId,
          canaleOtpPreferito: canaleOtpValido(b.canaleOtpPreferito) ? b.canaleOtpPreferito : undefined,
          piva: b.piva !== undefined ? b.piva : undefined,
          codiceFiscale: b.codiceFiscale !== undefined ? b.codiceFiscale : (b.codFisc !== undefined ? b.codFisc : undefined),
          giurisdizione: b.giurisdizione !== undefined ? b.giurisdizione : undefined,
          sedeLegale: b.sedeLegale !== undefined ? b.sedeLegale : (b.sede !== undefined ? b.sede : undefined),
          sdiCode: b.sdiCode !== undefined ? b.sdiCode : (b.codiceSdi !== undefined ? b.codiceSdi : undefined),
          // Aggiornamento parziale: si tocca il regime IVA solo se il corpo ne parla. `undefined`
          // lascia il valore com'è, così un salvataggio che non riguarda l'IVA non la azzera.
          aliquotaIvaDefault: b.aliquotaIvaDefault !== undefined ? b.aliquotaIvaDefault : undefined,
          naturaEsenzioneDefault: b.naturaEsenzioneDefault !== undefined ? b.naturaEsenzioneDefault : undefined,
          iban: b.iban !== undefined ? b.iban : undefined,
          rischioAml: b.rischioAml !== undefined ? b.rischioAml : undefined,
          ubo: b.ubo !== undefined ? b.ubo : undefined,
          fontePatrimonio: b.fontePatrimonio !== undefined ? b.fontePatrimonio : undefined,
          dataKyc: b.dataKyc !== undefined ? b.dataKyc : undefined,
          referentiJson: referentiObj,
        },
      });
      await recordAudit({
        tenantId,
        azione: 'CLIENTE_AGGIORNATO',
        entita: updated.nome,
        dettagli: `Aggiornati dati legali/fiscali cliente ${updated.nome} (P.IVA: ${updated.piva})`,
        ipAddress: req.ip,
      });
      return reply.send(serializzaCliente(updated));
    } catch (err: any) {
      req.log.error({ tenantId: req.tenantId, err: err instanceof Error ? err.message : err }, 'PATCH /clienti/:id — errore aggiornamento DB');
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento cliente' });
    }
  });

  server.post<{ Params: { id: string } }>('/clienti/:id/reset-password', async (req, reply) => {
    if (!richiediRuolo(req, reply, ['advisor', 'super_admin'])) return reply;
    const tenantId = req.tenantId as string;
    const { id } = req.params;

    try {
      const cliente = await prisma.cliente.findFirst({ where: { id, tenantId } });
      if (!cliente) {
        return reply.code(404).send({ errore: 'Cliente non trovato' });
      }

      const nuovaPassword = generaPasswordTemporanea();
      const nuovoHash = hashPassword(nuovaPassword);

      await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          await tx.cliente.update({
            where: { id },
            data: {
              passwordHash: nuovoHash,
              sessionVersion: { increment: 1 },
            },
          });
          await tx.magicLink.updateMany({
            where: { clienteId: id, usatoAt: null },
            data: { usatoAt: new Date() },
          });
        }),
      );

      const ref = cliente.referentiJson && typeof cliente.referentiJson === 'object'
        ? (cliente.referentiJson as Record<string, unknown>)
        : {};
      const destEmail = cliente.email || (typeof ref.email === 'string' ? ref.email : undefined);

      let emailInviata = false;
      let erroreInvioEmail: string | undefined;
      if (destEmail) {
        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          const customSmtp = tenant?.smtpHost && tenant?.smtpUser && tenant?.smtpPass ? {
            host: tenant.smtpHost,
            servername: tenant.smtpServername || undefined,
            port: tenant.smtpPort || 465,
            secure: tenant.smtpSecure ?? true,
            user: tenant.smtpUser,
            pass: tenant.smtpPass,
            fromEmail: tenant.smtpFromEmail || tenant.smtpUser,
            fromName: tenant.smtpFromName || tenant.ragioneSociale || 'BluMan Advisory',
          } : undefined;
          const portalUrl = `${baseUrlApplicazione()}/portal`;
          const esitoCredenziali = await sendClientCredentialsEmail(destEmail, cliente.nome, nuovaPassword, portalUrl, customSmtp);
          emailInviata = esitoCredenziali.ok;
          erroreInvioEmail = esitoCredenziali.errore;
        } catch (err: any) {
          console.warn('Invio email credenziali fallito:', err);
          erroreInvioEmail = err?.message || 'errore inatteso durante l\'invio';
        }
      }

      await recordAudit({
        tenantId,
        azione: 'CLIENTE_PASSWORD_RIGENERATA',
        entita: cliente.nome,
        dettagli: `Rigenerata password di accesso per il cliente ${cliente.nome} (${destEmail || 'nessuna email'})`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        passwordChiaro: nuovaPassword,
        emailInviata,
        erroreInvioEmail,
        email: destEmail || '',
      });
    } catch (err: any) {
      req.log.error({ tenantId: req.tenantId, err: err instanceof Error ? err.message : err }, 'POST /clienti/reset-password — errore DB');
      return reply.code(500).send({ errore: err.message || 'Errore generazione credenziali cliente' });
    }
  });

  server.delete<{ Params: { id: string } }>('/clienti/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      await prisma.cliente.delete({ where: { id } });
      return reply.send({ ok: true, id });
    } catch (err: any) {
      return reply.code(500).send({ errore: err.message || 'Errore eliminazione cliente' });
    }
  });
}
