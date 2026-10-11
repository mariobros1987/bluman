import { z } from 'zod';

/** Email opzionale che tollera la stringa vuota (reset del campo), come in `clienti.schema.ts`. */
const emailOpzionale = z.string().email('Formato email non valido').optional().nullable().or(z.literal(''));

/**
 * `POST /admin/tenants` (super_admin). L'handler mappa i campi uno per uno con i propri default,
 * quindi lo schema è una guardia di forma al bordo: tipi e lunghezze, niente di più. Tutto
 * opzionale perché l'handler ha i suoi ripieghi. `.passthrough()` per non rompere chiavi extra.
 */
export const CreaTenantSchema = z.object({
  id: z.string().max(100).optional().nullable(),
  ragioneSociale: z.string().max(255).optional().nullable(),
  giurisdizione: z.string().max(100).optional().nullable(),
  pIva: z.string().max(50).optional().nullable(),
  piva: z.string().max(50).optional().nullable(),
  email: emailOpzionale,
  leadAdvisorEmail: emailOpzionale,
  leadAdvisorNome: z.string().max(255).optional().nullable(),
  // Gli unici tre piani che l'app conosce (SuperAdminPage usa lo stesso insieme).
  piano: z.enum(['enterprise', 'pro', 'trial']).optional(),
  // `stato` resta stringa limitata, non enum: l'insieme degli stati può crescere e non voglio
  // rifiutare con un 400 uno stato legittimo che oggi non enumero.
  stato: z.string().max(40).optional().nullable(),
  durataMesi: z.coerce.number().int().positive().max(1200).optional(),
  dataAttivazione: z.string().max(40).optional().nullable(),
  dataScadenza: z.string().max(40).optional().nullable(),
  moduliConcessi: z.array(z.string().max(40)).optional(),
}).passthrough();

/** `PATCH /admin/tenants/:id`: stessi campi, tutti opzionali (aggiornamento parziale). */
export const AggiornaTenantSchema = CreaTenantSchema.partial();

/**
 * `POST /audit-logs`. L'identità dell'attore viene dal token, non dal corpo (l'handler la impone):
 * qui si validano solo i campi descrittivi. `azione` ed `entita` sono obbligatorie — una riga di
 * audit senza l'una o l'altra non dice niente, e prima finiva nel ramo `catch` che rimandava il
 * body. I campi identità restano accettati ma non fidati (l'handler usa il token).
 */
export const AuditLogSchema = z.object({
  azione: z.string('azione è obbligatoria').min(1, 'azione è obbligatoria').max(120),
  entita: z.string('entita è obbligatoria').min(1, 'entita è obbligatoria').max(255),
  dettagli: z.string().max(5000).optional().nullable(),
  userId: z.string().max(100).optional().nullable(),
  userEmail: z.string().max(255).optional().nullable(),
  userNome: z.string().max(255).optional().nullable(),
  ruolo: z.string().max(50).optional().nullable(),
}).passthrough();
