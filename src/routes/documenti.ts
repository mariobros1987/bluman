// Rotte documenti: fascicolo documentale del progetto (§2.9) — upload, generazione da
// template, versioni, richieste modifica, sblocco, stato, eliminazione, archiviazione.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile.
// NB: l'helper `nomeFileDaUrl` viveva nella sezione FEA del monolite (DOPO
// questo blocco) ed era visibile solo per hoisting delle function declaration;
// con lo split è stato spostato in `src/util/serverHelpers.ts` perché usato
// sia qui sia dalle rotte firma/portale rimaste nel monolite.
// `registraRotteDocumenti` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).
//
// §41 — le quattro rotte `/documenti-template` (i modelli dello studio) stavano in testa a
// questo file e sono in `src/routes/modelliDocumento.ts`: questo file era a ~1080 righe
// (regola 8) e la cartella dei modelli è un altro mestiere — lì i modelli hanno uno stato di
// revisione, qui i documenti stanno in un fascicolo. I percorsi non sono cambiati.

import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../util/prismaClient.js';
import { leggiIntervalloData, filtroData } from '../util/intervalloData.js';
import { uploadDocumento, rifirmaUrlUpload } from '../services/storageService.js';
import { scanFileBuffer } from '../services/securityScanner.js';
import { contestoTagDocumento, risolviTagDocumento, blocchiDaHtml, generaPdfDocumento, generaDocxDocumento } from '../services/generazioneDocumenti.js';
import { notificaCliente, avvisaClienteViaCanali } from '../services/notificheService.js';
import { recordAudit, ipReale, nomeFileDaUrl, clienteDellaRichiesta, normalizzaGrafometrica } from '../util/serverHelpers.js';
import { livelloFirmaValido, normalizzaLivelloFirma, type LivelloFirma } from '../services/livelloFirmaService.js';
// §40 — la micro-voce indicata deve appartenere al progetto indicato: la decisione sta in un
// service a parte, presidiato, e la usano sia questo upload sia PATCH /documenti/:id/collegamento.
import { decidiCollocazione } from '../services/collocazioneDocumento.js';
import { GeneraDocumentoSchema } from '../schemas/documenti.schema.js';
import { sanitizzaHtmlDocumento } from '../util/htmlSanitizer.js';
import { credenzialiCanali, inviaCodiceOtp } from '../services/otpDispatch.js';
import { creaOtp, annullaOtp } from '../services/otpService.js';

// Split di settembre 2026 (regola 8): firma-studio, nuova-versione e richieste-modifica
// vivono in `src/routes/documentiFirmaStudio.ts`. Questo file resta il fascicolo:
// upload, pubblicazione, sblocco, collegamenti, eliminazione, archiviazione.

