// Rotte firma: FEA con OTP (whatsapp/email/telegram) — documenti firmabili
// del portale, download con URL firmato, richieste di modifica — e la firma
// vera e propria: canali disponibili, richiesta/verifica OTP, firma con file
// caricato, elenco firme, firma grafometrica.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. Nel monolite vivevano in DUE blocchi separati dal
// puntatore del portale cliente (la FEA prima, le rotte di firma dopo): qui
// sono riunite in un unico modulo, con la FEA nell'ordine di registrazione
// originale. I path sono unici, quindi riunirle non cambia il routing.
// Gli helper locali della FEA (AMBITI_OTP, ambitoValido, DESCRIZIONE_AMBITO,
// HASH_SHA256) restano qui dentro la funzione, com'erano nel monolite.
// `registraRotteFirma` viene chiamata DENTRO il wrapper `server.register(...)`
// di `buildServer`, quindi il rate-limit e l'hook auth onRequest continuano ad
// applicarsi esattamente come prima (stesso contesto di incapsulamento,
// nessuna nuova barriera).

import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { uploadDocumento, rifirmaUrlUpload, leggiFileArchivio } from '../services/storageService.js';
import {
  creaOtp,
  verificaOtp,
  annullaOtp,
  creaSigilloFea,
  STANDARD_SES,
  STANDARD_FEA,
  mascheraRecapito,
  descriviCanaleVerificato,
  canaleValido,
  CANALI_OTP,
  TTL_OTP_SECONDI,
  ATTESA_REINVIO_SECONDI,
  type CanaleOtp,
  type AmbitoOtp,
} from '../services/otpService.js';
import { credenzialiCanali, canaliDisponibili, inviaCodiceOtp, recapitiCliente } from '../services/otpDispatch.js';
import { notificaStudio, notificaCliente } from '../services/notificheService.js';
import { scanFileBuffer } from '../services/securityScanner.js';
import { fileContieneFirmaDigitale } from '../services/firmaFileValidazione.js';
import { generaPdfVerbaleFirma } from '../services/verbaleFirma.js';
import { generaCopiaFirmata, type EsitoCopiaFirmata } from '../services/copiaFirmata.js';
import {
  verificaLivelloFirma,
  livelloPiuAlto,
  normalizzaLivelloFirma,
  type LivelloFirma,
} from '../services/livelloFirmaService.js';
import { ipReale, normalizzaGrafometrica, nomeFileDaUrl, clienteDellaRichiesta, recordAudit } from '../util/serverHelpers.js';

