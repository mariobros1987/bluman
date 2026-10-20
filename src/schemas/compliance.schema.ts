import { z } from 'zod';

/**
 * Impostazioni di compliance dello studio (`PUT /tenant/compliance-settings`).
 *
 * L'handler ha già i suoi ripieghi (un pacchetto sconosciuto diventa `MT`, un profilo sconosciuto
 * diventa `null`, i numeri fuori scala si chiudono nell'intervallo). Qui si mette la guardia di
 * forma al bordo: tipi e presenza. Le conversioni numeriche restano tolleranti (`number` o
 * `string`), perché il modulo Impostazioni le manda come testo e un `"5"` è legittimo.
 */
export const ImpostazioniComplianceSchema = z.object({
  jurisdictionPack: z.string().max(10).optional().nullable(),
  regulatoryProfile: z.string().max(60).optional().nullable(),
  otherSubjectCategory: z.string().max(2000).optional().nullable(),
  retentionYears: z.union([z.number(), z.string().max(10)]).optional().nullable(),
  mlroUserId: z.string().max(100).optional().nullable(),
  // Canali e provider si troncano già nell'handler: qui niente tetto stretto, o un valore lungo
  // diventerebbe un 400 dove prima veniva solo accorciato.
  reportingChannel: z.string().max(5000).optional().nullable(),
  screeningProvider: z.string().max(5000).optional().nullable(),
  featureFlags: z.record(z.string(), z.unknown()).optional().nullable(),
  sogliaTitolareEffettivo: z.union([z.number(), z.string().max(10)]).optional().nullable(),
  // `Boolean(...)` accetta qualunque cosa, e l'handler lo fa: uno schema più stretto rifiuterebbe
  // con un 400 un interruttore che prima veniva solo interpretato.
  allarmeVariazioniTe: z.unknown().optional(),
  gestioneRegistroTe: z.unknown().optional(),
}).passthrough();

/**
 * Valutazione del rischio dell'attività (`POST /tenant/business-risk`).
 *
 * I livelli sono stringhe: quelli sconosciuti ricadono su «basso» nell'handler, non è uno schema
 * enum perché l'elenco vive nel dominio (`LIVELLI_RISCHIO`) e qui non va duplicato.
 */
export const ValutazioneRischioStudioSchema = z.object({
  clientelaLivello: z.string().max(20).optional().nullable(),
  serviziLivello: z.string().max(20).optional().nullable(),
  geografiaLivello: z.string().max(20).optional().nullable(),
  canaliLivello: z.string().max(20).optional().nullable(),
  clientelaMotivazione: z.string().max(5000).optional().nullable(),
  serviziMotivazione: z.string().max(5000).optional().nullable(),
  geografiaMotivazione: z.string().max(5000).optional().nullable(),
  canaliMotivazione: z.string().max(5000).optional().nullable(),
  motivazioneComplessiva: z.string().max(5000).optional().nullable(),
}).passthrough();

/**
 * Registro della formazione (`POST /tenant/formazione`).
 *
 * Il titolo è obbligatorio: prima un corpo senza titolo arrivava all'handler, che rispondeva 400
 * con lo stesso messaggio. Lo schema lo dice prima, e il controllo sul minimo di due caratteri
 * resta nell'handler perché riguarda il contenuto, non la forma.
 */
export const RegistraFormazioneSchema = z.object({
  titolo: z.string('Titolo obbligatorio.').max(2000),
  data: z.string().max(40).optional().nullable(),
  tipo: z.string().max(40).optional().nullable(),
  partecipanti: z.string().max(5000).optional().nullable(),
  oreFormazione: z.union([z.number(), z.string().max(20)]).optional().nullable(),
  ente: z.string().max(500).optional().nullable(),
  note: z.string().max(5000).optional().nullable(),
}).passthrough();

/**
 * Questionario FIAU (`POST /tenant/questionario-fiau`).
 *
 * `anno` è l'unica chiave di riga (upsert su `tenantId_anno`): coercizione esplicita, così `"2025"`
 * e `2025` sono lo stesso anno. L'intervallo ammesso resta nell'handler.
 */
export const QuestionarioFiauSchema = z.object({
  anno: z.coerce.number('Anno non valido.').int('Anno non valido.'),
  stato: z.string().max(20).optional().nullable(),
  riferimento: z.string().max(200).optional().nullable(),
  contenuto: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .optional()
    .nullable(),
  note: z.string().max(10000).optional().nullable(),
}).passthrough();