// ─── DOCUMENTI: FASCICOLO DOCUMENTALE DEL PROGETTO (§2.9) ───
export async function registraRotteDocumenti(server: FastifyInstance): Promise<void> {
  // ── §2.9 — Fascicolo documentale del progetto: le scritture vanno a database ──────────
  //
  // Prima di questo blocco l'upload dello studio salvava il file sul server (POST /upload)
  // ma il «documento» esisteva solo in localStorage del browser che lo aveva caricato:
  // il portale del cliente (/portal/documenti) legge la tabella `documento`, quindi non
  // vedeva niente, e un altro operatore dello studio non vedeva niente nemmeno lui.
  // Qui l'upload crea la riga in `documento`, agganciata al progetto (o alla micro-voce).

  server.get<{ Querystring: { progettoId?: string; microvoceProgettoId?: string; includiArchiviati?: string; dataDa?: string; dataA?: string } }>(
    '/documenti',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const { progettoId, microvoceProgettoId, includiArchiviati, dataDa, dataA } = req.query;
      if (!progettoId && !microvoceProgettoId) {
        return reply.code(400).send({ errore: 'Specificare progettoId o microvoceProgettoId.' });
      }
      // Filtro periodo sulla data documento (createdAt). La data di firma vive su
      // FirmaElettronica.firmatoAt (recuperata a parte più sotto), quindi non entra qui.
      const periodo = leggiIntervalloData(dataDa, dataA);
      if (!periodo.ok) return reply.code(400).send({ errore: periodo.errore });
      const filtroCreazione = filtroData(periodo.intervallo);

      try {
        if (progettoId) {
          const progetto = await prisma.progetto.findFirst({ where: { id: progettoId, tenantId }, select: { id: true, clienteId: true } });
          if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato.' });
          if (req.ruolo === 'cliente') {
            const clienteId = clienteDellaRichiesta(req);
            if (!clienteId || progetto.clienteId !== clienteId) {
              return reply.code(404).send({ errore: 'Progetto non trovato.' });
            }
          }
        }

        const documenti = await prisma.documento.findMany({
          where: {
            tenantId,
            ...(progettoId ? { progettoId } : {}),
            ...(microvoceProgettoId ? { microvoceProgettoId } : {}),
            ...(filtroCreazione ? { createdAt: filtroCreazione } : {}),
            // Punto 3 piano gap — le liste operative escludono gli archiviati:
            // lo storico (includiArchiviati=true) li mostra solo su richiesta.
            ...(includiArchiviati === 'true' ? {} : { isArchiviato: false }),
          },
          select: {
            id: true,
            tipo: true,
            fileUrl: true,
            filePdfUrl: true,
            fileDocxUrl: true,
            formatoOrigine: true,
            versione: true,
            createdAt: true,
            caricatoDa: true,
            categoriaDoc: true,
            statoScansione: true,
            dataScadenzaDoc: true,
            progettoId: true,
            microvoceProgettoId: true,
            statoDoc: true,
            // Piano §3 — il livello che il documento esige, visibile allo studio per
            // gestirne la pubblicazione e capirne la firmabilità sul portale.
            livelloFirmaRichiesto: true,
            pubblicatoAt: true,
            documentoPadreId: true,
            isArchiviato: true,
            archiviatoAt: true,
            microvoceProgetto: { select: { nome: true } },
            richiesteModifica: {
              select: {
                id: true,
                commento: true,
                stato: true,
                creatoAt: true,
                rispostoAt: true,
                rispostaStudio: true,
                cliente: { select: { id: true, nome: true } },
              },
              orderBy: { creatoAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        // Lo stato di firma di ciascun documento, distinguendo firma studio e firma cliente
        const firme = await prisma.firmaElettronica.findMany({
          where: { tenantId, ambito: 'documento_vault', riferimentoId: { in: documenti.map((d) => d.id) } },
          select: {
            riferimentoId: true,
            firmatoAt: true,
            signatureId: true,
            tipoFirma: true,
            // §8.1 — la parte scritta nel dato, non dedotta dalla stringa.
            parte: true,
            firmatarioNome: true,
            firmatarioRuolo: true,
            canaleVerificato: true,
            valoreLegale: true,
            fileFirmatoUrl: true,
            standard: true,
          },
          orderBy: { firmatoAt: 'desc' },
        });

        const firmaStudioPerDocumento = new Map<string, (typeof firme)[number]>();
        const firmaClientePerDocumento = new Map<string, (typeof firme)[number]>();
        for (const f of firme) {
          if (!f.riferimentoId) continue;
          const isStudio = f.parte === 'studio';
          if (isStudio && !firmaStudioPerDocumento.has(f.riferimentoId)) {
            firmaStudioPerDocumento.set(f.riferimentoId, f);
          } else if (!isStudio && !firmaClientePerDocumento.has(f.riferimentoId)) {
            firmaClientePerDocumento.set(f.riferimentoId, f);
          }
        }

        // §36 — Copie firmate generate dal motore con grafometrica incastonata:
        // servono all'operatore per visualizzare e scaricare direttamente l'atto firmato.
        const copieFirmate = await prisma.documento.findMany({
          where: {
            tenantId,
            documentoPadreId: { in: documenti.map((d) => d.id) },
            tipo: 'firmato',
            isArchiviato: false,
          },
          select: { documentoPadreId: true, fileUrl: true, filePdfUrl: true },
        });
        const copiaPerPadre = new Map<string, { fileUrl: string; filePdfUrl: string | null }>();
        for (const c of copieFirmate) {
          if (c.documentoPadreId && !copiaPerPadre.has(c.documentoPadreId)) {
            copiaPerPadre.set(c.documentoPadreId, c);
          }
        }

        return reply.send({
          ok: true,
          documenti: documenti.map((d) => {
            const fCliente = firmaClientePerDocumento.get(d.id);
            const fStudio = firmaStudioPerDocumento.get(d.id);
            const firma = fCliente || fStudio;
            const copia = copiaPerPadre.get(d.id);
            const isFirmato = Boolean(fCliente) || Boolean(fStudio) || d.tipo === 'firmato' || d.statoDoc === 'firmato';
            const urlAttoFirmato =
              firma?.fileFirmatoUrl ||
              copia?.filePdfUrl ||
              copia?.fileUrl ||
              (d.tipo === 'firmato' ? d.filePdfUrl || d.fileUrl : null);
            const urlPdfEffettivo = isFirmato && urlAttoFirmato ? urlAttoFirmato : (d.filePdfUrl || d.fileUrl);

            // Come /portal/documenti: la firma HMAC degli URL /uploads/ va rinnovata alla lettura.
            return {
              ...d,
              fileUrl: rifirmaUrlUpload(urlPdfEffettivo) as string,
              // Punto 1 — anche i formati di export hanno URL firmati (null per i documenti storici).
              filePdfUrl: urlPdfEffettivo ? (rifirmaUrlUpload(urlPdfEffettivo) as string) : null,
              fileDocxUrl: d.fileDocxUrl ? (rifirmaUrlUpload(d.fileDocxUrl) as string) : null,
              fileBozzaUrl: d.fileUrl ? (rifirmaUrlUpload(d.fileUrl) as string) : null,
              fileFirmatoUrl: urlAttoFirmato ? (rifirmaUrlUpload(urlAttoFirmato) as string) : null,
              firmato: isFirmato,
              firmatoDaCliente: Boolean(fCliente),
              firmatoDaStudio: Boolean(fStudio),
              firmaStudio: fStudio
                ? {
                    signatureId: fStudio.signatureId,
                    firmatarioNome: fStudio.firmatarioNome,
                    firmatarioRuolo: fStudio.firmatarioRuolo,
                    firmatoAt: fStudio.firmatoAt,
                    tipoFirma: fStudio.tipoFirma,
                    valoreLegale: fStudio.valoreLegale,
                    standard: fStudio.standard,
                  }
                : null,
              // Il file firmato è un URL /uploads/ come gli altri: va rinnovato alla
              // lettura, o lo scaricamento dallo studio parte con una firma già scaduta.
              firma: firma || isFirmato
                ? {
                    signatureId: firma?.signatureId ?? null,
                    tipoFirma: firma?.tipoFirma ?? null,
                    firmatarioNome: firma?.firmatarioNome ?? null,
                    firmatoAt: firma?.firmatoAt ?? null,
                    valoreLegale: firma?.valoreLegale ?? null,
                    standard: firma?.standard ?? null,
                    fileFirmatoUrl: urlAttoFirmato
                      ? (rifirmaUrlUpload(urlAttoFirmato) as string)
                      : null,
                  }
                : null,
            };
          }),
        });
      } catch (err) {
        return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura documenti' });
      }
    },
  );

  server.post<{
    Body: {
      progettoId: string;
      microvoceProgettoId?: string;
      filename: string;
      contentBase64: string;
      tipo?: string;
      categoriaDoc?: string;
      dataScadenzaDoc?: string;
      statoDoc?: 'bozza' | 'pubblicato';
      livelloFirmaRichiesto?: string;
    };
  }>('/documenti', async (req, reply) => {
    const tenantId = req.tenantId;
    const userId = req.userId as string | undefined;
    const { progettoId, microvoceProgettoId, filename, contentBase64, tipo, categoriaDoc, dataScadenzaDoc, statoDoc, livelloFirmaRichiesto } = req.body;

    if (!progettoId || !filename || !contentBase64) {
      return reply.code(400).send({ errore: 'progettoId, filename e contentBase64 sono obbligatori.' });
    }
    if (!userId) return reply.code(401).send({ errore: 'Sessione non valida.' });

    const scadenza = dataScadenzaDoc ? new Date(dataScadenzaDoc) : null;
    if (dataScadenzaDoc && Number.isNaN(scadenza?.getTime())) {
      return reply.code(400).send({ errore: 'dataScadenzaDoc non è una data valida.' });
    }

    if (livelloFirmaRichiesto !== undefined && !livelloFirmaValido(livelloFirmaRichiesto)) {
      return reply.code(400).send({ errore: 'livelloFirmaRichiesto non valido: i valori ammessi sono ses, fea, feq.' });
    }

    try {
      const progetto = await prisma.progetto.findFirst({ where: { id: progettoId, tenantId }, select: { id: true, clienteId: true, nome: true } });
      if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato.' });
      if (req.ruolo === 'cliente') {
        const clienteId = clienteDellaRichiesta(req);
        if (!clienteId || progetto.clienteId !== clienteId) {
          return reply.code(403).send({ errore: 'Non autorizzato a caricare documenti su questo progetto.' });
        }
      }

      // §40 — La micro-voce si verifica, non si scrive perché è arrivata. Prima il valore
      // ricevuto finiva sulla riga senza controlli: una tendina non aggiornata dopo il cambio
      // di progetto agganciava l'atto alla micro-voce di un'ALTRA pratica, e da quel momento il
      // documento compariva nel fascicolo di un progetto e nella lavorazione di un altro.
      const microvoce = microvoceProgettoId
        ? await prisma.microvoceProgetto.findFirst({
            where: { id: microvoceProgettoId, tenantId },
            select: { id: true, nome: true, moduloProgetto: { select: { progettoId: true } } },
          })
        : null;
      const collocazione = decidiCollocazione(
        { progettoId, microvoceProgettoId },
        {
          progettoEsiste: true,
          progettoDellaMicrovoce: microvoceProgettoId ? microvoce?.moduloProgetto.progettoId ?? undefined : undefined,
        },
      );
      if (!collocazione.ok) return reply.code(collocazione.codice ?? 400).send({ errore: collocazione.errore });

      // §28 — la scansione avviene PRIMA di scrivere qualunque cosa: un file bocciato non
      // arriva né nell'archivio né nella tabella.
      const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const esito = scanFileBuffer(buffer, filename);
      if (!esito.safe) {
        return reply.code(400).send({ errore: esito.reason ?? 'File non ammesso nel fascicolo.' });
      }

      const archiviato = await uploadDocumento(filename, contentBase64, tenantId);

      const defaultStatoDoc = (statoDoc === 'pubblicato') ? 'pubblicato' : 'bozza';

      // Lo schema ammette template_vuoto|compilato|firmato|allegato: prima ogni valore
      // diverso da 'firmato' diventava 'allegato', così un documento redatto dall'operatore
      // ('compilato') era indistinguibile da un file allegato dal cliente.
      const tipiAmmessi = ['template_vuoto', 'compilato', 'firmato', 'allegato'];
      const tipoFinale = tipo && tipiAmmessi.includes(tipo) ? tipo : 'allegato';

      const documento = await prisma.documento.create({
        data: {
          tenantId,
          progettoId,
          // §40 — il valore verificato, non quello ricevuto.
          microvoceProgettoId: collocazione.microvoceProgettoId,
          tipo: tipoFinale,
          fileUrl: archiviato.url,
          caricatoDa: userId,
          categoriaDoc: categoriaDoc || 'generico',
          dataScadenzaDoc: scadenza,
          // Piano §3.1 — per gli upload manuali il livello lo sceglie l'operatore alla
          // pubblicazione; 'ses' se non indicato (comportamento invariato).
          livelloFirmaRichiesto: livelloFirmaRichiesto ?? 'ses',
          statoDoc: defaultStatoDoc,
          pubblicatoAt: defaultStatoDoc === 'pubblicato' ? new Date() : null,
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
        },
      });

      await recordAudit({
        tenantId,
        // §40 — la traccia dice CHI ha archiviato: senza questi campi `recordAudit` scrive
        // «Sistema / Operatore», e un registro che non sa chi ha caricato una carta non è una
        // traccia. L'utente c'è già (`userId` è verificato sopra, la rotta esige la sessione).
        userId,
        userEmail: req.user?.email,
        ruolo: req.ruolo,
        azione: 'DOCUMENTO_ARCHIVIATO',
        entita: documento.id,
        dettagli:
          `Archiviato «${filename}» (${archiviato.size}) stato «${defaultStatoDoc}» nel fascicolo del progetto «${progetto.nome}» (${progettoId})` +
          // §40 — anche la micro-voce va nominata: è il collegamento che dice a quale
          // lavorazione la carta appartiene, e prima non compariva da nessuna parte nel registro.
          (microvoce ? `, micro-voce «${microvoce.nome}» (${microvoce.id})` : ', senza micro-voce'),
        ipAddress: req.ip,
      });

      // Se pubblicato subito, notifica il cliente
      if (defaultStatoDoc === 'pubblicato' && tipo !== 'firmato' && progetto.clienteId) {
        await notificaCliente(tenantId, progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Documento da firmare',
          corpo: `Lo studio ha pubblicato «${filename}» sul progetto «${progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
          link: `/portal/documents`,
        }).catch(() => {});
        // W3: fallback email/WhatsApp best-effort — il cliente che non apre il portale lo sa comunque.
        await avvisaClienteViaCanali(tenantId, progetto.clienteId, {
          oggetto: 'Documento da firmare',
          corpo: `Lo studio ha pubblicato «${filename}» sul progetto «${progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
        });
      }

      return reply.send({ ok: true, documento: { ...documento, firmato: false, firma: null, richiesteModifica: [] } });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore archiviazione documento' });
    }
  });

  /**
   * Punto 1 piano gap — POST /documenti/genera
   * Genera il documento da template SUL SERVER, in un solo passaggio, in entrambi i formati
   * (pdfkit → PDF master, docxtemplater → Word di cortesia) dallo stesso merge dati. Prima
   * questo lavoro lo faceva il browser con jsPDF e il Word era uno stub con testo inventato.
   * Il PDF è il master: `fileUrl` punta lì e l'hash legale della firma si fissa su quello.
   */
  server.post<{
    Body: {
      progettoId: string;
      microvoceProgettoId?: string;
      modelloId?: string;
      contenutoHtml?: string;
      titolo?: string;
      categoriaDoc?: string;
      statoDoc?: 'bozza' | 'pubblicato';
      dataScadenzaDoc?: string;
      livelloFirmaRichiesto?: string;
    };
  }>('/documenti/genera', async (req, reply) => {
    const tenantId = req.tenantId;
    const userId = req.userId as string | undefined;
    const parseResult = GeneraDocumentoSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati generazione documento non validi' });
    }
    const {
      progettoId,
      microvoceProgettoId: requestedMicrovoceId,
      modelloId: rawModelloId,
      templateId,
      contenutoHtml,
      titolo,
      categoriaDoc,
      statoDoc,
      dataScadenzaDoc,
      livelloFirmaRichiesto,
    } = parseResult.data;
    const modelloId = rawModelloId || templateId || undefined;

    if (!userId) return reply.code(401).send({ errore: 'Sessione non valida.' });
    if (livelloFirmaRichiesto !== undefined && livelloFirmaRichiesto !== null && !livelloFirmaValido(livelloFirmaRichiesto)) {
      return reply.code(400).send({ errore: 'livelloFirmaRichiesto non valido: i valori ammessi sono ses, fea, feq.' });
    }

    const scadenza = dataScadenzaDoc ? new Date(dataScadenzaDoc) : null;
    if (dataScadenzaDoc && Number.isNaN(scadenza?.getTime())) {
      return reply.code(400).send({ errore: 'dataScadenzaDoc non è una data valida.' });
    }

    try {
      const progetto = await prisma.progetto.findFirst({
        where: { id: progettoId, tenantId },
        select: {
          id: true,
          clienteId: true,
          nome: true,
          valoreTotale: true,
          cliente: {
            select: {
              nome: true,
              piva: true,
              codiceFiscale: true,
              sedeLegale: true,
              sdiCode: true,
              iban: true,
              cellulare: true,
              ubo: true,
              referentiJson: true,
            },
          },
        },
      });
      if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato.' });

      // §40 — Come nell'upload: la micro-voce si verifica prima di generare. Il controllo sta
      // qui, PRIMA della produzione dei file, perché un PDF archiviato per la micro-voce
      // sbagliata poi non si cancella (Punto 3 piano gap: si può solo archiviare).
      const microvoceGenerata = requestedMicrovoceId
        ? await prisma.microvoceProgetto.findFirst({
            where: { id: requestedMicrovoceId, tenantId },
            select: { id: true, nome: true, moduloProgetto: { select: { progettoId: true } } },
          })
        : null;
      const collocazioneGenerata = decidiCollocazione(
        { progettoId, microvoceProgettoId: requestedMicrovoceId },
        {
          progettoEsiste: true,
          progettoDellaMicrovoce: requestedMicrovoceId ? microvoceGenerata?.moduloProgetto.progettoId ?? undefined : undefined,
        },
      );
      if (!collocazioneGenerata.ok) {
        return reply.code(collocazioneGenerata.codice ?? 400).send({ errore: collocazioneGenerata.errore });
      }

      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId },
        select: { ragioneSociale: true, piva: true, sedeLegale: true, iban: true, leadAdvisorNome: true, telefono: true, email: true },
      });

      // Il template può arrivare come riferimento a un ModelloDocumentoCustom del tenant
      // oppure come HTML inline (i modelli standard del frontend).
      let htmlTemplate = contenutoHtml ?? '';
      let titoloDocumento = titolo?.trim() || '';
      let categoria = categoriaDoc || '';
      // Piano §3.1 — il livello richiesto dal template è ereditato dal documento generato,
      // salvo override esplicita dell'operatore nella richiesta (il template impone,
      // l'operatore può alzare o precisare alla generazione).
      let livelloFinale: LivelloFirma = livelloFirmaRichiesto ?? 'ses';
      if (modelloId) {
        const modello = await prisma.modelloDocumentoCustom.findFirst({ where: { id: modelloId, tenantId } });
        if (!modello) return reply.code(404).send({ errore: 'Modello documento non trovato.' });
        htmlTemplate = modello.contenutoHtml || '';
        titoloDocumento = titoloDocumento || modello.titolo;
        categoria = categoria || modello.categoria;
        if (!livelloFirmaRichiesto) livelloFinale = normalizzaLivelloFirma(modello.livelloFirmaRichiesto);
      }
      if (!htmlTemplate.trim()) {
        return reply.code(400).send({ errore: 'Il template indicato non ha contenuto.' });
      }
      htmlTemplate = sanitizzaHtmlDocumento(htmlTemplate);
      if (!htmlTemplate.trim()) {
        return reply.code(400).send({ errore: 'Il template contiene solo markup non consentito.' });
      }

      const contesto = contestoTagDocumento({ tenant, cliente: progetto.cliente, progetto });
      const blocchi = blocchiDaHtml(sanitizzaHtmlDocumento(risolviTagDocumento(htmlTemplate, contesto)));
      if (blocchi.length === 0) {
        return reply.code(400).send({ errore: 'Il template non produce contenuto: verificare i blocchi HTML.' });
      }

      const slug = (titoloDocumento || 'documento')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'documento';

      // Due motori dallo stesso merge: il PDF fa fede (master + hash firma), il Word è la
      // copia per la firma autografa. Se il Word fallisce la generazione non si blocca il
      // flusso: si pubblica comunque il PDF e l'anomalia resta nell'audit.
      const pdfBuffer = await generaPdfDocumento(blocchi);
      let docxBuffer: Buffer | null = null;
      try {
        docxBuffer = generaDocxDocumento(blocchi);
      } catch (errWord) {
        await recordAudit({
          tenantId,
          userId,
          azione: 'DOCUMENTO_WORD_FALLITO',
          entita: progettoId,
          dettagli: `Generazione Word fallita per «${titoloDocumento || slug}»: ${errWord instanceof Error ? errWord.message : String(errWord)}`,
          ipAddress: req.ip,
        });
      }

      const uploadPdf = await uploadDocumento(`${slug}.pdf`, pdfBuffer.toString('base64'), tenantId);
      if (!uploadPdf.ok) return reply.code(500).send({ errore: 'Impossibile salvare il PDF generato.' });
      let uploadDocx: { ok: boolean; url: string; name: string; size: string } | null = null;
      if (docxBuffer) {
        uploadDocx = await uploadDocumento(`${slug}.docx`, docxBuffer.toString('base64'), tenantId);
        if (!uploadDocx.ok) {
          uploadDocx = null;
          await recordAudit({
            tenantId,
            userId,
            azione: 'DOCUMENTO_WORD_FALLITO',
            entita: progettoId,
            dettagli: `Upload Word fallito per «${titoloDocumento || slug}»: il documento è pubblicato solo in PDF.`,
            ipAddress: req.ip,
          });
        }
      }

      const defaultStatoDoc = (statoDoc === 'pubblicato') ? 'pubblicato' : 'bozza';

      // I byte arrivano dai motori di generazione del sistema, non da un attore esterno:
      // la scansione §28 è superata per costruzione (stessa regola del verbale di firma).
      const documento = await prisma.documento.create({
        data: {
          tenantId,
          progettoId,
          microvoceProgettoId: collocazioneGenerata.microvoceProgettoId,
          tipo: 'compilato',
          fileUrl: uploadPdf.url,
          filePdfUrl: uploadPdf.url,
          fileDocxUrl: uploadDocx?.url ?? null,
          formatoOrigine: 'pdf',
          // §36 — i blocchi risolti restano attaccati alla riga: alla firma del cliente
          // `generaCopiaFirmata` ricompone da qui il documento con la grafometrica dentro
          // l'area `{{firma_cliente}}`, senza toccare il PDF su cui si fissa il sigillo.
          contenutoBlocchiJson: blocchi as unknown as Prisma.InputJsonValue,
          caricatoDa: userId,
          categoriaDoc: categoria || 'generico',
          dataScadenzaDoc: scadenza,
          livelloFirmaRichiesto: livelloFinale,
          statoDoc: defaultStatoDoc,
          pubblicatoAt: defaultStatoDoc === 'pubblicato' ? new Date() : null,
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
        },
      });

      await recordAudit({
        tenantId,
        userId,
        userEmail: req.user?.email,
        ruolo: req.ruolo,
        azione: 'DOCUMENTO_GENERATO',
        entita: documento.id,
        dettagli:
          `Generato «${uploadPdf.name}» (${uploadPdf.size})${uploadDocx ? ` + Word «${uploadDocx.name}» (${uploadDocx.size})` : ' (solo PDF)'} da template, stato «${defaultStatoDoc}», nel fascicolo del progetto «${progetto.nome}» (${progettoId})` +
          // §40 — la micro-voce nel registro: è il collegamento che dice a quale lavorazione
          // l'atto appartiene, e la traccia deve poterlo dire senza aprire l'interfaccia.
          (microvoceGenerata ? `, micro-voce «${microvoceGenerata.nome}» (${microvoceGenerata.id})` : ', senza micro-voce'),
        ipAddress: req.ip,
      });

      if (defaultStatoDoc === 'pubblicato' && progetto.clienteId) {
        await notificaCliente(tenantId, progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Documento da firmare',
          corpo: `Lo studio ha pubblicato «${uploadPdf.name}» sul progetto «${progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
          link: `/portal/documents`,
        }).catch(() => {});
        // W3: fallback email/WhatsApp best-effort.
        await avvisaClienteViaCanali(tenantId, progetto.clienteId, {
          oggetto: 'Documento da firmare',
          corpo: `Lo studio ha pubblicato «${uploadPdf.name}» sul progetto «${progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
        });
      }

      return reply.send({ ok: true, documento: { ...documento, firmato: false, firma: null, richiesteModifica: [] } });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore generazione documento' });
    }
  });

  /**
   * §WF-DOC — «firmato» è lo stato terminale positivo: un atto sottoscritto dal cliente non si
   * modifica più. Solo l'admin del tenant (`advisor`) e il `super_admin` possono riaprirlo, e
   * unicamente dalla rotta dedicata `/documenti/:id/sblocca`, che pretende una motivazione e la
   * registra nell'audit. Questo controllo sta qui, sul server: nasconderlo solo nella UI
   * lascerebbe la transizione raggiungibile a chiunque abbia un token del tenant.
   */
  function puoSbloccareDocumentoFirmato(ruolo?: string): boolean {
    return ruolo === 'advisor' || ruolo === 'super_admin';
  }

  /**
   * PATCH /documenti/:id/stato — §WF-DOC
   * Permette all'operatore/advisor di pubblicare un documento al cliente o rimetterlo in bozza.
   * Non può dichiarare «firmato»: quello lo scrive solo il sigillo di firma (regola 7).
   */
  server.patch<{
    Params: { id: string };
    Body: { statoDoc: 'bozza' | 'pubblicato' | 'in_revisione' };
  }>('/documenti/:id/stato', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { statoDoc } = req.body;

    if (!['bozza', 'pubblicato', 'in_revisione'].includes(statoDoc)) {
      return reply.code(400).send({ errore: 'statoDoc non valido.' });
    }

    try {
      const doc = await prisma.documento.findFirst({
        where: { id, tenantId },
        include: {
          progetto: { select: { id: true, clienteId: true, nome: true } },
          microvoceProgetto: { select: { nome: true } },
        },
      });
      if (!doc) return reply.code(404).send({ errore: 'Documento non trovato.' });

      // Un documento già firmato non torna indietro da questa rotta, nemmeno per un advisor:
      // la riapertura passa da `/documenti/:id/sblocca`, che chiede il motivo e lo verbalizza.
      if (doc.statoDoc === 'firmato') {
        return reply.code(409).send({
          errore: 'Il documento è stato firmato dal cliente e non è più modificabile. Per riaprirlo serve lo sblocco dell\'amministratore dello studio, che ne registra la motivazione.',
        });
      }

      const updated = await prisma.documento.update({
        where: { id },
        data: {
          statoDoc,
          pubblicatoAt: statoDoc === 'pubblicato' ? (doc.pubblicatoAt ?? new Date()) : doc.pubblicatoAt,
        },
      });

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_STATO_AGGIORNATO',
        entita: id,
        dettagli: `Stato documento ${id} aggiornato a «${statoDoc}»`,
        ipAddress: req.ip,
      });

      // Notifica il cliente se pubblicato
      if (statoDoc === 'pubblicato' && doc.progetto?.clienteId) {
        const nomeDoc = nomeFileDaUrl(doc.fileUrl) ?? doc.microvoceProgetto?.nome ?? 'Documento';
        await notificaCliente(tenantId, doc.progetto.clienteId, {
          tipoEvento: 'documento_da_firmare',
          oggetto: 'Nuovo documento da visionare/firmare',
          corpo: `Lo studio ha pubblicato «${nomeDoc}» sul progetto «${doc.progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
          link: `/portal/documents`,
        }).catch(() => {});
        // W3: fallback email/WhatsApp best-effort.
        await avvisaClienteViaCanali(tenantId, doc.progetto.clienteId, {
          oggetto: 'Nuovo documento da visionare/firmare',
          corpo: `Lo studio ha pubblicato «${nomeDoc}» sul progetto «${doc.progetto.nome}»: accedi al portale per visionarlo e firmarlo.`,
        });
      }

      return reply.send({ ok: true, documento: updated });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento stato documento' });
    }
  });

  /**
   * PATCH /documenti/:id/livello-firma — piano firma §3.3
   * L'operatore cambia il valore legale che il documento esige (ses|fea|feq) finché il
   * cliente non lo ha firmato: il livello è un presupposto della sottoscrizione, non un
   * dato dell'atto. Dopo la firma il sigillo ha già fissato `valoreLegale` e la premessa
   * non si tocca più — stessa guardia di PATCH /documenti/:id/stato.
   * Se il livello viene alzato mentre un codice OTP è pendente non si rompe nulla:
   * verify-otp-and-sign ricontrolla il livello prima di apporre la firma (§3.2).
   */
  server.patch<{
    Params: { id: string };
    Body: { livelloFirmaRichiesto: string };
  }>('/documenti/:id/livello-firma', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { livelloFirmaRichiesto } = req.body;

    if (!livelloFirmaValido(livelloFirmaRichiesto)) {
      return reply.code(400).send({ errore: 'livelloFirmaRichiesto non valido: i valori ammessi sono ses, fea, feq.' });
    }

    try {
      const doc = await prisma.documento.findFirst({
        where: { id, tenantId },
        select: { id: true, statoDoc: true, livelloFirmaRichiesto: true },
      });
      if (!doc) return reply.code(404).send({ errore: 'Documento non trovato.' });

      if (doc.statoDoc === 'firmato') {
        return reply.code(409).send({
          errore: 'Il documento è stato firmato dal cliente: il livello di firma richiesto non è più modificabile.',
        });
      }

      const aggiornato = await prisma.documento.update({
        where: { id },
        data: { livelloFirmaRichiesto },
      });

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_LIVELLO_FIRMA_AGGIORNATO',
        entita: id,
        dettagli: `Livello di firma richiesto del documento ${id} aggiornato da «${doc.livelloFirmaRichiesto}» a «${livelloFirmaRichiesto}»`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, documento: aggiornato });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento livello firma' });
    }
  });

  /**
   * PATCH /documenti/:id/sblocca — §WF-DOC
   * Riapre un documento firmato dal cliente. È l'unica via per uscire dallo stato terminale
   * «firmato», ed è riservata all'admin dello studio (`advisor`) e al `super_admin`.
   *
   * Il sigillo di firma NON viene toccato: la riga `firmaElettronica` resta dov'è, perché è la
   * prova dell'atto compiuto dal cliente e non può essere cancellata da una decisione dello
   * studio. Il documento torna in «bozza», così lo studio lo rilavora e ne pubblica una nuova
   * versione da rifirmare; nel portale il cliente continua a vedere la firma già apposta.
   */
  server.patch<{
    Params: { id: string };
    Body: { motivo?: string };
  }>('/documenti/:id/sblocca', async (req, reply) => {
    const tenantId = req.tenantId;
    const userId = req.userId as string | undefined;
    const ruolo = req.ruolo as string | undefined;
    const { id } = req.params;
    const motivo = (req.body?.motivo ?? '').trim();

    if (!puoSbloccareDocumentoFirmato(ruolo)) {
      return reply.code(403).send({
        errore: 'Solo l\'amministratore dello studio può sbloccare un documento firmato dal cliente.',
      });
    }
    // La motivazione è il motivo per cui l'operazione è ripercorribile: senza, resterebbe solo
    // un documento tornato in bozza senza spiegazione.
    if (motivo.length < 10) {
      return reply.code(400).send({
        errore: 'Indicare la motivazione dello sblocco (almeno 10 caratteri): viene registrata nel giornale di audit.',
      });
    }

    try {
      const doc = await prisma.documento.findFirst({
        where: { id, tenantId },
        include: {
          progetto: { select: { id: true, clienteId: true, nome: true } },
          microvoceProgetto: { select: { nome: true } },
        },
      });
      if (!doc) return reply.code(404).send({ errore: 'Documento non trovato.' });

      if (doc.statoDoc !== 'firmato') {
        return reply.code(409).send({
          errore: `Il documento non è firmato (stato attuale «${doc.statoDoc}»): non c'è nulla da sbloccare.`,
        });
      }

      const aggiornato = await prisma.documento.update({
        where: { id },
        data: { statoDoc: 'bozza' },
      });

      const nomeDoc = nomeFileDaUrl(doc.fileUrl) ?? doc.microvoceProgetto?.nome ?? 'Documento';

      await recordAudit({
        tenantId,
        azione: 'DOCUMENTO_SBLOCCATO',
        entita: id,
        dettagli: `Documento firmato «${nomeDoc}» riaperto in bozza dall'utente ${userId ?? 'sconosciuto'} (ruolo ${ruolo ?? 'n/d'}). Motivazione: ${motivo}`,
        ipAddress: ipReale(req),
      });

      // Il cliente ha firmato: se lo studio riapre l'atto, deve vederlo dichiarato nel portale.
      if (doc.progetto?.clienteId) {
        await notificaCliente(tenantId, doc.progetto.clienteId, {
          tipoEvento: 'documento_sbloccato',
          oggetto: 'Documento firmato riaperto dallo studio',
          corpo: `Lo studio ha riaperto «${nomeDoc}» sul progetto «${doc.progetto.nome}» per ulteriori modifiche. La firma che hai apposto resta registrata; riceverai la nuova versione da firmare. Motivazione indicata: ${motivo}`,
          link: `/portal/documents`,
        }).catch(() => {});
      }

      return reply.send({ ok: true, documento: aggiornato });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore sblocco documento' });
    }
  });

  /**
   * POST /documenti/:id/richiedi-otp-studio
   * Richiede un codice OTP all'email o al recapito WhatsApp del professionista/operatore autenticato
   * per apporre Firma Elettronica Avanzata (FEA).
   */
  server.post<{
    Params: { id: string };
    Body: { canale?: 'email' | 'whatsapp'; cellulare?: string };
  }>('/documenti/:id/richiedi-otp-studio', async (req, reply) => {
    const tenantId = req.tenantId;
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const { id } = req.params;
    const canale = req.body?.canale || 'email';
    if (canale !== 'email' && canale !== 'whatsapp') {
      return reply.code(400).send({ errore: 'Canale non valido. Ammessi: email, whatsapp.' });
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
        select: { id: true, nome: true, email: true },
      });
      if (!utente) return reply.code(404).send({ errore: 'Utente non trovato.' });

      const recapito = canale === 'whatsapp' ? req.body?.cellulare?.trim() : utente.email;
      if (!recapito) {
        return reply.code(400).send({
          errore: canale === 'whatsapp'
            ? 'Specificare il numero di cellulare per la ricezione del codice via WhatsApp.'
            : 'Nessuna email configurata nel tuo profilo utente.',
        });
      }

      const esitoOtp = await creaOtp({
        tenantId,
        clienteId,
        canale,
        target: recapito,
        ambito: 'documento_vault_studio',
        riferimentoId: id,
        ipRichiesta: ipReale(req),
      });

      if (!esitoOtp.ok || !esitoOtp.codice) {
        return reply.code(400).send({ errore: esitoOtp.errore || 'Impossibile generare il codice OTP.' });
      }

      const docTitolo = doc.microvoceProgetto?.nome ?? doc.progetto?.nome ?? 'Documento';
      const esitoInvio = await inviaCodiceOtp({
        tenantId,
        canale,
        target: recapito,
        codice: esitoOtp.codice,
        nomeFirmatario: utente.nome,
        oggettoFirma: `la sottoscrizione di «${docTitolo}»`,
        livelloFirma: 'fea',
      });

      if (!esitoInvio.ok) {
        if (esitoOtp.otpId) await annullaOtp(esitoOtp.otpId);
        return reply.code(400).send({ ok: false, errore: esitoInvio.errore || 'Invio codice OTP fallito.' });
      }

      // Maschera recapito per feedback utente
      const mascherato = canale === 'email'
        ? recapito.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => `${a}${'*'.repeat(Math.max(b.length, 3))}${c}`)
        : recapito.replace(/(\d{3})\d+(\d{2})$/, '$1****$2');

      return reply.send({ ok: true, canale, recapitoMascherato: mascherato });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore richiesta OTP' });
    }
  });

  server.delete<{ Params: { id: string } }>('/documenti/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    try {
      const documento = await prisma.documento.findFirst({
        where: tenantId ? { id, tenantId } : { id },
        select: { id: true, fileUrl: true, tenantId: true, statoDoc: true, tipo: true },
      });
      if (!documento) return reply.code(404).send({ errore: 'Documento non trovato.' });

      // Punto 2 piano gap — il verbale di firma è un atto certificativo: la FK dalla firma
      // lo metterebbe solo a NULL, ma il fascicolo perderebbe la memoria leggibile di un
      // evento probatorio. Come i documenti firmati: solo archiviabile, mai eliminabile.
      if (documento.tipo === 'verbale_firma') {
        return reply.code(409).send({
          errore: 'Il verbale di firma è un atto certificativo: non può essere eliminato, solo archiviato.',
        });
      }

      // Punto 3 piano gap — un documento firmato non si elimina MAI, per nessuno, nemmeno
      // per l'admin dello studio. Il sigillo FirmaElettronica è un atto legale che referenzia
      // il documento sottoscritto: cancellarlo lascerebbe una firma orfana, e un atto
      // sottoscritto non può sparire dal fascicolo. La via prevista è l'archiviazione:
      // PATCH /documenti/:id/archivia.
      if (documento.statoDoc === 'firmato') {
        return reply.code(409).send({
          errore: 'Il documento è firmato dal cliente: non può essere eliminato, solo archiviato.',
        });
      }

      // Un sigillo collegato al documento (anche se lo stato non è tornato 'firmato', per
      // esempio una firma del Vault) blocca l'eliminazione allo stesso modo; e finché un
      // codice di firma è pendente la firma potrebbe ancora essere completata.
      const [firmeCollegate, otpPendenti] = await Promise.all([
        prisma.firmaElettronica.count({
          where: { tenantId: documento.tenantId || tenantId, ambito: 'documento_vault', riferimentoId: id },
        }),
        prisma.codiceOtp.count({
          where: { tenantId: documento.tenantId || tenantId, ambito: 'documento_vault', riferimentoId: id, scadenza: { gt: new Date() } },
        }),
      ]);
      if (firmeCollegate > 0) {
        return reply.code(409).send({
          errore: 'Al documento è collegata una firma elettronica: non può essere eliminato, solo archiviato.',
        });
      }
      if (otpPendenti > 0) {
        return reply.code(409).send({
          errore: 'C\'è un codice di firma in attesa su questo documento: attendere la scadenza del codice o completare la firma prima di eliminarlo.',
        });
      }

      // Disaccoppia versioni figlie prima della cancellazione
      await prisma.documento.updateMany({
        where: { documentoPadreId: id },
        data: { documentoPadreId: null },
      }).catch(() => {});

      // Disaccoppia passaggi progetto
      await prisma.passaggioProgetto.updateMany({
        where: { documentoId: id },
        data: { documentoId: null },
      }).catch(() => {});

      // Elimina richieste di modifica collegate
      await prisma.richiestaModificaDocumento.deleteMany({
        where: { documentoId: id },
      }).catch(() => {});

      // Nota: nessun disaccoppiamento di firmaElettronica qui — i guard sopra restituiscono
      // 409 se esiste un sigillo o un OTP pendente collegato, quindi a questo punto il
      // documento non ne ha. Il sigillo legale non viene mai reso orfano.

      await prisma.documento.delete({ where: { id } });

      await recordAudit({
        tenantId: documento.tenantId || tenantId,
        azione: 'DOCUMENTO_RIMOSSO',
        entita: id,
        dettagli: `Rimosso dal fascicolo il documento ${documento.fileUrl}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err, 'Errore eliminazione documento');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione documento' });
    }
  });

  // Punto 3 piano gap — ARCHIVIAZIONE: l'unica uscita prevista per un documento firmato
  // (o comunque non più attuale). L'hard delete è vietato per tutti, admin inclusi; qui
  // l'atto resta leggibile nello storico e nel portale con il suo sigillo integro, e le
  // liste operative semplicemente smettono di mostrarlo.
  server.patch<{ Params: { id: string } }>('/documenti/:id/archivia', async (req, reply) => {
    const tenantId = req.tenantId;
    const userId = req.userId as string | undefined;
    const ruolo = req.ruolo;
    const { id } = req.params;

    // Archiviare è un atto definitivo sul fascicolo: riservato all'amministratore dello
    // studio, come lo sblocco di un documento firmato.
    if (!puoSbloccareDocumentoFirmato(ruolo)) {
      return reply.code(403).send({ errore: 'Solo l\'amministratore dello studio può archiviare un documento.' });
    }

    try {
      const documento = await prisma.documento.findFirst({
        where: tenantId ? { id, tenantId } : { id },
        select: { id: true, isArchiviato: true, tenantId: true, fileUrl: true, statoDoc: true },
      });
      if (!documento) return reply.code(404).send({ errore: 'Documento non trovato.' });

      // Idempotenza: ri-archiviare un documento già archiviato non è un errore.
      if (documento.isArchiviato) {
        return reply.send({ ok: true, messaggio: 'Il documento era già archiviato.' });
      }

      const aggiornato = await prisma.documento.update({
        where: { id },
        data: { isArchiviato: true, archiviatoAt: new Date(), archiviatoDaId: userId ?? null },
      });

      await recordAudit({
        tenantId: documento.tenantId || tenantId,
        azione: 'DOCUMENTO_ARCHIVIATO',
        entita: id,
        dettagli: `Archiviato il documento ${documento.fileUrl} (stato ${documento.statoDoc})`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, documento: aggiornato });
    } catch (err) {
      req.log.error(err, 'Errore archiviazione documento');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore archiviazione documento' });
    }
  });
}
