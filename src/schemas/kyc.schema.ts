import { z } from 'zod';

/**
 * Approvazione massiva dalla coda KYC.
 *
 * Il tetto di 100 non è una regola di dominio: è il punto oltre il quale la risposta non è più
 * «una coda», e ogni transizione scrive storico + ComplianceEvent, quindi una richiesta enorme
 * diventerebbe un'unica chiamata lunga e difficile da ritentare. Chi ha più di 100 pratiche
 * approva in due giri, e sappiamo esattamente quali sono passate.
 */
export const ApprovazioneMassivaSchema = z.object({
  ids: z
    .array(z.string().uuid('Identificativo di fascicolo non valido.'))
    .min(1, 'Seleziona almeno una pratica da approvare.')
    .max(100, 'Si approvano al massimo 100 pratiche per volta.'),
  motivazione: z
    .string('La motivazione deve essere un testo.')
    .max(500, 'La motivazione è troppo lunga (massimo 500 caratteri).')
    .optional(),
});

export type ApprovazioneMassivaInput = z.infer<typeof ApprovazioneMassivaSchema>;

/**
 * Corpi delle rotte KYC (fascicolo, soggetto, titolare effettivo, screening, anomalie,
 * conservazione). Qui si mette la **forma**: tipi e lunghezze. Le regole di contenuto restano
 * nell'handler, che risponde con messaggi già scritti per l'operatore (denominazione troppo
 * corta, motivazione di almeno 10 caratteri, esito fuori elenco): cambiarle qui cambierebbe
 * anche il testo del 400, e i test le fissano. Per questo i campi obbligatori per il dominio
 * sono dichiarati opzionali: lo schema rifiuta un `{}` malformato, non un corpo incompleto.
 *
 * Gli enum (tipo screening, decisione MLRO, esito retention) restano stringhe perché l'elenco
 * vive nel dominio e nei servizi: duplicarlo qui lo farebbe divergere.
 */
const TestoOpzionale = (max: number) => z.string().max(max).optional().nullable();

/** `PUT /kyc/:id/soggetto` — anagrafica del soggetto principale del fascicolo. */
export const SoggettoKycSchema = z.object({
  tipo: TestoOpzionale(40),
  denominazione: TestoOpzionale(500),
  codiceFiscale: TestoOpzionale(200),
  partitaIva: TestoOpzionale(200),
  luogoNascita: TestoOpzionale(500),
  dataNascita: TestoOpzionale(100),
  paeseResidenza: TestoOpzionale(200),
  indirizzo: TestoOpzionale(1000),
}).passthrough();

/** `POST /kyc/:id/titolare-effettivo` — aggiunta di un titolare effettivo alla catena. */
export const TitolareEffettivoSchema = z.object({
  denominazione: TestoOpzionale(500),
  tipo: TestoOpzionale(40),
  codiceFiscale: TestoOpzionale(200),
  paeseResidenza: TestoOpzionale(200),
  criterio: TestoOpzionale(40),
  // Il modulo manda la percentuale come testo: `Number()` la interpreta nell'handler.
  percentuale: z.union([z.number(), z.string().max(20)]).optional().nullable(),
  fonte: TestoOpzionale(60),
  note: TestoOpzionale(2000),
}).passthrough();

/** `PUT /kyc/:id/deposito-registro` — deposito del registro del titolare effettivo (§5.2). */
export const DepositoRegistroTeSchema = z.object({
  stato: TestoOpzionale(40),
  dataVariazione: TestoOpzionale(40),
  scadenza: TestoOpzionale(40),
  dataDeposito: TestoOpzionale(40),
  riferimento: TestoOpzionale(200),
  note: TestoOpzionale(2000),
}).passthrough();

/** `POST /kyc/:id/rischio` — valutazione a quattro pilastri (§6/§14). */
export const ValutazioneRischioKycSchema = z.object({
  clienteLivello: TestoOpzionale(20),
  geografiaLivello: TestoOpzionale(20),
  prodottoLivello: TestoOpzionale(20),
  canaleLivello: TestoOpzionale(20),
  clienteMotivazione: TestoOpzionale(5000),
  geografiaMotivazione: TestoOpzionale(5000),
  prodottoMotivazione: TestoOpzionale(5000),
  canaleMotivazione: TestoOpzionale(5000),
  motivazioneComplessiva: TestoOpzionale(5000),
}).passthrough();

/** `POST /kyc/soggetto/:soggettoId/documento` — documento d'identità (base64). */
export const DocumentoIdentitaKycSchema = z.object({
  // Nessun tetto stretto sul base64: il limite del corpo lo impone già Fastify.
  contentBase64: z.string().optional().nullable(),
  filename: TestoOpzionale(500),
  tipo: TestoOpzionale(40),
  numero: TestoOpzionale(100),
  emittente: TestoOpzionale(200),
  scadenza: TestoOpzionale(40),
}).passthrough();

/** `POST /kyc/:id/screening` — esito dello screening manuale PEP/sanzioni/media (§5.1.5). */
export const ScreeningKycSchema = z.object({
  tipo: TestoOpzionale(40),
  esito: TestoOpzionale(40),
  fonte: TestoOpzionale(200),
  matchDettagli: TestoOpzionale(5000),
  allegatoContentBase64: z.string().optional().nullable(),
  allegatoFilename: TestoOpzionale(500),
}).passthrough();

/** `PATCH /kyc/:id/screening/:sid/risolvi` — chiusura di un match da valutare. */
export const RisoluzioneScreeningSchema = z.object({
  esito: TestoOpzionale(40),
  notaRisoluzione: TestoOpzionale(5000),
}).passthrough();

/** `POST /kyc/:id/anomalie` — apertura di un'anomalia (§5.3). */
export const AnomaliaKycSchema = z.object({
  tipo: TestoOpzionale(40),
  descrizione: TestoOpzionale(10000),
}).passthrough();

/** `POST /kyc/anomalie/:aid/decisione` — decisione dell'MLRO su un'anomalia. */
export const DecisioneAnomaliaSchema = z.object({
  decisione: TestoOpzionale(60),
  motivazione: TestoOpzionale(5000),
}).passthrough();

/** `POST /kyc/segnalazioni/:sid/trasmissione` — registrazione dell'invio manuale in goAML. */
export const TrasmissioneFiauSchema = z.object({
  riferimentoGoaml: TestoOpzionale(200),
}).passthrough();

/** `POST /kyc/:id/retention/esito` — conclusione della conservazione (§8.9). */
export const EsitoRetentionSchema = z.object({
  esito: TestoOpzionale(40),
  motivazione: TestoOpzionale(5000),
}).passthrough();

/** `POST /kyc/:id/retention/proroga` — proroga della conservazione. */
export const ProrogaRetentionSchema = z.object({
  prorogaAl: TestoOpzionale(40),
  motivo: TestoOpzionale(5000),
}).passthrough();
