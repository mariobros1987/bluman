// §36 — La copia firmata: il documento ricomposto con la firma DENTRO l'area prevista.
//
// Fino a qui la firma del cliente non entrava nel documento. Il sigillo stava nella riga
// `FirmaElettronica`, la grafometrica nel verbale allegato, e il contratto che il cliente
// riapriva mostrava l'area firme vuota — il filetto tratteggiato del template e nient'altro.
//
// Non si annota il PDF originale, per due ragioni indipendenti: fra le dipendenze non c'è
// una libreria che sappia scrivere dentro un PDF esistente (`pdf-lib` non è installato), e
// soprattutto quel file è quello su cui è fissato `documentoHash` del sigillo — riscriverlo
// invaliderebbe la prova che stiamo cercando di rendere visibile.
//
// La copia firmata è quindi un documento NUOVO, reso dagli stessi blocchi salvati alla
// generazione (`documento.contenuto_blocchi_json`, §36) con la grafometrica disegnata nello
// slot `{{firma_cliente}}`. Vive come riga `Documento` con `tipo='firmato'` e
// `documentoPadreId` → originale: il fascicolo mostra entrambi, l'originale certificato resta
// byte-identico e la catena padre/figlio dice quale copia discende da quale atto.
//
// PDF soltanto. La copia di cortesia in Word non si rigenera firmata: incorporare un'immagine
// in un .docx richiederebbe il modulo immagini di docxtemplater, che non è una dipendenza del
// progetto. Il `fileDocxUrl` dell'originale resta quello pre-firma, ed è corretto che sia
// così: il documento che fa fede è il PDF.
//
// Politica di fallimento, la stessa del verbale (`generaVerbaleDiFirma`): questa è
// documentazione della firma, non un suo elemento costitutivo. Se qualcosa qui va storto —
// storage, database, blocchi illeggibili — la funzione ritorna `null`, il fallimento va nei
// log, e sigillo e firma restano pienamente validi.

import { prisma } from '../util/prismaClient.js';
import { nomeFileDaUrl } from '../util/serverHelpers.js';
import { uploadDocumento } from './storageService.js';
import { generaPdfDocumento, type BloccoDocumento } from './generazioneDocumenti.js';
import type { SlotFirma } from './slotFirma.js';

const TIPI_BLOCCO = new Set(['titolo', 'intestazione', 'paragrafo', 'evidenza', 'firma']);

/**
 * Rilegge i blocchi dalla colonna JSON. La colonna è `Json?`: quello che torna dal database è
 * `unknown` e va validato prima di passarlo al renderer, altrimenti un valore scritto da una
 * versione futura (o da una mano umana) farebbe cadere pdfkit dentro il rendering.
 *
 * Validazione minima e tollerante: deve essere un array di oggetti con `tipo` fra i cinque
 * noti. I campi in più non danno fastidio, quelli mancanti li gestisce già il renderer.
 */
export function blocchiSalvati(valore: unknown): BloccoDocumento[] | null {
  if (!Array.isArray(valore) || valore.length === 0) return null;
  const buoni = valore.filter(
    (b): b is BloccoDocumento =>
      !!b && typeof b === 'object' && !Array.isArray(b) && TIPI_BLOCCO.has((b as any).tipo),
  );
  return buoni.length === valore.length ? buoni : null;
}

/** Vero se fra i blocchi c'è un'area firma che aspetta proprio quel firmatario. */
export function haSlotFirma(blocchi: BloccoDocumento[], slot: SlotFirma): boolean {
  return blocchi.some((b) => {
    if (b.tipo !== 'firma') return false;
    if (Array.isArray(b.slotColonne)) return b.slotColonne.includes(slot);
    if (b.slotColonne && typeof b.slotColonne === 'object') return slot in b.slotColonne;
    return false;
  });
}

/**
 * Le righe stampate sotto la firma grafica, in piccolo. Le compone qui chi ha in mano il
 * sigillo, non il renderer: così nessun dato che il database non ha può nascere nel motore di
 * resa (regola 7) e i test sul PDF restano deterministici.
 *
 * La data si stampa in ISO UTC, non nel formato italiano: è un'attestazione, e
 * `toLocaleString('it-IT')` dipende dal fuso e dall'ICU della macchina che genera il file.
 */
