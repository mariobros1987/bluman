// Rotte firma studio e revisione documenti: la sottoscrizione da parte dello studio
// (§ firma-studio, 4 modalità legali SES/FEA/FEQ/scansionata), il caricamento di nuove
// versioni (§WF-DOC) e le richieste di modifica del cliente.
//
// Estratte da `src/routes/documenti.ts` (split dei monoliti, settembre 2026) SENZA cambio
// di comportamento: stesse identiche implementazioni, solo spostate. Il file d'origine era
// a ~1330 righe, sopra la soglia obbligatoria della regola 8 (split pianificato da 800):
// il mestiere della sottoscrizione lato studio è distinto dalla gestione del fascicolo
// (upload, pubblicazione, sblocco, archiviazione), e i due blocchi non condividono logica
// oltre al modello `documento`.
// `registraRotteDocumentiFirmaStudio` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { uploadDocumento, leggiFileArchivio } from '../services/storageService.js';
import { scanFileBuffer } from '../services/securityScanner.js';
import { fileContieneFirmaDigitale } from '../services/firmaFileValidazione.js';
import { notificaCliente } from '../services/notificheService.js';
import { recordAudit, ipReale, normalizzaGrafometrica } from '../util/serverHelpers.js';
import { generaCopiaFirmata } from '../services/copiaFirmata.js';
import { verificaOtp, sigilloHmac } from '../services/otpService.js';

/** L'admin del tenant (`advisor`) e il `super_admin` possono superare il blocco dei firmati. */
function puoSbloccareDocumentoFirmato(ruolo?: string): boolean {
  return ruolo === 'advisor' || ruolo === 'super_admin';
}