// ─── FIRMA ELETTRONICA SEMPLICE (SES · art. 20 CAD) & FIRMA DOCUMENTI ─────────────
export async function registraRotteFirma(server: FastifyInstance): Promise<void> {
  // ── FIRMA ELETTRONICA SEMPLICE (SES) CON OTP: WHATSAPP / EMAIL / TELEGRAM ──
  //
  // Cosa non funzionava, e perché non erano dettagli:
  //   · il recapito era `cellulare || email || '+39 3xx xxxxxxx'`. Il numero di una persona
  //     reale, cablato nel sorgente, come destinazione predefinita del codice di firma di
  //     qualunque cliente di qualunque studio;
  //   · `clienteId` arrivava dal body e nessuno lo confrontava con la sessione, mentre il
  //     frontend spediva `'client-01'` quando non lo trovava: bastava un id nel body per
  //     far partire il codice di un altro cliente;
  //   · solo l'email spediva davvero. WhatsApp, SMS e Telegram generavano il codice, lo
  //     scrivevano nei log e non mandavano niente, ma la risposta diceva "inviato";
  //   · `devOtp` restituiva il codice in chiaro a chi metteva un header nella richiesta;
  //   · il sigillo eIDAS non veniva salvato da nessuna parte, quindi la firma esisteva
  //     solo nella schermata che la mostrava.

  const AMBITI_OTP: AmbitoOtp[] = ['engagement_letter', 'documento_vault', 'modulo_completato', 'addendum'];

  function ambitoValido(valore: unknown): valore is AmbitoOtp {
    return typeof valore === 'string' && (AMBITI_OTP as string[]).includes(valore);
  }

  /** Come descrivere al firmatario cosa sta autorizzando, nel messaggio e nell'email. */
  const DESCRIZIONE_AMBITO: Record<AmbitoOtp, string> = {
    engagement_letter: "la lettera d'incarico e il mandato professionale",
    documento_vault: 'un documento del tuo archivio riservato',
    modulo_completato: 'la conferma di un modulo completato',
    addendum: 'un addendum al mandato',
    documento_vault_studio: 'un documento per conto dello studio',
  };

  const HASH_SHA256 = /^[a-f0-9]{64}$/i;

  // Fase 3 FEA (misura 1) — chi può apporre la firma per questo cliente: il cliente
  // stesso o un referente censito in anagrafica (`legaleRappresentante`). L'elenco lo
  // serve l'anagrafica e le rotte di firma lo fanno rispettare: un nome digitato
  // liberamente nel body non identifica nessuno.
  function firmatariAmmessi(cliente: { nome: string; referentiJson?: unknown }): string[] {
    const referenti = cliente.referentiJson && typeof cliente.referentiJson === 'object'
      ? (cliente.referentiJson as Record<string, unknown>)
      : null;
    const legale = typeof referenti?.legaleRappresentante === 'string' ? referenti.legaleRappresentante : undefined;
    return [cliente.nome, legale]
      .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
      .map((n) => n.trim());
  }

  /**
   * I documenti del fascicolo del cliente, con lo stato di firma preso dal database (§2.1, §2.9).
   *
   * Prima questa sezione del portale non esisteva come rotta: il browser teneva quattro documenti
   * scritti a mano nel codice — un NDA, uno statuto maltese, una dichiarazione UBO e una letter of
   * wishes — di cui il primo era marcato «firmato il 15/08/2026 01:44:12». Nessuno dei quattro
   * esisteva a database, per nessun cliente, e la data di firma era inventata. Lo stato di firma
   * viveva in `localStorage`: firmato su un browser voleva dire non firmato su un altro, e lo
   * studio non ne vedeva traccia da nessuna parte.
   *
   * Qui i documenti sono quelli realmente caricati sulle micro-voci dei progetti del cliente, e
   * «firmato» significa che esiste una riga in `FirmaElettronica`. Quando il fascicolo è vuoto la
   * risposta è un elenco vuoto: il portale lo dichiara, non lo riempie.
   */
  server.get<{ Querystring: { clienteId?: string } }>('/portal/documenti', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, req.query?.clienteId);
    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      // §2.9 + §WF-DOC — il fascicolo per il cliente contiene solo i documenti con statoDoc
      // 'pubblicato', 'in_revisione' o 'firmato'. I documenti in 'bozza' sono visibili solo all'operatore.
      // Punto 3 piano gap — i documenti archiviati non compaiono mai nel portale cliente:
      // restano nello storico dello studio, non nel fascicolo operativo del cliente.
      const documenti = await prisma.documento.findMany({
        where: {
          tenantId,
          isArchiviato: false,
          statoDoc: { in: ['pubblicato', 'in_revisione', 'firmato'] },
          OR: [
            { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
            { progetto: { clienteId } },
          ],
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
          categoriaDoc: true,
          statoScansione: true,
          dataScadenzaDoc: true,
          statoDoc: true,
          // Piano §3 — il livello che il documento esige: il portale lo usa per il gating
          // del flusso di firma (con feq niente OTP; con fea l'OTP c'è, ma la firma grafica
          // diventa obbligatoria) e per l'etichetta nel fascicolo.
          livelloFirmaRichiesto: true,
          pubblicatoAt: true,
          documentoPadreId: true,
          progettoId: true,
          microvoceProgettoId: true,
          progetto: { select: { nome: true } },
          microvoceProgetto: {
            select: {
              id: true,
              nome: true,
              moduloProgetto: { select: { id: true, nome: true, progettoId: true, progetto: { select: { nome: true } } } },
            },
          },
          richiesteModifica: {
            where: { clienteId },
            select: { id: true, commento: true, stato: true, creatoAt: true, rispostoAt: true, rispostaStudio: true },
            orderBy: { creatoAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const firme = await prisma.firmaElettronica.findMany({
        where: { tenantId, clienteId, ambito: 'documento_vault' },
        select: {
          signatureId: true,
          riferimentoId: true,
          documentoTitolo: true,
          tipoFirma: true,
          firmatoAt: true,
          canaleVerificato: true,
          // Evidenze del sigillo mostrate nel certificato di firma del portale: fuori dal
          // select arrivano `undefined` e il modale dichiarerebbe una firma senza impronta
          // né firmatario. Vengono solo da qui (regola 7): il browser non le può ricostruire.
          ipAddress: true,
          documentoHash: true,
          firmaGrafometricaPng: true,
          firmatarioNome: true,
          standard: true,
          // Piano §3.1 — il valore legale effettivo della firma (scritto dal server).
          valoreLegale: true,
          // Il file ricaricato firmato (canale manuale_scansionata / qualificata_esterna):
          // è l'atto sottoscritto vero. Senza questo campo il portale può offrire solo il
          // master pre-firma anche a firma avvenuta.
          fileFirmatoUrl: true,
        },
        orderBy: { firmatoAt: 'desc' },
      });

      // Una firma per documento: distinguiamo tra la firma del cliente e la firma dello studio
      const firmaClientePerDocumento = new Map<string, (typeof firme)[number]>();
      const firmaStudioPerDocumento = new Map<string, (typeof firme)[number]>();
      for (const f of firme) {
        if (f.riferimentoId) {
          if (f.tipoFirma === 'studio') {
            if (!firmaStudioPerDocumento.has(f.riferimentoId)) firmaStudioPerDocumento.set(f.riferimentoId, f);
          } else {
            if (!firmaClientePerDocumento.has(f.riferimentoId)) firmaClientePerDocumento.set(f.riferimentoId, f);
          }
        }
      }

      // §36 — Copie firmate generate dal motore con la grafometrica dentro (tipo: 'firmato' e documentoPadreId):
      // servono per offrire direttamente l'atto sottoscritto al cliente invece della bozza master vuota.
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

      // §WF-DOC — storico delle versioni, risalendo la catena `documentoPadreId`.
      //
      // Il campo era già a database e veniva perfino selezionato qui, ma non usciva dalla
      // risposta: il cliente vedeva «v3» e nient'altro, senza modo di sapere che cosa la v3
      // avesse sostituito né se avesse già firmato una versione precedente. Il percorso
      // dev'essere ripercorribile all'indietro, quindi lo si ricostruisce: i padri stanno
      // in `bozza` e non compaiono nell'elenco, per questo servono letture dedicate.
      //
      // Il ciclo è limitato a 12 salti: la catena è lineare per costruzione, ma un dato
      // sporco non deve poter bloccare la lettura del fascicolo di un cliente.
      const antenati = new Map<string, { id: string; versione: number; createdAt: Date; statoDoc: string; documentoPadreId: string | null }>();
      let daRisalire = documenti.map((d) => d.documentoPadreId).filter((x): x is string => Boolean(x));
      for (let salto = 0; salto < 12 && daRisalire.length > 0; salto++) {
        const mancanti = daRisalire.filter((idPadre) => !antenati.has(idPadre));
        if (mancanti.length === 0) break;
        const righe = await prisma.documento.findMany({
          where: { tenantId, id: { in: mancanti } },
          select: { id: true, versione: true, createdAt: true, statoDoc: true, documentoPadreId: true },
        });
        for (const r of righe) antenati.set(r.id, r);
        daRisalire = righe.map((r) => r.documentoPadreId).filter((x): x is string => Boolean(x));
      }

      /** Catena delle versioni precedenti, dalla più recente alla più antica. */
      const storicoDi = (idPadre: string | null) => {
        const catena: { id: string; versione: number; caricatoIl: Date; statoDoc: string; firmatoAt: Date | null }[] = [];
        let corrente = idPadre;
        for (let salto = 0; salto < 12 && corrente; salto++) {
          const nodo = antenati.get(corrente);
          if (!nodo) break;
          const firmaAntenato = firmaClientePerDocumento.get(nodo.id) ?? null;
          catena.push({
            id: nodo.id,
            versione: nodo.versione,
            caricatoIl: nodo.createdAt,
            statoDoc: nodo.statoDoc,
            firmatoAt: firmaAntenato?.firmatoAt ?? null,
          });
          corrente = nodo.documentoPadreId;
        }
        return catena;
      };

      const elenco = documenti.map((d) => {
        // §36 — la firma della copia firmata non punta alla copia ma all'originale che
        // l'ha generata (`riferimentoId` = documentoPadreId): senza questa risalita la
        // copia risulterebbe «firmata» con tutti i dati di firma a null. L'originale
        // legge la propria firma; la copia eredita quella del padre.
        const firma =
          firmaClientePerDocumento.get(d.id) ??
          (d.tipo === 'firmato' && d.documentoPadreId
            ? (firmaClientePerDocumento.get(d.documentoPadreId) ?? null)
            : null);
        const firmaStudio =
          firmaStudioPerDocumento.get(d.id) ??
          (d.tipo === 'firmato' && d.documentoPadreId
            ? (firmaStudioPerDocumento.get(d.documentoPadreId) ?? null)
            : null);
        // I documenti a livello progetto (§2.9) non hanno micro-voce: titolo, modulo e
        // progetto si ripiegano sul collegamento diretto al progetto.
        const nomeProgetto = d.microvoceProgetto?.moduloProgetto.progetto?.nome ?? d.progetto?.nome ?? null;
        const progettoId = d.microvoceProgetto?.moduloProgetto.progettoId ?? d.progettoId ?? null;
        const moduloProgettoId = d.microvoceProgetto?.moduloProgetto.id ?? null;
        const titoloVoce = d.microvoceProgetto?.nome ?? d.progetto?.nome ?? 'Documento';
        const firmatoDaCliente = Boolean(firma) || d.statoDoc === 'firmato';
        const firmatoDaStudio = Boolean(firmaStudio);
        const isFirmato = firmatoDaCliente;
        const copia = copiaPerPadre.get(d.id);
        const urlAttoFirmato =
          firma?.fileFirmatoUrl ||
          copia?.filePdfUrl ||
          copia?.fileUrl ||
          (d.tipo === 'firmato' ? d.filePdfUrl || d.fileUrl : null);
        const urlPdfEffettivo = urlAttoFirmato || (d.filePdfUrl || d.fileUrl);

        return {
          id: d.id,
          nome: nomeFileDaUrl(urlPdfEffettivo) ?? `${titoloVoce} (v${d.versione})`,
          titolo: titoloVoce,
          categoria: d.categoriaDoc || 'generico',
          modulo: d.microvoceProgetto?.moduloProgetto.nome ?? null,
          moduloProgettoId,
          moduloNome: d.microvoceProgetto?.moduloProgetto.nome ?? null,
          microvoceProgettoId: d.microvoceProgettoId ?? d.microvoceProgetto?.id ?? null,
          microvoceNome: d.microvoceProgetto?.nome ?? null,
          progetto: nomeProgetto,
          progettoId,
          // La firma HMAC degli URL /uploads/ scade dopo qualche giorno: si rinnova alla
          // lettura, altrimenti un documento in fascicolo da mesi non si aprirebbe più.
          fileUrl: rifirmaUrlUpload(urlPdfEffettivo) as string,
          // Punto 1 piano gap — formati di export generati dal server: null per i documenti
          // storici (pre-migrazione) e per gli allegati, che restano nel formato originale.
          filePdfUrl: urlPdfEffettivo ? (rifirmaUrlUpload(urlPdfEffettivo) as string) : null,
          fileDocxUrl: d.fileDocxUrl ? (rifirmaUrlUpload(d.fileDocxUrl) as string) : null,
          fileBozzaUrl: d.fileUrl ? (rifirmaUrlUpload(d.fileUrl) as string) : null,
          formatoOrigine: d.formatoOrigine,
          tipo: d.tipo,
          versione: d.versione,
          caricatoIl: d.createdAt,
          scadenza: d.dataScadenzaDoc,
          statoDoc: d.statoDoc,
          // Piano §3 — il livello richiesto, normalizzato dal server (un dato sporco non
          // deve mai bloccare il fascicolo): al portale serve per il gating del flusso.
          livelloFirmaRichiesto: normalizzaLivelloFirma(d.livelloFirmaRichiesto),
          pubblicatoAt: d.pubblicatoAt,
          // §WF-DOC — da dove viene questa versione: l'id del documento sostituito e la
          // catena completa delle versioni precedenti, per risalire il percorso all'indietro.
          documentoPadreId: d.documentoPadreId,
          versioniPrecedenti: storicoDi(d.documentoPadreId),
          richiesteModifica: d.richiesteModifica,
          // §28: un file ancora in scansione o risultato infetto non si scarica e non si firma.
          statoScansione: d.statoScansione,
          scaricabile: d.statoScansione === 'pulito',
          firmato: isFirmato,
          firmatoDaCliente,
          firmatoDaStudio,
          firmaStudio: firmaStudio ? {
            signatureId: firmaStudio.signatureId,
            firmatarioNome: firmaStudio.firmatarioNome,
            valoreLegale: firmaStudio.valoreLegale,
            firmatoAt: firmaStudio.firmatoAt ? firmaStudio.firmatoAt.toISOString() : null,
            standard: firmaStudio.standard,
          } : null,
          // Punto 2 piano gap — il verbale di firma è un atto certificativo: si legge e si
          // scarica, ma non si firma e non si manda in revisione.
          richiedeFirma: !isFirmato && d.statoScansione === 'pulito' && d.statoDoc !== 'in_revisione' && d.tipo !== 'verbale_firma',
          dataFirma: firma?.firmatoAt ?? null,
          tipoFirma: firma?.tipoFirma ?? null,
          signatureId: firma?.signatureId ?? null,
          canaleVerificato: firma?.canaleVerificato ?? null,
          ipAddress: firma?.ipAddress ?? null,
          documentoHash: firma?.documentoHash ?? null,
          firmaGrafometricaPng: firma?.firmaGrafometricaPng ?? null,
          firmatarioNome: firma?.firmatarioNome ?? null,
          // Regola 5 — niente standard di riserva: se il dato manca, il portale dichiara
          // «non registrato» invece di spacciare una SES OTP che il server non ha inciso.
          standard: firma?.standard ?? null,
          fileFirmatoUrl: urlAttoFirmato ? (rifirmaUrlUpload(urlAttoFirmato) as string) : null,
          // Piano §3.1 — il valore legale effettivo della firma apposta: null finché il
          // documento non è firmato (le firme storiche precedenti alla migrazione restano
          // 'ses', che è il comportamento che hanno sempre avuto).
          valoreLegale: firma?.valoreLegale ?? null,
        };
      });

      // Firme il cui documento non è più nel fascicolo (file sostituito, micro-voce rimossa).
      // Restano elencate: una firma registrata è un atto del cliente e non può sparire dalla sua
      // vista perché il file a cui puntava non c'è più.
      const idPresenti = new Set(documenti.map((d) => d.id));
      const orfane = firme
        .filter((f) => f.tipoFirma !== 'studio' && (!f.riferimentoId || !idPresenti.has(f.riferimentoId)))
        .map((f) => ({
          id: `firma-${f.signatureId}`,
          nome: f.documentoTitolo,
          titolo: f.documentoTitolo,
          categoria: 'firmato',
          modulo: null,
          progetto: null,
          progettoId: null,
          fileUrl: null,
          filePdfUrl: null,
          fileDocxUrl: null,
          formatoOrigine: null,
          tipo: 'firmato',
          versione: null,
          caricatoIl: f.firmatoAt,
          scadenza: null,
          statoDoc: 'firmato' as const,
          // Il documento non è più nel fascicolo: il livello che esigeva non si può più
          // risalire. Il valore legale effettivo invece resta, perché vive nella firma.
          livelloFirmaRichiesto: null,
          pubblicatoAt: null,
          richiesteModifica: [],
          statoScansione: null,
          scaricabile: false,
          firmato: true,
          richiedeFirma: false,
          dataFirma: f.firmatoAt,
          tipoFirma: f.tipoFirma,
          signatureId: f.signatureId,
          canaleVerificato: f.canaleVerificato,
          ipAddress: f.ipAddress,
          documentoHash: f.documentoHash,
          firmaGrafometricaPng: f.firmaGrafometricaPng,
          firmatarioNome: f.firmatarioNome,
          standard: f.standard,
          // L'atto firmato sopravvive alla scomparsa del master: vive nella riga della
          // firma, non in quella del documento. Rinnovato perché il portale può offrirlo
          // in download anche quando il file originale non c'è più.
          fileFirmatoUrl: f.fileFirmatoUrl ? (rifirmaUrlUpload(f.fileFirmatoUrl) as string) : null,
          valoreLegale: f.valoreLegale ?? null,
          documentoNonPiuDisponibile: true,
        }));

      return reply.send({ ok: true, documenti: [...elenco, ...orfane] });
    } catch (err) {
      // Nessun ripiego su un elenco vuoto: «nessun documento» e «non riesco a leggere i documenti»
      // sono due cose diverse, e la prima al posto della seconda fa credere al cliente che lo
      // studio non gli abbia caricato niente.
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore lettura documenti del fascicolo',
      });
    }
  });

  /**
   * GET /portal/documenti/:id/download?formato=pdf|docx|firmato — Punto 1 piano gap
   * Il cliente scarica il documento pubblicato nel formato scelto. Il PDF esiste sempre
   * (è il formato master su cui è fissato l'hash legale della firma); il Word esiste solo
   * per i documenti generati dal motore server-side — per i documenti storici precedenti
   * alla migrazione il formato è dichiarato non disponibile, non fabbricato.
   *
   * `formato=firmato` serve l'atto come sottoscritto (§36): il file firmato caricato dal
   * cliente (SES manuale / FEQ di provider) oppure, in mancanza, la copia ricomposta dal
   * motore con la firma dentro. Il master resta scaricabile com'è: i due file sono
   * distinti e il cliente può prendere entrambi — scaricare deve restituire il documento
   * firmato, non solo la certificazione della firma.
   *
   * Un documento ancora in scansione o risultato infetto non si scarica (§28): 409.
   */
  server.get<{
    Params: { id: string };
    Querystring: { formato?: string; clienteId?: string };
  }>('/portal/documenti/:id/download', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, req.query?.clienteId);
    const { id } = req.params;
    const formato =
      req.query?.formato === 'docx' ? 'docx' : req.query?.formato === 'firmato' ? 'firmato' : 'pdf';

    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      const documento = await prisma.documento.findFirst({
        where: {
          id,
          tenantId,
          statoDoc: { in: ['pubblicato', 'in_revisione', 'firmato'] },
          isArchiviato: false,
          OR: [
            { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
            { progetto: { clienteId } },
          ],
        },
        select: {
          id: true,
          statoDoc: true,
          tipo: true,
          fileUrl: true,
          filePdfUrl: true,
          fileDocxUrl: true,
          statoScansione: true,
          versione: true,
          microvoceProgetto: { select: { nome: true } },
          progetto: { select: { nome: true } },
        },
      });

      if (!documento) {
        return reply.code(404).send({ errore: 'Documento non trovato nel fascicolo del cliente.' });
      }
      if (documento.statoScansione !== 'pulito') {
        return reply.code(409).send({ errore: 'Documento non scaricabile: scansione di sicurezza in corso o con esito negativo.' });
      }

      // `Documento` non ha un campo titolo: il nome di ripiego segue la stessa regola
      // dell'elenco del portale (micro-voce → progetto → «Documento») più la versione.
      const titoloVoce = documento.microvoceProgetto?.nome ?? documento.progetto?.nome ?? 'Documento';

      if (formato === 'docx') {
        if (!documento.fileDocxUrl) {
          // Documento storico (pre-migrazione) o allegato caricato: il Word non esiste e
          // il portale deve dirlo, non inventare un file.
          return reply.code(404).send({ errore: 'Formato Word non disponibile per questo documento.' });
        }
        return reply.send({
          ok: true,
          formato,
          url: rifirmaUrlUpload(documento.fileDocxUrl) as string,
          filename: nomeFileDaUrl(documento.fileDocxUrl) ?? `${titoloVoce} (v${documento.versione}).docx`,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
      }

      // §36 — l'atto come sottoscritto: se il cliente richiede esplicitamente `formato=firmato`,
      // oppure `formato=pdf` su un documento che è già stato firmato, deve essere servito
      // l'atto con la firma dentro (file firmato caricato FEQ/SES o copia PDF ricomposta con grafometrica).
      const isFirmato = documento.statoDoc === 'firmato' || documento.tipo === 'firmato';
      if (formato === 'firmato' || (formato === 'pdf' && isFirmato)) {
        const firma = await prisma.firmaElettronica.findFirst({
          where: { tenantId, clienteId, ambito: 'documento_vault', riferimentoId: id },
          select: { fileFirmatoUrl: true },
          orderBy: { firmatoAt: 'desc' },
        });
        if (firma?.fileFirmatoUrl) {
          return reply.send({
            ok: true,
            formato: formato === 'firmato' ? 'firmato' : 'pdf',
            url: rifirmaUrlUpload(firma.fileFirmatoUrl) as string,
            filename: nomeFileDaUrl(firma.fileFirmatoUrl) ?? `${titoloVoce} (v${documento.versione}) firmato.pdf`,
            contentType: firma.fileFirmatoUrl.endsWith('.p7m') ? 'application/octet-stream' : 'application/pdf',
          });
        }
        const copia = await prisma.documento.findFirst({
          where: { tenantId, documentoPadreId: id, tipo: 'firmato', isArchiviato: false },
          select: { fileUrl: true, filePdfUrl: true },
        });
        const urlCopia = copia?.filePdfUrl ?? copia?.fileUrl ?? null;
        if (urlCopia) {
          return reply.send({
            ok: true,
            formato: formato === 'firmato' ? 'firmato' : 'pdf',
            url: rifirmaUrlUpload(urlCopia) as string,
            filename: nomeFileDaUrl(urlCopia) ?? `${titoloVoce} (v${documento.versione}) firmato.pdf`,
            contentType: 'application/pdf',
          });
        }
        if (documento.tipo === 'firmato' && (documento.filePdfUrl || documento.fileUrl)) {
          const urlFirm = (documento.filePdfUrl ?? documento.fileUrl)!;
          return reply.send({
            ok: true,
            formato: formato === 'firmato' ? 'firmato' : 'pdf',
            url: rifirmaUrlUpload(urlFirm) as string,
            filename: nomeFileDaUrl(urlFirm) ?? `${titoloVoce} (v${documento.versione}) firmato.pdf`,
            contentType: 'application/pdf',
          });
        }
        if (formato === 'firmato') {
          return reply.code(404).send({
            errore: 'Nessuna copia firmata separata per questo documento: scarica il PDF master e la ricevuta di firma.',
          });
        }
      }

      // PDF: il formato generato se esiste, altrimenti il file originale
      // (documenti storici e allegati caricati in archivio).
      const urlPdf = documento.filePdfUrl ?? documento.fileUrl;
      if (!urlPdf) {
        return reply.code(404).send({ errore: 'File del documento non disponibile.' });
      }
      return reply.send({
        ok: true,
        formato,
        url: rifirmaUrlUpload(urlPdf) as string,
        filename: nomeFileDaUrl(urlPdf) ?? `${titoloVoce} (v${documento.versione}).pdf`,
        contentType: 'application/pdf',
      });
    } catch (err) {
      return reply.code(500).send({
        errore: err instanceof Error ? err.message : 'Errore nella preparazione del download',
      });
    }
  });

  /**
   * POST /portal/documenti/:id/richiesta-modifica — §WF-DOC
   * Inviata dal cliente per richiedere modifiche e chiarimenti su un documento pubblicato.
   */
  server.post<{
    Params: { id: string };
    Body: { commento: string; clienteId?: string };
  }>('/portal/documenti/:id/richiesta-modifica', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);
    const { id } = req.params;
    const { commento } = req.body;

    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }
    if (!commento || !commento.trim()) {
      return reply.code(400).send({ errore: 'Il commento/nota con le richieste di modifica è obbligatorio.' });
    }

    try {
      const documento = await prisma.documento.findFirst({
        where: {
          id,
          tenantId,
          OR: [
            { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
            { progetto: { clienteId } },
          ],
        },
        include: {
          progetto: { select: { id: true, nome: true, cliente: { select: { nome: true } } } },
          microvoceProgetto: { select: { nome: true } },
          caricatoDaUser: { select: { email: true, nome: true } },
        },
      });

      if (!documento) {
        return reply.code(404).send({ errore: 'Documento non trovato o non associato al cliente.' });
      }

      // Punto 2 piano gap — il verbale di firma è un atto certificativo generato dal sistema:
      // riflette i dati del sigillo, non è un documento dello studio da revisionare. Una
      // richiesta di modifica porterebbe lo stato a 'in_revisione', facendo dire al fascicolo
      // il falso su un atto non negoziabile.
      if (documento.tipo === 'verbale_firma') {
        return reply.code(409).send({
          errore: 'Il verbale di firma è un atto certificativo: non è modificabile e non accetta richieste di revisione.',
        });
      }

      // Crea richiesta di modifica a DB
      const richiesta = await prisma.richiestaModificaDocumento.create({
        data: {
          tenantId,
          documentoId: id,
          clienteId,
          commento: commento.trim(),
          stato: 'aperta',
        },
      });

      // Aggiorna stato documento a 'in_revisione'
      await prisma.documento.update({
        where: { id },
        data: { statoDoc: 'in_revisione' },
      });

      const nomeDoc = nomeFileDaUrl(documento.fileUrl) ?? documento.microvoceProgetto?.nome ?? 'Documento';

      await recordAudit({
        tenantId,
        azione: 'RICHIESTA_MODIFICA_DOCUMENTO',
        entita: richiesta.id,
        dettagli: `Cliente ${clienteId} ha richiesto modifiche su «${nomeDoc}» (${documento.id}): ${commento.trim()}`,
        ipAddress: req.ip,
      });

      // Punto 4 piano gap, riga 2 matrice — il cliente ha chiesto modifiche: lo studio deve
      // vederlo subito alla campanella, non quando riapre il fascicolo. Riusa l'evento
      // esistente `messaggio_cliente` (ogni messaggio del cliente allo studio è quello).
      // La notifica non deve mai bloccare la richiesta di modifica.
      await notificaStudio(tenantId, {
        tipoEvento: 'messaggio_cliente',
        oggetto: 'Richiesta di modifica documento',
        corpo: `${documento.progetto?.cliente?.nome ?? 'Il cliente'} ha richiesto modifiche su «${nomeDoc}»: ${commento.trim().slice(0, 160)}`,
        link: documento.progetto ? `/projects/${documento.progetto.id}` : null,
      }).catch(() => {});

      return reply.send({ ok: true, richiesta });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore registrazione richiesta modifica' });
    }
  });

  server.get<{ Querystring: { clienteId?: string } }>('/portal/canali-firma', async (req, reply) => {
    const tenantId = req.tenantId;
    const clienteId = clienteDellaRichiesta(req, req.query?.clienteId);
    if (!clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true, email: true, cellulare: true, telegramChatId: true, canaleOtpPreferito: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const cred = await credenzialiCanali(tenantId);
      // I recapiti vengono risolti anche dal `referentiJson`: vedi `recapitiCliente`. Prima si
      // leggevano solo le colonne, e per un'anagrafica che ha l'email solo nel JSON questa
      // rotta dichiarava «Nessuna email in anagrafica» con l'indirizzo scritto nella scheda.
      const recapiti = recapitiCliente(cliente);
      const perCanale: Record<CanaleOtp, string | null> = {
        whatsapp: recapiti.cellulare,
        email: recapiti.email,
        telegram: recapiti.telegramChatId,
        signal: recapiti.signal,
      };

      return reply.send({
        ok: true,
        canalePreferito: cliente.canaleOtpPreferito,
        canali: canaliDisponibili(cred, recapiti).map((c) => ({
          canale: c.canale,
          disponibile: c.disponibile,
          motivo: c.motivo,
          // Mascherato: al browser basta che il firmatario si riconosca nel recapito.
          // Telegram non ne ha uno leggibile, la chat id non dice nulla a chi la legge.
          recapitoMascherato:
            c.canale === 'telegram'
              ? recapiti.telegramChatId
                ? 'chat Telegram collegata'
                : null
              : perCanale[c.canale]
                ? mascheraRecapito(perCanale[c.canale] as string)
                : null,
        })),
        botTelegram: cred.tgBotUsername,
        // Fase 3 FEA (misura 1) — l'elenco chiuso dei firmatari che l'anagrafica
        // ammette: il portale lo offre come scelta, e le rotte di firma lo fanno
        // rispettare.
        firmatariAmmessi: firmatariAmmessi(cliente),
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura canali' });
    }
  });

  server.post<{
    Body: {
      canale?: string;
      ambito?: string;
      riferimentoId?: string;
      /** Recapito diverso da quello in anagrafica, dichiarato dal firmatario (§1.2). */
      recapitoDichiarato?: string;
      clienteId?: string;
      signerName?: string;
    };
  }>('/portal/request-otp', async (req, reply) => {
    const tenantId = req.tenantId;
    const { canale, ambito = 'engagement_letter', riferimentoId, recapitoDichiarato } = req.body || {};
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);

    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    if (!canaleValido(canale)) {
      // L'elenco si compone da `CANALI_OTP`: scritto a mano, diceva «whatsapp, email, telegram»
      // anche quando il server ne accettava già altri, e il cliente leggeva un rifiuto che
      // elencava canali diversi da quelli realmente disponibili.
      return reply.code(400).send({ errore: `Canale non valido. Ammessi: ${CANALI_OTP.join(', ')}.` });
    }
    if (!ambitoValido(ambito)) {
      return reply.code(400).send({ errore: 'Ambito di firma non valido.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        select: { nome: true, email: true, cellulare: true, telegramChatId: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      // Anche qui i recapiti arrivano dalle colonne o dal `referentiJson` (vedi
      // `recapitiCliente`): era il punto esatto in cui la richiesta di codice via email si
      // fermava con «Nessuna email in anagrafica» per un cliente che ce l'ha.
      const risolti = recapitiCliente(cliente);
      const inAnagrafica: Record<CanaleOtp, string | null> = {
        whatsapp: risolti.cellulare,
        email: risolti.email,
        telegram: risolti.telegramChatId,
        signal: risolti.signal,
      };

      // Telegram è l'unico canale dove il recapito non si può dichiarare: la chat id non è
      // un dato che il firmatario conosce, la produce il bot quando gli si scrive.
      const dichiarato = canale === 'telegram' ? null : recapitoDichiarato?.trim() || null;
      const target = dichiarato || inAnagrafica[canale];

      if (!target) {
        const cosaManca =
          canale === 'whatsapp'
            ? 'Nessun cellulare in anagrafica: indica un numero o scegli un altro canale.'
            : canale === 'email'
              ? 'Nessuna email in anagrafica: indica un indirizzo o scegli un altro canale.'
              : canale === 'signal'
                ? 'Nessun numero Signal in anagrafica: indicalo, oppure scegli un altro canale.'
                : 'Canale Telegram non collegato: scrivi prima al bot dello studio.';
        return reply.code(400).send({ errore: cosaManca });
      }

      // Enforcement §3.2 — il blocco arriva PRIMA di consumare il codice: se il documento
      // esige FEQ il flusso OTP non potrà mai produrre il valore legale richiesto, e
      // generare il codice (e inviarlo) sarebbe solo spreco e confusione per il cliente.
      // Fase 3: se esige FEA il flusso OTP invece la PRODUCE (grafometrica obbligatoria
      // + sessione certificata in verify-otp-and-sign), quindi il codice si genera.
      const livelloRichiesto = await livelloRichiestoPerFirma(tenantId, clienteId, ambito, riferimentoId);
      const esitoLivello = verificaLivelloFirma({ livelloRichiesto, canale: 'otp' });
      if (!esitoLivello.consentito) {
        return reply
          .code(409)
          .send({ ok: false, errore: esitoLivello.errore, livelloRichiesto: esitoLivello.livelloRichiesto });
      }

      // Fase 3 FEA (misura 1) — il firmatario dichiarato deve essere uno dei nomi che
      // l'anagrafica ammette (il cliente o il suo legale rappresentante). Il blocco
      // precede la generazione del codice: nessun invio parte per un nome che non
      // esiste in scheda, e il codice non si consuma.
      const nomiAmmessi = firmatariAmmessi(cliente);
      const firmatarioDichiarato = req.body?.signerName?.trim() || '';
      if (
        firmatarioDichiarato &&
        !nomiAmmessi.some((n) => n.toLowerCase() === firmatarioDichiarato.toLowerCase())
      ) {
        return reply.code(400).send({
          ok: false,
          errore: `Firmatario non riconosciuto in anagrafica. Ammessi: ${nomiAmmessi.join(', ')}.`,
        });
      }

      const esito = await creaOtp({
        tenantId,
        clienteId,
        canale,
        target,
        targetAnagrafica: inAnagrafica[canale],
        ambito,
        riferimentoId: riferimentoId ?? null,
        ipRichiesta: ipReale(req),
      });

      // 429 e non 400: è un limite di frequenza, e il frontend ci accende il contatore.
      if (!esito.ok || !esito.codice || !esito.otpId) {
        return reply.code(429).send({ ok: false, errore: esito.errore, attendiSecondi: esito.attendiSecondi });
      }

      const invio = await inviaCodiceOtp({
        tenantId,
        canale,
        target,
        codice: esito.codice,
        nomeFirmatario: req.body?.signerName?.trim() || cliente.nome,
        oggettoFirma: DESCRIZIONE_AMBITO[ambito],
        livelloFirma: livelloRichiesto === 'fea' ? 'fea' : 'ses',
      });

      if (!invio.ok) {
        // Il codice va invalidato subito: tenerlo vivo bloccherebbe per un minuto il
        // tentativo su un altro canale, per una consegna che non è avvenuta.
        await annullaOtp(esito.otpId);
        return reply.code(502).send({ ok: false, errore: invio.errore });
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FIRMA_OTP_RICHIESTO',
        entita: cliente.nome,
        dettagli:
          `Codice di firma inviato via ${canale} a ${mascheraRecapito(target)} per ${DESCRIZIONE_AMBITO[ambito]}` +
          (dichiarato ? ' — recapito dichiarato in fase di firma, diverso da quello in anagrafica' : ''),
        ipAddress: ipReale(req),
      });

      return reply.send({
        ok: true,
        canale,
        maskedTarget: mascheraRecapito(target),
        recapitoDichiarato: Boolean(dichiarato),
        expiresInSeconds: TTL_OTP_SECONDI,
        reinviiRimanenti: esito.reinviiRimanenti,
        attesaReinvioSecondi: ATTESA_REINVIO_SECONDI,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore richiesta OTP' });
    }
  });

  /**
   * Impronta SHA-256 di un documento del fascicolo, calcolata dal file che sta in archivio.
   *
   * Il valore che arriva nel body non è una prova: chi firma è anche chi manda la richiesta, e
   * un'impronta scelta dal firmatario descrive il documento che vuole lui, non quello che ha
   * firmato. Per la lettera d'incarico non c'è alternativa — il testo è ancora composto nel
   * browser — ma un documento del fascicolo il file ce l'ha qui, e allora l'impronta si calcola
   * qui. La `where` passa dalla catena microvoce → modulo → progetto → cliente: un id di
   * documento di un altro cliente non trova niente.
   */
  async function improntaDocumentoDelFascicolo(
    tenantId: string,
    clienteId: string,
    documentoId: string,
  ): Promise<{ hash: string; titolo: string; livello: LivelloFirma } | { errore: string; codice: number }> {
    const doc = await prisma.documento.findFirst({
      where: {
        id: documentoId,
        tenantId,
        // §2.9 — il documento appartiene al cliente se è agganciato a una micro-voce di un
        // suo progetto OPPURE direttamente al progetto (upload a livello fascicolo).
        OR: [
          { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
          { progetto: { clienteId } },
        ],
      },
      select: {
        fileUrl: true,
        statoScansione: true,
        statoDoc: true,
        livelloFirmaRichiesto: true,
        microvoceProgetto: { select: { nome: true } },
        progetto: { select: { nome: true } },
      },
    });

    if (!doc) return { errore: 'Documento non presente nel fascicolo di questo cliente.', codice: 404 };

    // §WF-DOC — l'ordine del flusso lo decide il server, non il browser. Prima `/portal/documenti`
    // si limitava a non esporre il bottone (`richiedeFirma: false`): una richiesta costruita a
    // mano firmava comunque una bozza mai pubblicata dall'operatore, o la versione vecchia di un
    // documento per cui il cliente ha appena chiesto una modifica. Il sigillo che ne uscirebbe
    // sarebbe autentico e per questo peggio di una firma mancante: attesterebbe il consenso su un
    // testo che lo studio stava ancora riscrivendo.
    if (doc.statoDoc === 'bozza') {
      return {
        errore: "Il documento è ancora una bozza dello studio: non è firmabile finché non viene pubblicato.",
        codice: 409,
      };
    }
    if (doc.statoDoc === 'in_revisione') {
      return {
        errore:
          'Per questo documento è aperta una richiesta di modifica: la firma si potrà apporre sulla nuova versione, ' +
          'quando lo studio la pubblica.',
        codice: 409,
      };
    }
    if (doc.statoScansione === 'infetto') {
      return { errore: 'Il controllo antivirus ha bloccato questo file: non è firmabile.', codice: 400 };
    }
    if (doc.statoScansione === 'in_corso') {
      return { errore: 'Il controllo antivirus su questo file non è ancora finito: riprova fra poco.', codice: 409 };
    }

    const contenuto = await leggiFileArchivio(doc.fileUrl);
    if (!contenuto || contenuto.length === 0) {
      // Non si ripiega su un'impronta calcolata altrove: un sigillo con l'impronta sbagliata è
      // peggio di una firma non apposta.
      return {
        errore: "Il file del documento non è leggibile dall'archivio: la firma non può essere apposta.",
        codice: 502,
      };
    }

    return {
      hash: crypto.createHash('sha256').update(contenuto).digest('hex'),
      titolo: doc.microvoceProgetto?.nome ?? doc.progetto?.nome ?? 'Documento',
      livello: normalizzaLivelloFirma(doc.livelloFirmaRichiesto),
    };
  }

  /**
   * Conferma di un modulo completato — impronta SHA-256 calcolata dal server sui dati
   * canonici del modulo e delle sue micro-voci. Come per i documenti del fascicolo, non si
   * accetta un hash dal browser: il sigillo deve descrivere ciò che lo studio ha davvero
   * concluso, non ciò che il firmatario dichiara di confermare.
   *
   * Lo `stato` del modulo NON viene toccato qui: §16.2 lo vuole calcolato e mai scritto a
   * mano. La conferma del cliente vive nella riga `FirmaElettronica` (ambito
   * `modulo_completato`), come per i documenti firmati lo stato si deriva dal sigillo.
   */
  async function improntaModuloCompletato(
    tenantId: string,
    clienteId: string,
    moduloId: string,
  ): Promise<{ hash: string; titolo: string; livello: LivelloFirma } | { errore: string; codice: number }> {
    const modulo = await prisma.moduloProgetto.findFirst({
      where: {
        id: moduloId,
        tenantId,
        // Il modulo appartiene al cliente se sta in un suo progetto: stessa catena che
        // `improntaDocumentoDelFascicolo` usa per i documenti.
        progetto: { clienteId },
      },
      select: {
        id: true,
        nome: true,
        categoria: true,
        prezzo: true,
        stato: true,
        progetto: { select: { nome: true } },
        // I livelli di firma vivono sui passaggi (decisione Fase 2 del piano §3): il
        // riferimento della conferma firmata è il modulo, ma il livello che esige è il
        // MASSIMO dei livelli dei suoi passaggi — basta un passaggio FEQ perché l'intero
        // modulo lo esiga.
        microvoci: { select: { nome: true, stato: true, passaggi: { select: { livelloFirmaRichiesto: true } } } },
      },
    });

    if (!modulo) return { errore: 'Il modulo non è presente nei progetti di questo cliente.', codice: 404 };

    // L'ordine del flusso lo decide il server: una richiesta costruita a mano non può
    // confermare un modulo che lo studio non ha ancora concluso. Il sigillo sarebbe
    // autentico e per questo peggio di una firma mancante.
    if (modulo.stato !== 'done') {
      return {
        errore:
          'Il modulo non risulta concluso dallo studio: la conferma si può firmare solo quando le attività sono completate.',
        codice: 409,
      };
    }

    // Un modulo già confermato non si rifirma: due sigilli sullo stesso atto lascerebbero
    // il dubbio su quale faccia fede.
    const giaFirmato = await prisma.firmaElettronica.findFirst({
      where: { tenantId, clienteId, ambito: 'modulo_completato', riferimentoId: moduloId },
      select: { id: true },
    });
    if (giaFirmato) {
      return {
        errore: 'Questo modulo è già stato confermato con firma: una seconda firma non può essere apposta.',
        codice: 409,
      };
    }

    // Ordine deterministico: le micro-voci per nome, così l'impronta non dipende
    // dall'ordine di lettura del database.
    const microvoci = [...modulo.microvoci].sort((a, b) => a.nome.localeCompare(b.nome));
    const contenuto = JSON.stringify({
      tipo: 'conferma_modulo_completato',
      moduloId: modulo.id,
      nome: modulo.nome,
      categoria: modulo.categoria,
      prezzo: modulo.prezzo,
      progetto: modulo.progetto.nome,
      microvoci: microvoci.map((mv) => ({ nome: mv.nome, stato: mv.stato })),
    });

    return {
      hash: crypto.createHash('sha256').update(contenuto).digest('hex'),
      titolo: `${modulo.nome} — ${modulo.progetto.nome}`,
      // `?? []` perché un dato letto senza la relazione (o una micro-voce senza passaggi)
      // non deve far esplodere la firma: il livello assente vale ses, com'è sempre stato.
      livello: livelloPiuAlto(microvoci.flatMap((mv) => (mv.passaggi ?? []).map((p) => p.livelloFirmaRichiesto))),
    };
  }

  /**
   * Enforcement §3.2 — SOLO il livello richiesto, senza leggere i file dall'archivio.
   * `request-otp` deve bloccare il flusso PRIMA di consumare codici OTP e invii, ma in
   * quel punto l'impronta non serve ancora: l'hash viene calcolato in
   * `verify-otp-and-sign`. Le due interrogazioni ricalcano i where delle funzioni di
   * impronta (stesse catene di proprietà, stesso isolamento tenant+cliente).
   *
   * `engagement_letter` e `addendum` non hanno colonna di livello nel database: restano
   * SES (la Fase 2 non cambia ciò che il piano non etichetta).
   */
  async function livelloRichiestoPerFirma(
    tenantId: string,
    clienteId: string,
    ambito: string,
    riferimentoId: string | null | undefined,
  ): Promise<LivelloFirma> {
    if (ambito === 'documento_vault' && riferimentoId) {
      const doc = await prisma.documento.findFirst({
        where: {
          id: riferimentoId,
          tenantId,
          OR: [
            { microvoceProgetto: { moduloProgetto: { progetto: { clienteId } } } },
            { progetto: { clienteId } },
          ],
        },
        select: { livelloFirmaRichiesto: true },
      });
      return normalizzaLivelloFirma(doc?.livelloFirmaRichiesto);
    }
    if (ambito === 'modulo_completato' && riferimentoId) {
      const passaggi = await prisma.passaggioProgetto.findMany({
        where: {
          tenantId,
          microvoceProgetto: { moduloProgettoId: riferimentoId, moduloProgetto: { progetto: { clienteId } } },
        },
        select: { livelloFirmaRichiesto: true },
      });
      return livelloPiuAlto(passaggi.map((p) => p.livelloFirmaRichiesto));
    }
    return 'ses';
  }

  /**
   * §WF-DOC — lo schema dichiara `firmato` «stato terminale positivo», ma nessuna delle due
   * rotte di firma lo scriveva: il documento restava `pubblicato` (o `in_revisione`) per
   * sempre. Portale e scheda dello studio derivano «firmato» dall'esistenza della riga
   * `FirmaElettronica`, quindi l'incoerenza non si vedeva nella UI — ma `stato_doc` diceva il
   * falso a chiunque leggesse il database, e `@@index([statoDoc])` non serviva a trovare i
   * documenti firmati.
   *
   * `updateMany` e non `update`: la clausola porta il tenant, e non solleva se la riga non c'è.
   */
  async function segnaDocumentoFirmato(tenantId: string, documentoId: string) {
    try {
      await prisma.documento.updateMany({
        where: { id: documentoId, tenantId },
        data: { statoDoc: 'firmato' },
      });
    } catch (err) {
      // La firma è già registrata e resta valida: l'aggiornamento dello stato non deve farla
      // fallire a posteriori. Va però nei log, perché lascia il fascicolo incoerente.
      console.error('Stato documento non aggiornato a «firmato» dopo la firma', documentoId, err);
    }
  }

  /**
   * §36 — la copia firmata del documento del Vault: lo stesso atto ricomposto dai blocchi
   * salvati alla generazione, con la grafometrica disegnata dentro l'area `{{firma_cliente}}`.
   *
   * Serve solo alla rotta OTP/FEA: nel canale «file caricato» la sottoscrizione è già dentro
   * il file che il cliente ha ricaricato (`fileFirmatoUrl`), e ricomporre il documento da
   * template sostituirebbe la prova con una resa fatta dal server.
   *
   * Il servizio ritorna `null` senza sollevare quando la copia non si può o non si deve fare
   * (documento anteriore a §36, template senza segnaposto, allegato caricato a mano): non è
   * un errore e non va nell'audit, sarebbe rumore su ogni firma di ogni documento vecchio.
   *
   * L'esito risale al chiamante e da lì al sigillo di risposta: la ricevuta del cliente
   * può offrire il PDF firmato appena generato invece del master pre-firma.
   */
  async function archiviaCopiaFirmata(params: {
    tenantId: string;
    documentoId: string;
    firma: {
      signatureId: string;
      firmatarioNome: string;
      firmatoAt: Date;
      valoreLegale?: string | null;
      firmaGrafometricaPng?: string | null;
    };
    sigilloDigest: string;
    documentoTitolo: string;
    ipAddress: string | null;
  }): Promise<EsitoCopiaFirmata | null> {
    const esito = await generaCopiaFirmata({
      tenantId: params.tenantId,
      documentoId: params.documentoId,
      firma: params.firma,
      sigilloDigest: params.sigilloDigest,
    });
    if (!esito) return null;
    await recordAudit({
      tenantId: params.tenantId,
      userId: null,
      ruolo: null,
      azione: 'COPIA_FIRMATA_GENERATA',
      entita: esito.documentoId,
      dettagli:
        `Copia firmata «${esito.nome}» generata per ${params.firma.signatureId} su "${params.documentoTitolo}": ` +
        `la firma di ${params.firma.firmatarioNome} è apposta dentro il documento. ` +
        `L'originale ${params.documentoId} resta invariato (è il file su cui è fissato l'hash del sigillo).`,
      ipAddress: params.ipAddress,
    }).catch(() => {});
    return esito;
  }

  /**
   * Punto 2 piano gap — il verbale di firma. FirmaElettronica contiene i dati probatori ma
   * nessun documento umano-leggibile: questa funzione genera il PDF del verbale, lo carica
   * come Documento (tipo 'verbale_firma') nel fascicolo e collega la firma al documento.
   *
   * Stessa logica di segnaDocumentoFirmato: è un effetto collaterale della firma, non un
   * suo requisito di validità. Se la generazione fallisce (storage, DB, PDF) la firma resta
   * valida e il sigillo resta nel database; il fallimento va nei log.
   *
   * `caricatoDa` è null: il firmatario cliente ha identità `client-<id>` che non è una riga
   * della tabella user, e attribuire il verbale a un utente dello studio sarebbe
   * un'attestazione falsa in un atto certificativo.
   */
  async function generaVerbaleDiFirma(params: {
    tenantId: string;
    clienteId: string;
    clienteNome: string;
    firma: {
      id: string;
      signatureId: string;
      tipoFirma: string;
      standard: string;
      documentoTitolo: string;
      documentoHash: string;
      firmatarioNome: string;
      firmatarioRuolo: string | null;
      canaleVerificato: string | null;
      codiceOtpId: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      firmaGrafometricaPng?: string | null;
      fileFirmatoHash?: string | null;
      /** Piano §3.1 — valore legale effettivo, scritto dal server al momento della firma. */
      valoreLegale?: string | null;
      // Fase 3 FEA — sessione certificata e documento di riconoscimento: le colonne sono
      // nullable additive, quindi il record della firma ne è sempre portatore (a null per
      // le SES e per il canale file); il verbale li cita solo quando esistono davvero.
      sessionId?: string | null;
      loginAt?: Date | null;
      docRiconoscimentoHash?: string | null;
      docRiconoscimentoTipo?: string | null;
      firmatoAt: Date;
    };
    /** Impronta SHA-256 del sigillo: è calcolata dal builder del sigillo, non dalla firma. */
    sigilloDigest: string;
    ambito: string;
    riferimentoId: string | null;
  }): Promise<void> {
    const { tenantId, clienteId, clienteNome, firma, sigilloDigest, ambito, riferimentoId } = params;
    try {
      // 1. Collocazione nel fascicolo: il verbale segue il documento che certifica. Per il
      //    Vault copia progetto/microvoce dall'originale; per un modulo risale al progetto;
      //    altrimenti (engagement_letter, addendum, o riferimento mancante) va nell'ultimo
      //    progetto del cliente. Il null è l'extrema ratio: il verbale esiste comunque.
      let progettoId: string | null = null;
      let microvoceProgettoId: string | null = null;
      if (ambito === 'documento_vault' && riferimentoId) {
        const originale = await prisma.documento.findFirst({
          where: { id: riferimentoId, tenantId },
          select: { progettoId: true, microvoceProgettoId: true },
        });
        progettoId = originale?.progettoId ?? null;
        microvoceProgettoId = originale?.microvoceProgettoId ?? null;
      } else if (ambito === 'modulo_completato' && riferimentoId) {
        const modulo = await prisma.moduloProgetto.findFirst({
          where: { id: riferimentoId, tenantId },
          select: { progettoId: true },
        });
        progettoId = modulo?.progettoId ?? null;
      }
      if (!progettoId && !microvoceProgettoId) {
        const progetto = await prisma.progetto.findFirst({
          where: { clienteId },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        progettoId = progetto?.id ?? null;
      }

      // 2. Dettagli OTP: il record di verifica porta canale/target/origine, ma servono anche
      //    l'ultimo invio e il momento dell'uso — il verbale dice quando il fattore è stato
      //    consegnato e quando è stato speso.
      let otp: {
        canale: string;
        target: string;
        targetDichiarato: boolean;
        targetAnagrafica: string | null;
        ultimoInvioAt: Date | null;
        usatoAt: Date | null;
      } | null = null;
      if (firma.codiceOtpId) {
        otp = await prisma.codiceOtp.findFirst({
          where: { id: firma.codiceOtpId, tenantId },
          select: {
            canale: true,
            target: true,
            targetDichiarato: true,
            targetAnagrafica: true,
            ultimoInvioAt: true,
            usatoAt: true,
          },
        });
      }

      // 3. Il PDF. compress: false — è un atto che deve restare ispezionabile sul file.
      const pdf = await generaPdfVerbaleFirma({
        signatureId: firma.signatureId,
        tipoFirma: firma.tipoFirma,
        standard: firma.standard,
        valoreLegale: firma.valoreLegale ?? null,
        documentoTitolo: firma.documentoTitolo,
        documentoHash: firma.documentoHash,
        firmatarioNome: firma.firmatarioNome,
        firmatarioRuolo: firma.firmatarioRuolo,
        clienteNome,
        canaleVerificato: firma.canaleVerificato,
        timestampIso: firma.firmatoAt.toISOString(),
        ipAddress: firma.ipAddress,
        userAgent: firma.userAgent,
        sha256Digest: sigilloDigest,
        otp,
        firmaGrafometricaPng: firma.firmaGrafometricaPng ?? null,
        fileFirmatoHash: firma.fileFirmatoHash ?? null,
        // Fase 3 FEA — passati al builder che li cita solo se presenti.
        sessionId: firma.sessionId ?? null,
        loginAt: firma.loginAt ?? null,
        docRiconoscimentoHash: firma.docRiconoscimentoHash ?? null,
        docRiconoscimentoTipo: firma.docRiconoscimentoTipo ?? null,
      });

      // 4. Upload + riga Documento. statoDoc 'pubblicato': il verbale è visibile subito al
      //    cliente, non passa da bozza perché non c'è revisione possibile su un atto
      //    certificativo generato dal sistema.
      const caricato = await uploadDocumento(`verbale_firma_${firma.signatureId}.pdf`, pdf.toString('base64'), tenantId);
      const verbale = await prisma.documento.create({
        data: {
          tenantId,
          progettoId,
          microvoceProgettoId,
          tipo: 'verbale_firma',
          fileUrl: caricato.url,
          caricatoDa: null,
          categoriaDoc: 'generico',
          statoDoc: 'pubblicato',
          pubblicatoAt: new Date(),
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
        },
      });

      // 5. Collega la firma al suo verbale: dal fascicolo si può risalire all'evento
      //    probatorio e viceversa.
      await prisma.firmaElettronica.update({
        where: { id: firma.id },
        data: { verbaleDocumentoId: verbale.id },
      });

      await recordAudit({
        tenantId,
        userId: null,
        ruolo: null,
        azione: 'VERBALE_FIRMA_GENERATO',
        entita: firma.signatureId,
        dettagli: `Verbale di firma generato automaticamente per ${firma.signatureId} su "${firma.documentoTitolo}". Documento: ${verbale.id}.`,
        ipAddress: firma.ipAddress,
      }).catch(() => {});

      // Il cliente deve sapere che l'atto esiste e dove trovarlo.
      await notificaCliente(tenantId, clienteId, {
        tipoEvento: 'verbale_disponibile',
        oggetto: 'Verbale di firma disponibile',
        corpo: `Il verbale della firma su «${firma.documentoTitolo}» è disponibile nel tuo fascicolo documenti.`,
        link: '/portal/documents',
      }).catch(() => {});
    } catch (err) {
      // Il verbale è documentazione della firma, non un suo elemento costitutivo: se la
      // generazione fallisce il sigillo e la firma restano pienamente validi.
      console.error('Verbale di firma non generato: la firma resta valida', firma.signatureId, err);
    }
  }

  server.post<{
    Body: {
      otp: string;
      signerName?: string;
      firmatarioRuolo?: string;
      documentoTitolo?: string;
      documentoHash?: string;
      ambito?: string;
      riferimentoId?: string;
      clienteId?: string;
      /**
       * Grafometrica allegata al sigillo (§1.11). Fase 3: quando il documento esige FEA
       * è OBBLIGATORIA e viene valutata PRIMA di consumare l'OTP (misura 2); quando il
       * documento non esige nulla di più resta facoltativa.
       */
      firmaGrafometricaPng?: string;
      /** Fase 3 FEA (misura 1) — documento di riconoscimento del firmatario, facoltativo. */
      docRiconoscimentoBase64?: string;
      /** Tipo dichiarato del documento (carta d'identità, passaporto…): va nel verbale. */
      docRiconoscimentoTipo?: string;
    };
  }>('/portal/verify-otp-and-sign', async (req, reply) => {
    const tenantId = req.tenantId;
    const { otp, ambito = 'engagement_letter', riferimentoId, documentoHash, firmaGrafometricaPng } = req.body || {};
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);

    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    if (!otp || !/^\d{6}$/.test(otp.trim())) {
      return reply.code(400).send({ ok: false, errore: 'Il codice è composto da 6 cifre.' });
    }
    if (!ambitoValido(ambito)) return reply.code(400).send({ errore: 'Ambito di firma non valido.' });

    // Il sigillo deve identificare il testo firmato. Prima, in mancanza di hash, ne scriveva
    // uno finto ('DOC_ORIGINAL_HASH'): un verbale che certifica la volontà su un documento
    // qualunque. Senza impronta la firma non si appone.
    //
    // Per un documento del fascicolo l'impronta la calcola il server dal file in archivio, e
    // quella eventualmente mandata dal browser viene ignorata: vedi
    // `improntaDocumentoDelFascicolo`. Per la conferma di un modulo completato la calcola
    // sempre il server, dai dati del modulo: vedi `improntaModuloCompletato`. Per la lettera
    // d'incarico resta quella del browser, perché il testo è ancora composto lì.
    const vault = ambito === 'documento_vault' && riferimentoId;
    const moduloCompletato = ambito === 'modulo_completato';
    if (!vault && !moduloCompletato && (!documentoHash || !HASH_SHA256.test(documentoHash.trim()))) {
      return reply
        .code(400)
        .send({ errore: 'Impronta SHA-256 del documento mancante o non valida: la firma non può essere apposta.' });
    }
    if (ambito === 'documento_vault' && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il documento da firmare.' });
    }
    if (moduloCompletato && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il modulo da confermare.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        // Fase 3 FEA (misura 1) — il `referentiJson` porta il legale rappresentante:
        // da qui nasce l'elenco dei firmatari ammessi.
        select: { nome: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      // L'impronta si risolve PRIMA di consumare il codice: il codice è monouso, e bruciarlo
      // per un file illeggibile costringerebbe il cliente a rifare tutto il giro.
      let improntaFinale = (documentoHash ?? '').trim().toLowerCase();
      let titoloDalFascicolo: string | null = null;
      let livelloRichiesto: LivelloFirma = 'ses';
      if (vault && riferimentoId) {
        const esito = await improntaDocumentoDelFascicolo(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
        livelloRichiesto = esito.livello;
      }
      if (moduloCompletato && riferimentoId) {
        const esito = await improntaModuloCompletato(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
        livelloRichiesto = esito.livello;
      }

      // Enforcement §3.2 ribadito al momento della firma, non solo alla richiesta del
      // codice: tra request-otp e verify-otp l'operatore può aver alzato il livello, e il
      // codice già emesso non rende legittima una firma che il documento ora non ammette.
      // Il blocco sta PRIMA di verificaOtp proprio per non bruciare il codice monouso.
      const esitoLivello = verificaLivelloFirma({ livelloRichiesto, canale: 'otp' });
      if (!esitoLivello.consentito) {
        return reply
          .code(409)
          .send({ ok: false, errore: esitoLivello.errore, livelloRichiesto: esitoLivello.livelloRichiesto });
      }

      // Fase 3 FEA (misura 1) — chi firma deve essere uno dei nomi che l'anagrafica
      // ammette (il cliente o il suo legale rappresentante). Il blocco precede
      // verificaOtp come quello del livello: il codice è monouso e bruciarlo per un
      // firmatario non riconosciuto costringerebbe il cliente a rifare il giro.
      const nomiAmmessi = firmatariAmmessi(cliente);
      const firmatarioDichiarato = req.body?.signerName?.trim() || '';
      if (
        firmatarioDichiarato &&
        !nomiAmmessi.some((n) => n.toLowerCase() === firmatarioDichiarato.toLowerCase())
      ) {
        return reply.code(400).send({
          ok: false,
          errore: `Firmatario non riconosciuto in anagrafica. Ammessi: ${nomiAmmessi.join(', ')}.`,
        });
      }

      // Fase 3 FEA (misura 2) — rafforzamento del controllo esclusivo: quando il documento
      // esige FEA la firma grafica (grafometrica) è obbligatoria, perché lega l'apposizione
      // al gesto del firmatario specifico. Il rifiuto sta PRIMA di verificaOtp, come quelli
      // sopra: il codice è monouso e non va bruciato per una firma che non si può apporre.
      const grafometrica = normalizzaGrafometrica(firmaGrafometricaPng);
      if (livelloRichiesto === 'fea' && !grafometrica) {
        return reply.code(400).send({
          ok: false,
          errore:
            "Questo documento richiede Firma Elettronica Avanzata: l'apposizione della firma grafica è obbligatoria.",
        });
      }

      // Fase 3 FEA (misura 1) — documento di riconoscimento del firmatario, caricato una
      // tantum quando firma (raccomandato, non obbligatorio). L'hash NON lo dichiara il
      // client (regola §6.3 del piano): arriva il file, lo scannerizza il server e lo
      // SHA-256 lo calcola il server. Anche questo sta PRIMA di verificaOtp: un file
      // rifiutato non deve consumare il codice.
      let docRiconoscimentoHash: string | null = null;
      const docRiconoscimentoBase64 = (req.body?.docRiconoscimentoBase64 || '').trim();
      if (docRiconoscimentoBase64) {
        const docRiconoscimento = Buffer.from(
          docRiconoscimentoBase64.replace(/^data:[^;]+;base64,/, ''),
          'base64',
        );
        if (docRiconoscimento.length === 0) {
          return reply
            .code(400)
            .send({ ok: false, errore: 'Documento di riconoscimento vuoto o illeggibile.' });
        }
        const scanDoc = scanFileBuffer(docRiconoscimento, 'documento-di-riconoscimento');
        if (!scanDoc.safe) {
          return reply.code(400).send({
            ok: false,
            errore: `Documento di riconoscimento non ammesso: ${scanDoc.reason || 'contenuto non sicuro'}.`,
          });
        }
        docRiconoscimentoHash = crypto.createHash('sha256').update(docRiconoscimento).digest('hex');
      }
      const docRiconoscimentoTipo = docRiconoscimentoHash
        ? req.body?.docRiconoscimentoTipo?.trim() || null
        : null;

      // Fase 3 FEA (misura 3) — certificato di sessione: il sid e l'iat del login del
      // portale finiscono nel digest del sigillo, a legare la firma alla sessione
      // verificata. Assenti nei token emessi prima della Fase 3 (login operatore o vecchi
      // magic link): il sigillo li registra come 'non-registrato', senza inventarli.
      const sidSessione = req.user?.sid ?? null;
      const loginAt = typeof req.user?.iat === 'number' ? new Date(req.user.iat * 1000) : null;

      const verifica = await verificaOtp(clienteId, otp, ambito, riferimentoId ?? null);
      if (!verifica.valido || !verifica.record) {
        return reply.code(400).send({ ok: false, errore: verifica.motivo });
      }
      const documentoTitolo =
        req.body?.documentoTitolo?.trim() || titoloDalFascicolo || DESCRIZIONE_AMBITO[ambito];
      const firmatarioNome = req.body?.signerName?.trim() || cliente.nome;

      // Quando il documento non esige nulla di più, l'OTP verificato su recapito in
      // anagrafica è una Firma Elettronica Semplice (art. 20 CAD) e lo standard va
      // dichiarato esplicitamente — il sigillo, il DB, l'audit e il verbale devono dire
      // tutti la stessa cosa. Fase 3: quando invece esige FEA, questo flusso misurato la
      // produce davvero (grafometrica obbligatoria, sessione certificata, firmatario
      // identificato), e il sigillo dichiara il livello reale di quel ramo.
      const isFea = livelloRichiesto === 'fea';
      const sigillo = creaSigilloFea({
        clienteId,
        signerName: firmatarioNome,
        documentoTitolo,
        documentoHash: improntaFinale,
        // L'IP della *verifica*, non quello della richiesta del codice: è il momento in cui
        // la volontà viene manifestata.
        ip: ipReale(req),
        userAgent: req.headers['user-agent'] || null,
        canaleVerificato: descriviCanaleVerificato(verifica.record),
        standard: isFea ? STANDARD_FEA : STANDARD_SES,
        valoreLegale: isFea ? 'fea' : 'ses',
        // Fase 3 FEA (misure 1 e 3) — sessione certificata e documento di riconoscimento
        // entrano nel digest SOLO nel ramo FEA: le firme SES restano byte-identiche a
        // prima, e i loro sigilli dicono 'non-registrato' come hanno sempre fatto.
        sessionId: isFea ? sidSessione : null,
        loginAt: isFea ? loginAt : null,
        docRiconoscimentoHash: isFea ? docRiconoscimentoHash : null,
        docRiconoscimentoTipo: isFea ? docRiconoscimentoTipo : null,
      });

      const firma = await prisma.firmaElettronica.create({
        data: {
          tenantId,
          clienteId,
          signatureId: sigillo.signatureId,
          tipoFirma: 'fea_otp',
          ambito,
          riferimentoId: riferimentoId ?? null,
          documentoTitolo,
          firmatarioNome,
          firmatarioRuolo: req.body?.firmatarioRuolo?.trim() || null,
          documentoHash: sigillo.documentoHash,
          canaleVerificato: sigillo.canaleVerificato,
          codiceOtpId: verifica.record.id,
          ipAddress: sigillo.ipAddress,
          userAgent: sigillo.userAgent,
          firmaGrafometricaPng: grafometrica,
          standard: sigillo.standard,
          // Vincolo 7 — il valore legale effettivo lo scrive il server, mai il frontend.
          // Fase 3: se il documento esige FEA il flusso misurato di questa rotta la
          // produce davvero, e qui finisce 'fea'; per tutto il resto la rotta produce
          // SES (art. 20 CAD), come ha sempre fatto.
          valoreLegale: isFea ? 'fea' : 'ses',
          // Fase 3 FEA — persist di sessione certificata e documento di riconoscimento
          // (colonne nullable additive: restano vuote per le firme SES).
          sessionId: sigillo.sessionId,
          loginAt: sigillo.loginAt,
          docRiconoscimentoHash: sigillo.docRiconoscimentoHash,
          docRiconoscimentoTipo: sigillo.docRiconoscimentoTipo,
          firmatoAt: new Date(sigillo.timestampIso),
        },
      });

      // L'esito della copia §36 serve al sigillo di risposta («scarica il PDF firmato»):
      // sta fuori dal blocco perché il seal si costruisce più avanti, dopo il verbale.
      let esitoCopia: EsitoCopiaFirmata | null = null;
      if (vault && riferimentoId) {
        await segnaDocumentoFirmato(tenantId, riferimentoId);
        // §36 — la firma entra nel documento. Effetto collaterale, non requisito: se non
        // esce, l'originale è firmato a tutti gli effetti e il sigillo resta valido.
        esitoCopia = await archiviaCopiaFirmata({
          tenantId,
          documentoId: riferimentoId,
          firma: {
            signatureId: firma.signatureId,
            firmatarioNome: firma.firmatarioNome,
            firmatoAt: firma.firmatoAt,
            valoreLegale: firma.valoreLegale,
            firmaGrafometricaPng: grafometrica,
          },
          sigilloDigest: sigillo.sha256Digest,
          documentoTitolo,
          ipAddress: sigillo.ipAddress,
        });
        if (esitoCopia?.url) {
          await prisma.firmaElettronica.update({
            where: { id: firma.id },
            data: { fileFirmatoUrl: esitoCopia.url },
          }).catch(() => {});
        }
      }

      // L'azione di audit dichiara il valore legale REALE della firma apposta:
      // `FIRMA_SES_APPOSTA` per la firma semplice, `FIRMA_FEA_APPOSTA` per il flusso
      // misurato della Fase 3. I log storici con l'azione SES restano leggibili e intatti.
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: isFea ? 'FIRMA_FEA_APPOSTA' : 'FIRMA_SES_APPOSTA',
        entita: cliente.nome,
        dettagli: isFea
          ? `Firma Elettronica Avanzata ${sigillo.signatureId} su "${documentoTitolo}" da ${firmatarioNome}. ` +
            `${sigillo.canaleVerificato}. Sessione portale: ${sidSessione ?? 'non registrata'}. ` +
            `Documento di riconoscimento: ${docRiconoscimentoHash ? `caricato (SHA-256 ${docRiconoscimentoHash.slice(0, 16)}…)` : 'non caricato'}. ` +
            `IP: ${sigillo.ipAddress ?? 'non registrato'}.`
          : `Firma Elettronica Semplice ${sigillo.signatureId} su "${documentoTitolo}" da ${firmatarioNome}. ` +
            `${sigillo.canaleVerificato}. IP: ${sigillo.ipAddress ?? 'non registrato'}.`,
        ipAddress: sigillo.ipAddress,
      });

      // Blocco 3 — firma apposta: lo studio lo vede subito, il cliente ne ha conferma.
      // Wording allineato al valore legale reale (commit 0509f96): SES quando il flusso
      // OTP produce la firma semplice ex art. 20 CAD, FEA quando il documento esigeva il
      // flusso misurato della Fase 3.
      await notificaStudio(tenantId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma apposta',
        corpo: isFea
          ? `${firmatarioNome} (${cliente.nome}) ha firmato «${documentoTitolo}» con Firma Elettronica Avanzata (OTP verificata + firma grafica · eIDAS art. 26).`
          : `${firmatarioNome} (${cliente.nome}) ha firmato «${documentoTitolo}» con Firma Elettronica Semplice (OTP verificata · art. 20 CAD).`,
        link: null,
      }).catch(() => {});
      await notificaCliente(tenantId, clienteId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma registrata',
        corpo: `La tua firma su «${documentoTitolo}» è stata registrata correttamente.`,
        // La conferma di un modulo si rivede nell'avanzamento, non nel fascicolo documenti.
        link: moduloCompletato ? '/portal/avanzamento' : '/portal/documents',
      }).catch(() => {});

      // L'attivazione del progetto riguarda solo la lettera d'incarico: prima avveniva a
      // ogni firma, quindi anche prendere visione di un documento faceva scattare un
      // progetto in lavorazione.
      let progettoAttivato: string | null = null;
      if (ambito === 'engagement_letter') {
        try {
          const prj = await prisma.progetto.findFirst({
            where: { clienteId },
            orderBy: { createdAt: 'desc' },
          });
          if (prj && prj.stato !== 'in_progress') {
            await prisma.progetto.update({ where: { id: prj.id }, data: { stato: 'in_progress' } });
            progettoAttivato = prj.id;
          }
        } catch {
          // L'attivazione è un effetto collaterale: se salta, la firma resta valida.
        }
      }

      // Punto 2 piano gap — il verbale si genera DOPO l'attivazione del progetto: per
      // l'engagement_letter il collegamento al fascicolo cerca l'ultimo progetto del
      // cliente, che a questo punto è già in lavorazione.
      await generaVerbaleDiFirma({
        tenantId,
        clienteId,
        clienteNome: cliente.nome,
        firma,
        sigilloDigest: sigillo.sha256Digest,
        ambito,
        riferimentoId: riferimentoId ?? null,
      });

      return reply.send({
        ok: true,
        seal: {
          ...sigillo,
          id: firma.id,
          tipoFirma: 'fea_otp',
          // Il PDF con la firma DENTRO (copia §36): il cliente scarica l'atto sottoscritto,
          // non solo la certificazione. Null se la copia non è uscita (documento pre-§36,
          // template senza segnaposto): la ricevuta non offre ciò che non esiste.
          fileUrl: esitoCopia ? (rifirmaUrlUpload(esitoCopia.url) as string) : null,
          documentoFirmatoId: esitoCopia?.documentoId ?? null,
        },
        progettoAttivato,
        message: isFea
          ? 'Firma Elettronica Avanzata registrata (eIDAS art. 26 · art. 25 CAD).'
          : 'Firma Elettronica Semplice registrata (art. 20 CAD).',
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore verifica OTP e firma' });
    }
  });

  /**
   * Le altre due strade di firma richieste (§1.3): il documento scaricato, firmato a penna e
   * ricaricato, e quello firmato con il provider di firma digitale del cliente.
   *
   * Qui la prova non è l'OTP ma il file: la firma è già dentro al documento. L'OTP resta
   * accettato e, se presente, viene citato nel sigillo — non è obbligatorio, perché
   * pretenderlo non aggiungerebbe nulla a una firma qualificata apposta altrove.
   */
  server.post<{
    Body: {
      tipoFirma?: string;
      ambito?: string;
      riferimentoId?: string;
      clienteId?: string;
      documentoTitolo?: string;
      documentoHash?: string;
      filename?: string;
      contentBase64?: string;
      signerName?: string;
      firmatarioRuolo?: string;
      otp?: string;
    };
  }>('/portal/firma-con-file', async (req, reply) => {
    const tenantId = req.tenantId;
    const { tipoFirma, ambito = 'engagement_letter', riferimentoId, documentoHash, filename, contentBase64 } =
      req.body || {};
    const clienteId = clienteDellaRichiesta(req, req.body?.clienteId);

    if (!clienteId) return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    if (tipoFirma !== 'manuale_scansionata' && tipoFirma !== 'qualificata_esterna') {
      return reply
        .code(400)
        .send({ errore: 'tipoFirma ammessi: manuale_scansionata, qualificata_esterna.' });
    }
    if (!ambitoValido(ambito)) return reply.code(400).send({ errore: 'Ambito di firma non valido.' });
    if (!filename || !contentBase64) {
      return reply.code(400).send({ errore: 'File firmato mancante.' });
    }
    // Come nella firma con codice: per un documento del fascicolo l'impronta dell'originale la
    // calcola il server dal file in archivio, e per un modulo completato dai dati del modulo —
    // mai il browser.
    const vault = ambito === 'documento_vault' && riferimentoId;
    const moduloCompletato = ambito === 'modulo_completato';
    if (!vault && !moduloCompletato && (!documentoHash || !HASH_SHA256.test(documentoHash.trim()))) {
      return reply
        .code(400)
        .send({ errore: 'Impronta SHA-256 del documento originale mancante o non valida.' });
    }
    if (ambito === 'documento_vault' && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il documento a cui si riferisce la firma.' });
    }
    if (moduloCompletato && !riferimentoId) {
      return reply.code(400).send({ errore: 'Manca il modulo a cui si riferisce la firma.' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: clienteId, tenantId },
        // Fase 3 FEA (misura 1) — il `referentiJson` porta il legale rappresentante:
        // anche su questo canale l'elenco dei firmatari ammessi nasce dall'anagrafica.
        select: { nome: true, referentiJson: true },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato.' });

      const buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      // Lo stesso controllo degli altri caricamenti: un portale cliente è la porta più
      // esposta che abbiamo, e qui il file arriva da fuori.
      const scan = scanFileBuffer(buffer, filename);
      if (!scan.safe) {
        return reply.code(400).send({ errore: `File rifiutato: ${scan.reason}` });
      }

      // FEQ onesta (audit 21/09/2026): la firma qualificata esterna deve contenere davvero
      // una firma digitale (PAdES o PKCS#7/CAdES), non essere un PDF qualunque marcato FEQ.
      // Il blocco precede il consumo di OTP e l'upload. La scansione autografa
      // (`manuale_scansionata`) resta SES e non passa di qui.
      if (tipoFirma === 'qualificata_esterna') {
        const esitoFirmaFile = fileContieneFirmaDigitale(buffer, filename);
        if (!esitoFirmaFile.firmato) {
          return reply.code(422).send({ ok: false, errore: esitoFirmaFile.motivo });
        }
      }

      let codiceOtpId: string | null = null;
      let descrizioneOtp = '';

      // Prima di consumare l'eventuale codice: se il file originale non è leggibile la firma
      // non si appone, e il codice deve restare valido.
      let improntaFinale = (documentoHash ?? '').trim().toLowerCase();
      let titoloDalFascicolo: string | null = null;
      let livelloRichiesto: LivelloFirma = 'ses';
      if (vault && riferimentoId) {
        const esito = await improntaDocumentoDelFascicolo(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
        livelloRichiesto = esito.livello;
      }
      if (moduloCompletato && riferimentoId) {
        const esito = await improntaModuloCompletato(tenantId, clienteId, riferimentoId);
        if ('errore' in esito) return reply.code(esito.codice).send({ errore: esito.errore });
        improntaFinale = esito.hash;
        titoloDalFascicolo = esito.titolo;
        livelloRichiesto = esito.livello;
      }

      // Enforcement §3.2 — canale `file`: chi firma con il proprio provider di firma
      // digitale (`qualificata_esterna`) produce un valore legale SUPERIORE, che soddisfa
      // sia la FEQ sia la FEA; la sottoscrizione autografa scansionata non ne produce
      // nessuno dei due e resta 409. Il blocco sta PRIMA dell'upload e dell'eventuale
      // OTP: nessuna risorsa consumata.
      const esitoLivello = verificaLivelloFirma({ livelloRichiesto, canale: 'file', tipoFirma });
      if (!esitoLivello.consentito) {
        return reply
          .code(409)
          .send({ ok: false, errore: esitoLivello.errore, livelloRichiesto: esitoLivello.livelloRichiesto });
      }

      // Fase 3 FEA (misura 1) — chi firma deve essere uno dei nomi che l'anagrafica
      // ammette (il cliente o il suo legale rappresentante): anche su questo canale
      // un nome digitato liberamente non identifica il firmatario. Il blocco precede
      // l'upload e l'eventuale OTP, come quello del livello.
      const nomiAmmessi = firmatariAmmessi(cliente);
      const firmatarioDichiarato = req.body?.signerName?.trim() || '';
      if (
        firmatarioDichiarato &&
        !nomiAmmessi.some((n) => n.toLowerCase() === firmatarioDichiarato.toLowerCase())
      ) {
        return reply.code(400).send({
          ok: false,
          errore: `Firmatario non riconosciuto in anagrafica. Ammessi: ${nomiAmmessi.join(', ')}.`,
        });
      }

      if (req.body?.otp) {
        const verifica = await verificaOtp(clienteId, req.body.otp, ambito, riferimentoId ?? null);
        if (!verifica.valido || !verifica.record) {
          return reply.code(400).send({ ok: false, errore: verifica.motivo });
        }
        codiceOtpId = verifica.record.id;
        descrizioneOtp = ` ${descriviCanaleVerificato(verifica.record)}.`;
      }

      const caricato = await uploadDocumento(filename, contentBase64, tenantId);
      const fileFirmatoHash = crypto.createHash('sha256').update(buffer).digest('hex');

      const documentoTitolo =
        req.body?.documentoTitolo?.trim() || titoloDalFascicolo || DESCRIZIONE_AMBITO[ambito];
      const firmatarioNome = req.body?.signerName?.trim() || cliente.nome;

      // Detto come sta: la piattaforma attesta di aver ricevuto un file da una sessione
      // autenticata, non di aver verificato la firma che il file contiene. Per la firma
      // qualificata esterna la validità la certifica il provider, e la verifica del
      // certificato non è implementata — dirlo è parte del valore del verbale.
      const canaleVerificato =
        (tipoFirma === 'manuale_scansionata'
          ? 'Documento scaricato, sottoscritto a mano e ricaricato dal cliente da sessione autenticata al portale'
          : 'Documento sottoscritto con firma digitale qualificata di provider esterno al firmatario e ricaricato da sessione autenticata; il certificato non è stato validato dalla piattaforma') +
        descrizioneOtp;

      const standard =
        tipoFirma === 'manuale_scansionata'
          ? 'Sottoscrizione autografa su supporto cartaceo, acquisita per immagine'
          : 'Firma digitale qualificata di provider esterno (eIDAS UE 910/2014 QES), non verificata dalla piattaforma';

      const sigillo = creaSigilloFea({
        clienteId,
        signerName: firmatarioNome,
        documentoTitolo,
        documentoHash: improntaFinale,
        ip: ipReale(req),
        userAgent: req.headers['user-agent'] || null,
        canaleVerificato,
        standard,
        // Prefisso onesto: FEQ per il file qualificato del provider esterno (la piattaforma
        // attesta la ricezione, non valida il certificato), SES per la scansione autografa.
        valoreLegale: tipoFirma === 'qualificata_esterna' ? 'feq' : 'ses',
      });

      const firma = await prisma.firmaElettronica.create({
        data: {
          tenantId,
          clienteId,
          signatureId: sigillo.signatureId,
          tipoFirma,
          ambito,
          riferimentoId: riferimentoId ?? null,
          documentoTitolo,
          firmatarioNome,
          firmatarioRuolo: req.body?.firmatarioRuolo?.trim() || null,
          documentoHash: sigillo.documentoHash,
          canaleVerificato: sigillo.canaleVerificato,
          codiceOtpId,
          ipAddress: sigillo.ipAddress,
          userAgent: sigillo.userAgent,
          fileFirmatoUrl: caricato.url,
          fileFirmatoHash,
          standard: sigillo.standard,
          // Vincolo 7 — il valore legale effettivo lo scrive il server: il file del
          // provider esterno è l'unico modo attuale di ottenere FEQ; la scansione
          // autografa resta SES.
          valoreLegale: tipoFirma === 'qualificata_esterna' ? 'feq' : 'ses',
          firmatoAt: new Date(sigillo.timestampIso),
        },
      });

      if (vault && riferimentoId) await segnaDocumentoFirmato(tenantId, riferimentoId);

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FIRMA_FILE_CARICATO',
        entita: cliente.nome,
        dettagli:
          `Firma ${tipoFirma} ${sigillo.signatureId} su "${documentoTitolo}" da ${firmatarioNome}. ` +
          `File ${filename} (${scan.fileSize} byte, SHA-256 ${fileFirmatoHash.slice(0, 16)}…). ` +
          `IP: ${sigillo.ipAddress ?? 'non registrato'}.`,
        ipAddress: sigillo.ipAddress,
      });

      // Blocco 3 — come per la firma OTP: evento "firma apposta" a studio e cliente.
      await notificaStudio(tenantId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma apposta',
        corpo: `${firmatarioNome} (${cliente.nome}) ha caricato il documento firmato «${documentoTitolo}».`,
        link: null,
      }).catch(() => {});
      await notificaCliente(tenantId, clienteId, {
        tipoEvento: 'firma_apposta',
        oggetto: 'Firma registrata',
        corpo: `Il documento firmato «${documentoTitolo}» è stato registrato correttamente.`,
        link: '/portal/documents',
      }).catch(() => {});

      // Punto 2 piano gap — verbale anche per manuale_scansionata e qualificata_esterna:
      // qui certifica la ricezione del file e, se l'OTP è stato usato, lo cita.
      await generaVerbaleDiFirma({
        tenantId,
        clienteId,
        clienteNome: cliente.nome,
        firma,
        sigilloDigest: sigillo.sha256Digest,
        ambito,
        riferimentoId: riferimentoId ?? null,
      });

      return reply.send({
        ok: true,
        seal: {
          ...sigillo,
          id: firma.id,
          tipoFirma,
          // Il file con la firma dentro è quello appena caricato dal cliente: oltre
          // all'URL nudo (uso interno), il seal espone `fileUrl` rinnovato perché la
          // ricevuta lo offra in download come atto sottoscritto.
          fileFirmatoUrl: caricato.url,
          fileUrl: rifirmaUrlUpload(caricato.url) as string,
        },
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore firma con file' });
    }
  });

  /**
   * Le firme registrate. Un cliente vede solo le proprie, l'operatore quelle del tenant —
   * ed è questo che permette allo studio di *vedere la firma a database*, che prima non
   * esisteva da nessuna parte.
   */
  server.get<{ Querystring: { clienteId?: string; ambito?: string } }>('/firme', async (req, reply) => {
    const tenantId = req.tenantId;
    const soloProprie = req.ruolo === 'cliente';
    const clienteId = soloProprie
      ? clienteDellaRichiesta(req)
      : req.query?.clienteId?.trim() || undefined;

    if (soloProprie && !clienteId) {
      return reply.code(400).send({ errore: 'Cliente non identificato nella sessione.' });
    }

    try {
      const firme = await prisma.firmaElettronica.findMany({
        where: {
          tenantId,
          ...(clienteId ? { clienteId } : {}),
          ...(req.query?.ambito ? { ambito: req.query.ambito } : {}),
        },
        orderBy: { firmatoAt: 'desc' },
        select: {
          id: true,
          signatureId: true,
          tipoFirma: true,
          ambito: true,
          riferimentoId: true,
          documentoTitolo: true,
          firmatarioNome: true,
          firmatarioRuolo: true,
          documentoHash: true,
          canaleVerificato: true,
          ipAddress: true,
          fileFirmatoUrl: true,
          fileFirmatoHash: true,
          standard: true,
          // Piano §3.1 — il valore legale effettivo della firma, scritto dal server.
          valoreLegale: true,
          firmatoAt: true,
          // La grafometrica è un'immagine e pesa: si scarica dal dettaglio, non in elenco.
          cliente: { select: { id: true, nome: true } },
        },
      });
      return reply.send({ ok: true, firme });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura firme' });
    }
  });

  server.get<{ Params: { id: string } }>('/firme/:id/grafometrica', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const firma = await prisma.firmaElettronica.findFirst({
        where: { id: req.params.id, tenantId },
        select: { firmaGrafometricaPng: true, clienteId: true },
      });
      if (!firma) return reply.code(404).send({ errore: 'Firma non trovata.' });

      // Un cliente non deve poter chiedere la grafometrica di un altro cliente dello stesso
      // studio: RLS isola il tenant, non i clienti fra loro.
      if (req.ruolo === 'cliente' && clienteDellaRichiesta(req) !== firma.clienteId) {
        return reply.code(403).send({ errore: 'Firma non accessibile.' });
      }
      if (!firma.firmaGrafometricaPng) {
        return reply.code(404).send({ errore: 'Nessuna firma grafometrica allegata a questo sigillo.' });
      }
      return reply.send({ ok: true, firmaGrafometricaPng: firma.firmaGrafometricaPng });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura grafometrica' });
    }
  });
}