export function righeAttestazione(params: {
  firmatarioNome: string;
  valoreLegale?: string | null;
  signatureId: string;
  firmatoAt: Date;
  sigilloDigest: string;
}): string[] {
  const { firmatarioNome, valoreLegale, signatureId, firmatoAt, sigilloDigest } = params;
  const etichettaValore =
    valoreLegale === 'feq'
      ? 'Firma Elettronica Qualificata'
      : valoreLegale === 'fea'
        ? 'Firma Elettronica Avanzata'
        : 'Firma Elettronica Semplice';
  const quando = firmatoAt.toISOString().replace('T', ' ').slice(0, 19);
  return [
    `Firmato elettronicamente da ${firmatarioNome}`,
    `${etichettaValore} · ${quando} UTC`,
    `ID firma ${signatureId}`,
    `Sigillo SHA-256 ${sigilloDigest}`,
  ];
}

/** Il nome del file della copia, ricavato da quello dell'originale. */
function nomeCopia(nomeOriginale: string | null, signatureId: string): string {
  const base = (nomeOriginale ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return base ? `${base}-firmato.pdf` : `documento-firmato-${signatureId}.pdf`;
}

export interface EsitoCopiaFirmata {
  documentoId: string;
  url: string;
  nome: string;
}

/**
 * Genera e archivia la copia firmata di un documento del Vault.
 *
 * Ritorna `null` — senza sollevare — in tutti i casi in cui la copia non si può o non si deve
 * produrre:
 * - il documento non esiste nel tenant (o è già una copia firmata: non si firma una firma);
 * - non ha i blocchi salvati, perché è stato generato prima di §36 o caricato a mano come
 *   allegato: non esiste nulla da ricomporre e l'originale resta l'unico file;
 * - il suo template non prevede `{{firma_cliente}}`: senza slot la copia sarebbe identica
 *   all'originale con quattro righe in fondo, cioè un doppione inutile nel fascicolo;
 * - qualcosa fallisce (storage, PDF, database).
 *
 * Chi chiama registra l'audit: qui non si scrive nel registro perché il servizio non conosce
 * l'IP della richiesta né il contesto della rotta.
 */
export async function generaCopiaFirmata(params: {
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
  slot?: 'cliente' | 'studio';
  userId?: string | null;
}): Promise<EsitoCopiaFirmata | null> {
  const { tenantId, documentoId, firma, sigilloDigest, slot = 'cliente', userId } = params;
  try {
    const originale = await prisma.documento.findFirst({
      where: { id: documentoId, tenantId },
      select: {
        id: true,
        tipo: true,
        fileUrl: true,
        progettoId: true,
        microvoceProgettoId: true,
        categoriaDoc: true,
        livelloFirmaRichiesto: true,
        contenutoBlocchiJson: true,
      },
    });
    if (!originale || originale.tipo === 'firmato') return null;

    const blocchi = blocchiSalvati(originale.contenutoBlocchiJson);
    if (!blocchi) return null;

    const hasClienteSlot = haSlotFirma(blocchi, 'cliente');
    const hasStudioSlot = haSlotFirma(blocchi, 'studio');
    if (!hasClienteSlot && !hasStudioSlot) return null;

    // Recupera eventuali altre firme già apposte sul documento (es. controfirma)
    let firmeDb: any[] = [];
    try {
      if (prisma.firmaElettronica?.findMany) {
        firmeDb = await prisma.firmaElettronica.findMany({
          where: { tenantId, ambito: 'documento_vault', riferimentoId: documentoId },
          orderBy: { firmatoAt: 'desc' },
        });
      }
    } catch {}

    const firmeDaApporre: { cliente?: any; studio?: any } = {};

    // Slot Studio
    if (hasStudioSlot) {
      if (slot === 'studio') {
        firmeDaApporre.studio = {
          immaginePng: firma.firmaGrafometricaPng ?? null,
          righe: righeAttestazione({
            firmatarioNome: firma.firmatarioNome,
            valoreLegale: firma.valoreLegale ?? null,
            signatureId: firma.signatureId,
            firmatoAt: firma.firmatoAt,
            sigilloDigest,
          }),
        };
      } else {
        const firmaStudioDb = firmeDb.find((f) => f.tipoFirma === 'studio' || f.canaleVerificato?.includes('Studio'));
        if (firmaStudioDb) {
          firmeDaApporre.studio = {
            immaginePng: firmaStudioDb.firmaGrafometricaPng ?? null,
            righe: righeAttestazione({
              firmatarioNome: firmaStudioDb.firmatarioNome,
              valoreLegale: firmaStudioDb.valoreLegale ?? null,
              signatureId: firmaStudioDb.signatureId,
              firmatoAt: firmaStudioDb.firmatoAt,
              sigilloDigest: firmaStudioDb.sigilloDigest || sigilloDigest,
            }),
          };
        }
      }
    }

    // Slot Cliente
    if (hasClienteSlot) {
      if (slot === 'cliente') {
        firmeDaApporre.cliente = {
          immaginePng: firma.firmaGrafometricaPng ?? null,
          righe: righeAttestazione({
            firmatarioNome: firma.firmatarioNome,
            valoreLegale: firma.valoreLegale ?? null,
            signatureId: firma.signatureId,
            firmatoAt: firma.firmatoAt,
            sigilloDigest,
          }),
        };
      } else {
        const firmaClienteDb = firmeDb.find((f) => f.tipoFirma !== 'studio' && !f.canaleVerificato?.includes('Studio'));
        if (firmaClienteDb) {
          firmeDaApporre.cliente = {
            immaginePng: firmaClienteDb.firmaGrafometricaPng ?? null,
            righe: righeAttestazione({
              firmatarioNome: firmaClienteDb.firmatarioNome,
              valoreLegale: firmaClienteDb.valoreLegale ?? null,
              signatureId: firmaClienteDb.signatureId,
              firmatoAt: firmaClienteDb.firmatoAt,
              sigilloDigest: firmaClienteDb.sigilloDigest || sigilloDigest,
            }),
          };
        }
      }
    }

    // Se per lo slot richiesto non abbiamo dati da apporre, esci
    if (slot === 'cliente' && !firmeDaApporre.cliente) return null;
    if (slot === 'studio' && !firmeDaApporre.studio) return null;

    const pdf = await generaPdfDocumento(blocchi, firmeDaApporre);

    const nome = nomeCopia(nomeFileDaUrl(originale.fileUrl), firma.signatureId);
    const caricato = await uploadDocumento(nome, pdf.toString('base64'));

    // Verifica se esiste già una copia firmata da aggiornare
    let copiaEsistente: any = null;
    try {
      if (prisma.documento?.findFirst) {
        const trovata = await prisma.documento.findFirst({
          where: { tenantId, documentoPadreId: originale.id, tipo: 'firmato' },
        });
        if (trovata && trovata.id !== originale.id && trovata.tipo === 'firmato') {
          copiaEsistente = trovata;
        }
      }
    } catch {}

    let copia: any;
    if (copiaEsistente && prisma.documento?.update) {
      copia = await prisma.documento.update({
        where: { id: copiaEsistente.id },
        data: {
          fileUrl: caricato.url,
          filePdfUrl: caricato.url,
          scansionatoAt: new Date(),
        },
      });
    } else {
      copia = await prisma.documento.create({
        data: {
          tenantId,
          progettoId: originale.progettoId,
          microvoceProgettoId: originale.microvoceProgettoId,
          tipo: 'firmato',
          fileUrl: caricato.url,
          filePdfUrl: caricato.url,
          formatoOrigine: 'pdf',
          documentoPadreId: originale.id,
          caricatoDa: slot === 'studio' ? (userId ?? null) : null,
          categoriaDoc: originale.categoriaDoc ?? 'generico',
          livelloFirmaRichiesto: originale.livelloFirmaRichiesto,
          statoDoc: 'firmato',
          pubblicatoAt: new Date(),
          statoScansione: 'pulito',
          scansionatoAt: new Date(),
        },
      });
    }

    return { documentoId: copia.id, url: caricato.url, nome };
  } catch (err) {
    console.error('Copia firmata non generata: la firma resta valida', firma.signatureId, err);
    return null;
  }
}