export async function registraRotteDocumentiFirmaStudio(server: FastifyInstance): Promise<void> {
  server.post<{
    Params: { id: string };
    Body: {
      modalita: 'grafometrica' | 'fea_otp' | 'manuale_scansionata' | 'qualificata_esterna';
      firmaGrafometricaPng?: string;
      otp?: string;
      ruoloDichiarato?: string;
      filename?: string;
      contentBase64?: string;
    };
  }>('/documenti/:id/firma-studio', async (req, reply) => {
    const tenantId = req.tenantId;
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const { id } = req.params;
    const { modalita, firmaGrafometricaPng, otp, ruoloDichiarato, filename, contentBase64 } = req.body || {};

    if (!['grafometrica', 'fea_otp', 'manuale_scansionata', 'qualificata_esterna'].includes(modalita)) {
      return reply.code(400).send({
        errore: 'Modalità di firma non valida. Ammesse: grafometrica, fea_otp, manuale_scansionata, qualificata_esterna.',
      });
    }

    try {
      const doc = await prisma.documento.findFirst({
        where: { id, tenantId },
        include: {
          progetto: { select: { id: true, clienteId: true, nome: true } },
          microvoceProgetto: { select: { id: true, nome: true, moduloProgetto: { select: { progetto: { select: { id: true, clienteId: true, nome: true } } } } } },
        },
      });
      if (!doc) return reply.code(404).send({ errore: 'Documento non trovato.' });

      const clienteId = doc.progetto?.clienteId || doc.microvoceProgetto?.moduloProgetto?.progetto?.clienteId;
      if (!clienteId) {
        return reply.code(400).send({ errore: 'Impossibile determinare il cliente collegato al fascicolo del documento.' });
      }

      const utente = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, nome: true, email: true, ruolo: true },
      });
      const firmatarioNome = utente?.nome || utente?.email || 'Professionista Studio';
      const firmatarioRuolo = ruoloDichiarato?.trim() || (utente?.ruolo === 'advisor' ? 'Senior Legal & Tax Advisor' : 'Professionista Incaricato');

      // Impronta del documento per il sigillo: SHA-256 del CONTENUTO reale del file (come il flusso
      // cliente, firma.ts), non della stringa dell'URL. Fail-closed come il cliente: un sigillo con
      // l'impronta sbagliata è peggio di una firma non apposta (rilievo audit §05, regola 7).
      const docTitolo = doc.microvoceProgetto?.nome ?? doc.progetto?.nome ?? 'Documento';
      const contenutoDoc = await leggiFileArchivio(doc.fileUrl);
      if (!contenutoDoc || contenutoDoc.length === 0) {
        return reply.code(502).send({ errore: "Il file del documento non è leggibile dall'archivio: la firma non può essere apposta." });
      }
      const docHash = createHash('sha256').update(contenutoDoc).digest('hex');

      const signatureId = `BLU-STD-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

      if (modalita === 'grafometrica' || modalita === 'fea_otp') {
        const grafometrica = normalizzaGrafometrica(firmaGrafometricaPng);
        if (!grafometrica) {
          return reply.code(400).send({ errore: 'Firma grafica obbligatoria.' });
        }

        let isFea = false;
        let codiceOtpRecordId: string | null = null;
        if (modalita === 'fea_otp') {
          if (!otp || !/^\d{6}$/.test(otp.trim())) {
            return reply.code(400).send({ errore: 'Codice OTP di 6 cifre obbligatorio per la Firma Avanzata (FEA).' });
          }
          const esitoVerifica = await verificaOtp(clienteId, otp.trim(), 'documento_vault_studio', id);
          if (!esitoVerifica.valido || !esitoVerifica.record) {
            return reply.code(400).send({ errore: esitoVerifica.motivo || 'Codice OTP errato o scaduto. Richiedine uno nuovo.' });
          }
          isFea = true;
          codiceOtpRecordId = esitoVerifica.record.id;
        }

        const valoreLegale = isFea ? 'fea' : 'ses';
        const standard = isFea ? 'eIDAS / FEA (CAD art. 20 c. 1-bis)' : 'eIDAS / SES (CAD art. 20)';
        const canaleVerificato = isFea ? 'OTP Verificato + Sessione Studio' : 'Sessione Studio Verificata (art. 20 CAD)';

        // Sigillo in HMAC-SHA256 con la chiave del server (come la firma cliente): una checksum
        // SHA-256 in chiaro non provava che avesse sigillato la piattaforma (rilievo audit §05).
        const sigilloDigest = sigilloHmac(`${signatureId}:${docHash}:${firmatarioNome}:${new Date().toISOString()}`);

        const firma = await prisma.firmaElettronica.create({
          data: {
            tenantId,
            clienteId,
            signatureId,
            tipoFirma: 'studio',
            ambito: 'documento_vault',
            riferimentoId: id,
            documentoTitolo: docTitolo,
            firmatarioNome,
            firmatarioRuolo,
            documentoHash: docHash,
            canaleVerificato,
            codiceOtpId: codiceOtpRecordId,
            ipAddress: ipReale(req),
            userAgent: req.headers['user-agent'] || null,
            firmaGrafometricaPng: grafometrica,
            standard,
            valoreLegale,
            firmatoAt: new Date(),
          },
        });

        // Ricomponi il PDF con la firma dello studio nello slot studio
        const copiaFirmata = await generaCopiaFirmata({
          tenantId,
          documentoId: id,
          firma: {
            signatureId,
            firmatarioNome,
            firmatoAt: firma.firmatoAt,
            valoreLegale,
            firmaGrafometricaPng: grafometrica,
          },
          sigilloDigest,
          slot: 'studio',
          userId: req.userId,
        });

        if (copiaFirmata) {
          await prisma.firmaElettronica.update({
            where: { id: firma.id },
            data: { fileFirmatoUrl: copiaFirmata.url },
          });
        }

        await recordAudit({
          tenantId,
          userId: req.userId,
          userEmail: utente?.email,
          ruolo: req.ruolo,
          azione: 'DOCUMENTO_FIRMATO_STUDIO',
          entita: id,
          dettagli: `Firma studio (${valoreLegale.toUpperCase()}) ${signatureId} apposta da ${firmatarioNome} (${firmatarioRuolo}) su «${docTitolo}»`,
          ipAddress: ipReale(req),
        });

        return reply.send({
          ok: true,
          firma: {
            signatureId,
            firmatarioNome,
            firmatarioRuolo,
            firmatoAt: firma.firmatoAt,
            tipoFirma: 'studio',
            valoreLegale,
          },
          fileFirmatoUrl: copiaFirmata?.url ?? doc.fileUrl,
        });
      }

      // Modalità manuale_scansionata o qualificata_esterna (upload file firmato)
      if (!contentBase64 || !filename) {
        return reply.code(400).send({ errore: 'File firmato (contentBase64 e filename) obbligatorio.' });
      }

      const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const esitoScan = scanFileBuffer(buffer, filename);
      if (!esitoScan.safe) {
        return reply.code(400).send({ errore: esitoScan.reason ?? 'File non valido o non ammesso.' });
      }

      // FEQ onesta (audit 21/09/2026): lato studio, come lato cliente, un file caricato come
      // firma qualificata esterna deve contenere davvero una firma digitale (PAdES o
      // PKCS#7/CAdES), non essere un PDF qualunque marcato FEQ.
      if (modalita === 'qualificata_esterna') {
        const esitoFirmaFile = fileContieneFirmaDigitale(buffer, filename);
        if (!esitoFirmaFile.firmato) {
          return reply.code(422).send({ errore: esitoFirmaFile.motivo });
        }
      }

      const fileHash = createHash('sha256').update(buffer).digest('hex');
      const slug = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const caricato = await uploadDocumento(slug, buffer.toString('base64'), tenantId);
      if (!caricato.ok) {
        return reply.code(500).send({ errore: 'Impossibile salvare il file firmato.' });
      }

      const isFeq = modalita === 'qualificata_esterna';
      const valoreLegale = isFeq ? 'feq' : 'ses';
      const standard = isFeq ? 'eIDAS / FEQ (CAdES/PAdES)' : 'eIDAS / SES (Copia Scansionata)';
      const canaleVerificato = isFeq ? 'Firma Digitale Qualificata Esterna' : 'Copia Cartacea Controfirmata';

      const firma = await prisma.firmaElettronica.create({
        data: {
          tenantId,
          clienteId,
          signatureId,
          tipoFirma: modalita,
          ambito: 'documento_vault',
          riferimentoId: id,
          documentoTitolo: docTitolo,
          firmatarioNome,
          firmatarioRuolo,
          documentoHash: docHash,
          fileFirmatoUrl: caricato.url,
          fileFirmatoHash: fileHash,
          canaleVerificato,
          ipAddress: ipReale(req),
          userAgent: req.headers['user-agent'] || null,
          standard,
          valoreLegale,
          firmatoAt: new Date(),
        },
      });

      // Aggiorna o crea copia firmata
      const copiaEsistente = await prisma.documento.findFirst({
        where: { tenantId, documentoPadreId: id, tipo: 'firmato' },
      });
      if (copiaEsistente && copiaEsistente.id !== id && copiaEsistente.tipo === 'firmato') {
        await prisma.documento.update({
          where: { id: copiaEsistente.id },
          data: { fileUrl: caricato.url, filePdfUrl: caricato.url, scansionatoAt: new Date() },
        });
      } else {
        await prisma.documento.create({
          data: {
            tenantId,
            progettoId: doc.progettoId,
            microvoceProgettoId: doc.microvoceProgettoId,
            tipo: 'firmato',
            fileUrl: caricato.url,
            filePdfUrl: caricato.url,
            formatoOrigine: 'pdf',
            documentoPadreId: id,
            caricatoDa: req.userId,
            categoriaDoc: doc.categoriaDoc ?? 'generico',
            statoDoc: 'firmato',
            pubblicatoAt: new Date(),
            statoScansione: 'pulito',
            scansionatoAt: new Date(),
          },
        });
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        userEmail: utente?.email,
        ruolo: req.ruolo,
        azione: 'DOCUMENTO_FIRMATO_STUDIO',
        entita: id,
        dettagli: `Firma studio (${valoreLegale.toUpperCase()}) ${signatureId} con file ${filename} caricato da ${firmatarioNome}`,
        ipAddress: ipReale(req),
      });

      return reply.send({
        ok: true,
        firma: {
          signatureId,
          firmatarioNome,
          firmatarioRuolo,
          firmatoAt: firma.firmatoAt,
          tipoFirma: modalita,
          valoreLegale,
        },
        fileFirmatoUrl: caricato.url,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore firma studio' });
    }
  });

  /**
   * POST /documenti/:id/nuova-versione — §WF-DOC
   * Carica una nuova versione del documento (es. v2 post revisione), mantenendo lo storico del documento padre.
   */
  server.post<{
    Params: { id: string };
    Body: {
      filename: string;
      contentBase64: string;
      categoriaDoc?: string;
      pubblicaSubito?: boolean;
    };
  }>('/documenti/:id/nuova-versione', async (req, reply) => {
    const tenantId = req.tenantId;
    const userId = req.userId as string | undefined;
    const { id } = req.params;
    const { filename, contentBase64, categoriaDoc, pubblicaSubito } = req.body;

    if (!filename || !contentBase64) {
      return reply.code(400).send({ errore: 'filename e contentBase64 sono obbligatori.' });
    }
    if (!userId) return reply.code(401).send({ errore: 'Sessione non valida.' });

    try {
      const docPadre = await prisma.documento.findFirst({
        where: { id, tenantId },
        include: {
          progetto: { select: { id: true, clienteId: true, nome: true } },
          microvoceProgetto: { select: { id: true, nome: true } },
        },
      });
      if (!docPadre) return reply.code(404).send({ errore: 'Documento originale non trovato.' });

      // §WF-DOC — su un atto firmato non si carica una v2 a piacere: prima l'admin dello studio
      // lo sblocca motivando. Senza questo controllo la versione sottoscritta dal cliente
      // verrebbe superata da un documento che il cliente non ha mai visto né approvato.
      if (docPadre.statoDoc === 'firmato' && !puoSbloccareDocumentoFirmato(req.ruolo)) {
        return reply.code(409).send({
          errore: 'Il documento è firmato dal cliente: per caricarne una nuova versione serve prima lo sblocco dell\'amministratore dello studio.',
        });
      }

      const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const esito = scanFileBuffer(buffer, filename);
      if (!esito.safe) {
        return reply.code(400).send({ errore: esito.reason ?? 'File non ammesso nel fascicolo.' });
      }

      const archiviato = await uploadDocumento(filename, contentBase64, tenantId);
      const nuovaVersione = (docPadre.versione || 1) + 1;
      const targetStato = pubblicaSubito ? 'pubblicato' : 'bozza';

      const nuovoDoc = await prisma.documento.create({
        data: {
          tenantId,
          progettoId: docPadre.progettoId,
          microvoceProgettoId: docPadre.microvoceProgettoId,
          tipo: docPadre.tipo,
          fileUrl: archiviato.url,
          versione: nuovaVersione,
          caricatoDa: userId,
          categoriaDoc: categoriaDoc || docPadre.categoriaDoc || 'generico',
          statoDoc: targetStato,
          pubblicatoAt: targetStato === 'pubblicato' ? new Date() : null,
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
          documentoPadreId: docPadre.id,
        },
      });

      // Risolvi le richieste di modifica aperte sul padre
      await prisma.richiestaModificaDocumento.updateMany({
        where: { documentoId: docPadre.id, stato: 'aperta' },
        data: {
          stato: 'risolta',
          rispostoAt: new Date(),
          rispostaStudio: `Caricata nuova versione v${nuovaVersione}: ${filename}`,
        },
      });

      // §WF-DOC — «in_revisione: torna a bozza dopo upload v2», come dichiara lo schema.
      // Senza questo il padre restava `in_revisione` per sempre: il cliente continuava a
      // vederlo in elenco accanto alla v2 e con due righe aperte non si capiva quale fosse
      // il testo da firmare. La v1 resta nel fascicolo dello studio con il suo storico
      // (`documentoPadreId`), ma esce dal portale, che elenca solo pubblicato/in_revisione/firmato.
      // Un padre già `firmato` non si tocca: quello stato è terminale e ha un sigillo dietro.
      if (docPadre.statoDoc !== 'firmato') {
        await prisma.documento.updateMany({
          where: { id: docPadre.id, tenantId },
          data: { statoDoc: 'bozza' },
        });
      }

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_NUOVA_VERSIONE',
        entita: nuovoDoc.id,
        dettagli: `Caricata v${nuovaVersione} per documento ${docPadre.id} («${filename}», stato ${targetStato})`,
        ipAddress: req.ip,
      });

      if (targetStato === 'pubblicato' && docPadre.progetto?.clienteId) {
        await notificaCliente(tenantId, docPadre.progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Nuova versione documento disponibile',
          corpo: `Lo studio ha caricato e pubblicato una nuova versione (v${nuovaVersione}) di «${filename}» sul progetto «${docPadre.progetto.nome}».`,
          link: `/portal/documents`,
        }).catch(() => {});
      }

      return reply.send({ ok: true, documento: nuovoDoc });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore caricamento nuova versione' });
    }
  });

  /**
   * GET /documenti/:id/richieste-modifica — §WF-DOC
   * Elenco richieste di modifica per un dato documento.
   */
  server.get<{ Params: { id: string } }>('/documenti/:id/richieste-modifica', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    try {
      const richieste = await prisma.richiestaModificaDocumento.findMany({
        where: { documentoId: id, tenantId },
        include: { cliente: { select: { id: true, nome: true, email: true } } },
        orderBy: { creatoAt: 'desc' },
      });
      return reply.send({ ok: true, richieste });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura richieste modifica' });
    }
  });

  /**
   * PATCH /documenti/richieste-modifica/:rid — §WF-DOC
   * Aggiorna lo stato di una richiesta di modifica o aggiunge la risposta dello studio.
   */
  server.patch<{
    Params: { rid: string };
    Body: { stato?: string; rispostaStudio?: string };
  }>('/documenti/richieste-modifica/:rid', async (req, reply) => {
    const tenantId = req.tenantId;
    const { rid } = req.params;
    const { stato, rispostaStudio } = req.body;

    try {
      const esistente = await prisma.richiestaModificaDocumento.findFirst({ where: { id: rid, tenantId } });
      if (!esistente) return reply.code(404).send({ errore: 'Richiesta non trovata.' });

      const updated = await prisma.richiestaModificaDocumento.update({
        where: { id: rid },
        data: {
          ...(stato ? { stato } : {}),
          ...(rispostaStudio !== undefined ? { rispostaStudio, rispostoAt: new Date() } : {}),
        },
      });

      return reply.send({ ok: true, richiesta: updated });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento richiesta modifica' });
    }
  });
}
