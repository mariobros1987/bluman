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
import { prisma } from '../util/prismaClient.js';
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

// ─── DETTAGLIO CLIENTE & MAGIC LINK (coda dell'ex blocco ARTICOLI) ──
export async function registraRotteClienti(server: FastifyInstance, app: AppPort): Promise<void> {
  server.get<{ Params: { id: string } }>('/clienti/:id', async (req, reply) => {
    try {
      const c = await prisma.cliente.findUnique({ where: { id: req.params.id } });
      if (c) return reply.send(c);
      return app.getCliente(req.params.id);
    } catch {
      return app.getCliente(req.params.id);
    }
  });

  server.post<{ Params: { id: string }; Body: { email?: string } }>('/clienti/:id/magic-link', async (req, reply) => {
    const tenantId = (req as any).tenantId as string;

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
      console.error('Errore generazione magic link:', err);
      return reply.code(500).send({ errore: err.message || 'Errore generazione Magic Link' });
    }
  });

  // ─── ANAGRAFICA CLIENTI ERP API (§2, §14) ─────────────────────────
  server.get('/clienti', async (req) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    try {
      const clienti = await prisma.cliente.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return clienti.map(c => {
        const ref = c.referentiJson && typeof c.referentiJson === 'object' ? (c.referentiJson as any) : {};
        return {
          ...ref,
          ...c,
          email: c.email || ref.email || '',
          hasPassword: Boolean(c.passwordHash),
          codiceFiscale: c.codiceFiscale || ref.codiceFiscale || ref.codFisc,
          codFisc: c.codiceFiscale || ref.codiceFiscale || ref.codFisc,
          sdiCode: c.sdiCode || ref.sdiCode || ref.codiceSdi || 'SUBM70N',
          codiceSdi: c.sdiCode || ref.sdiCode || ref.codiceSdi || 'SUBM70N',
          iban: c.iban || ref.iban,
          piva: c.piva || ref.piva,
          sedeLegale: c.sedeLegale || ref.sedeLegale,
          giurisdizione: c.giurisdizione || ref.giurisdizione,
          rischioAml: c.rischioAml || ref.rischioAml || 'medio',
          ubo: c.ubo || ref.ubo,
          fontePatrimonio: c.fontePatrimonio || ref.fontePatrimonio,
          dataKyc: c.dataKyc || ref.dataKyc,
        };
      });
    } catch {
      // Database non raggiungibile: si serve la porta applicativa, come fanno già
      // /progetti e /preventivi. Restituire [] silenziosamente nascondeva il guasto.
      return (await app.listaClienti()) || [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/clienti', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const b = (req.body || {}) as Record<string, any>;
    if (!b.nome) return reply.code(400).send({ errore: 'Il nome del cliente è obbligatorio' });

    // `tipo` non ha un default: da persona fisica o società dipendono AML, regime
    // fiscale e fatturazione. Cadere silenziosamente su 'company' significava
    // classificare male il cliente senza che nessuno se ne accorgesse.
    if (b.tipo !== 'individual' && b.tipo !== 'company') {
      return reply.code(400).send({ errore: "Il tipo cliente è obbligatorio: 'individual' o 'company'" });
    }

    const referentiObj = b.referentiJson
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
        };

    const clientEmail = b.email ? b.email.trim().toLowerCase() : (referentiObj?.email ? String(referentiObj.email).trim().toLowerCase() : null);
    // Il cellulare non veniva scritto in colonna da nessuna delle due rotte: la scheda cliente
    // lo inviava, finiva solo dentro `referentiJson`, e `cliente.cellulare` restava NULL per
    // tutti. Conseguenza: il canale WhatsApp del portale risultava indisponibile con il motivo
    // «Nessun cellulare in anagrafica» anche per chi il numero ce l'aveva.
    // `telegram` NON diventa `telegramChatId`: quello del form è lo @username, la chat id la
    // produce il bot quando il cliente gli scrive.
    const clientCellulare = pulisciRecapito(b.cellulare) ?? pulisciRecapito(referentiObj?.cellulare) ?? pulisciRecapito(referentiObj?.whatsapp);
    const passwordHash = b.password ? hashPassword(b.password) : null;

    try {
      const cliente = await prisma.cliente.create({
        data: {
          tenantId,
          nome: b.nome,
          tipo: b.tipo,
          email: clientEmail,
          cellulare: clientCellulare,
          canaleOtpPreferito: canaleOtpValido(b.canaleOtpPreferito) ? b.canaleOtpPreferito : null,
          passwordHash,
          piva: b.piva || null,
          codiceFiscale: b.codiceFiscale || b.codFisc || null,
          giurisdizione: b.giurisdizione || null,
          sedeLegale: b.sedeLegale || b.sede || null,
          sdiCode: b.sdiCode || b.codiceSdi || 'SUBM70N',
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
      return reply.code(201).send({ ...referentiObj, ...cliente, hasPassword: Boolean(cliente.passwordHash) });
    } catch (err: any) {
      // Database non raggiungibile: si crea il cliente sulla porta applicativa, così il
      // resto del flusso (progetto → preventivo → esecuzione) resta percorribile.
      try {
        const cliente = await app.creaCliente({ nome: b.nome, tipo: b.tipo });
        return reply.code(201).send({ ...referentiObj, ...cliente });
      } catch {
        console.error('Errore creazione cliente DB:', err);
        return reply.code(500).send({ errore: err.message || 'Errore salvataggio cliente' });
      }
    }
  });

  server.put<{ Params: { id: string }; Body: Record<string, any> }>('/clienti/:id', async (req, reply) => {
    const tenantId = (req as any).tenantId || '00000000-0000-0000-0000-000000000001';
    const { id } = req.params;
    const b = (req.body || {}) as Record<string, any>;

    const referentiObj = b.referentiJson !== undefined
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
        };

    const clientEmail = b.email !== undefined
      ? (b.email ? b.email.trim().toLowerCase() : null)
      : (referentiObj?.email ? String(referentiObj.email).trim().toLowerCase() : undefined);

    // Stesso ragionamento della creazione: il numero arriva in colonna, non solo nel JSON.
    // `undefined` quando la richiesta non parla di cellulare, così una modifica parziale non
    // cancella un numero già registrato.
    const clientCellulare = b.cellulare !== undefined
      ? pulisciRecapito(b.cellulare)
      : (pulisciRecapito(referentiObj?.cellulare) ?? pulisciRecapito(referentiObj?.whatsapp) ?? undefined);

    const passwordHash = b.password ? hashPassword(b.password) : undefined;

    try {
      const updated = await prisma.cliente.update({
        where: { id },
        data: {
          nome: b.nome !== undefined ? b.nome : undefined,
          tipo: b.tipo !== undefined ? b.tipo : undefined,
          email: clientEmail,
          cellulare: clientCellulare,
          canaleOtpPreferito: canaleOtpValido(b.canaleOtpPreferito) ? b.canaleOtpPreferito : undefined,
          passwordHash: passwordHash,
          piva: b.piva !== undefined ? b.piva : undefined,
          codiceFiscale: b.codiceFiscale !== undefined ? b.codiceFiscale : (b.codFisc !== undefined ? b.codFisc : undefined),
          giurisdizione: b.giurisdizione !== undefined ? b.giurisdizione : undefined,
          sedeLegale: b.sedeLegale !== undefined ? b.sedeLegale : (b.sede !== undefined ? b.sede : undefined),
          sdiCode: b.sdiCode !== undefined ? b.sdiCode : (b.codiceSdi !== undefined ? b.codiceSdi : undefined),
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
      return reply.send({ ...referentiObj, ...updated, hasPassword: Boolean(updated.passwordHash) });
    } catch (err: any) {
      console.error('Errore aggiornamento cliente DB:', err);
      return reply.code(500).send({ errore: err.message || 'Errore aggiornamento cliente' });
    }
  });

  server.post<{ Params: { id: string } }>('/clienti/:id/reset-password', async (req, reply) => {
    const tenantId = (req as any).tenantId as string;
    const { id } = req.params;

    try {
      const cliente = await prisma.cliente.findUnique({ where: { id } });
      if (!cliente) {
        return reply.code(404).send({ errore: 'Cliente non trovato' });
      }

      const nuovaPassword = generaPasswordTemporanea();
      const nuovoHash = hashPassword(nuovaPassword);

      await prisma.cliente.update({
        where: { id },
        data: {
          passwordHash: nuovoHash,
        },
      });

      const ref = cliente.referentiJson && typeof cliente.referentiJson === 'object' ? (cliente.referentiJson as any) : {};
      const destEmail = cliente.email || ref.email;

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
      console.error('Errore reset password cliente:', err);
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
