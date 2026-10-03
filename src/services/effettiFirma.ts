// Gli effetti collaterali di una firma apposta: lo stato del documento padre e il verbale.
//
// Estratti da `src/routes/firma.ts` (split dei monoliti, 03/10/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate, perché servono a
// **entrambi** i percorsi di firma — quello del cliente (`routes/firma.ts`) e quello dello
// studio (`routes/documentiFirmaStudio.ts`). Finché vivevano come chiusure dentro
// `registraRotteFirma` l'unico modo di riusarle era copiarle, cioè farle divergere.
//
// Entrambe sono effetti collaterali, non requisiti di validità: la firma e il suo sigillo
// restano validi anche se queste falliscono, e il fallimento va nei log invece che
// all'utente (un atto già sigillato non si annulla perché il PDF del verbale non è uscito).

import { prisma } from '../util/prismaClient.js';
import { uploadDocumento } from './storageService.js';
import { generaPdfVerbaleFirma } from './verbaleFirma.js';
import { blocchiSalvati, haSlotFirma } from './copiaFirmata.js';
import { notificaCliente } from './notificheService.js';
import { recordAudit } from '../util/serverHelpers.js';

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
export async function segnaDocumentoFirmato(tenantId: string, documentoId: string) {
  try {
    // Firme multi-parte: «firmato» solo quando TUTTE le parti previste dagli slot del template
    // ({{firma_cliente}} / {{firma_studio}}) hanno firmato; con una sola firma su due →
    // «parzialmente_firmato». Se il template non dichiara slot (documenti pre-§36 o allegati), non
    // c'è nozione di parti multiple e una firma = firmato, come prima.
    const doc = await prisma.documento.findFirst({ where: { id: documentoId, tenantId }, select: { contenutoBlocchiJson: true } });
    const blocchi = doc ? blocchiSalvati(doc.contenutoBlocchiJson) : null;
    const richiedeCliente = blocchi ? haSlotFirma(blocchi, 'cliente') : false;
    const richiedeStudio = blocchi ? haSlotFirma(blocchi, 'studio') : false;
    const firme = await prisma.firmaElettronica.findMany({
      where: { tenantId, ambito: 'documento_vault', riferimentoId: documentoId },
      select: { tipoFirma: true },
    });
    const firmatoStudio = firme.some((f) => f.tipoFirma === 'studio');
    const firmatoCliente = firme.some((f) => f.tipoFirma !== 'studio');
    const completo = (!richiedeCliente && !richiedeStudio)
      ? true
      : (!richiedeCliente || firmatoCliente) && (!richiedeStudio || firmatoStudio);
    await prisma.documento.updateMany({
      where: { id: documentoId, tenantId },
      data: { statoDoc: completo ? 'firmato' : 'parzialmente_firmato' },
    });
  } catch (err) {
    // La firma è già registrata e resta valida: l'aggiornamento dello stato non deve farla
    // fallire a posteriori. Va però nei log, perché lascia il fascicolo incoerente.
    console.error('Stato documento non aggiornato dopo la firma', documentoId, err);
  }
}

/** La firma come la vede il verbale: i campi probatori del record `FirmaElettronica`. */
export type FirmaPerVerbale = {
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
export async function generaVerbaleDiFirma(params: {
  tenantId: string;
  clienteId: string;
  clienteNome: string;
  firma: FirmaPerVerbale;
  /** Impronta SHA-256 del sigillo: è calcolata dal builder del sigillo, non dalla firma. */
  sigilloDigest: string;
  ambito: string;
  riferimentoId: string | null;
}): Promise<void> {
  const { tenantId, clienteId, clienteNome, firma, sigilloDigest, ambito, riferimentoId } = params;
  try {
    // 1. Collocazione nel fascicolo: il verbale segue il documento che certifica. Per il
    //    Vault copia progetto/microvoce dall'originale; per un modulo risale al progetto;
    //    per la lettera d'incarico il riferimento È il progetto incaricato; altrimenti
    //    (addendum, o riferimento mancante) va nell'ultimo progetto del cliente. Il null è
    //    l'extrema ratio: il verbale esiste comunque.
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
    } else if (ambito === 'engagement_letter' && riferimentoId) {
      // Il riferimento della lettera È il progetto incaricato: il verbale va lì, senza
      // passare dal ripiego qui sotto. Quel ripiego («l'ultimo progetto del cliente») è
      // ciò che il 02/10/2026 faceva risultare firmato «prova server», ed è il motivo per
      // cui ora la lettera non si firma più senza sapere su quale incarico.
      const incaricato = await prisma.progetto.findFirst({
        where: { id: riferimentoId, tenantId },
        select: { id: true },
      });
      progettoId = incaricato?.id ?? null;
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
