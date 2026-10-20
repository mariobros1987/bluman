import { z } from 'zod';

export const CreaProgettoSchema = z.object({
  clienteId: z.string('clienteId e nome sono obbligatori').min(1, 'clienteId e nome sono obbligatori'),
  nome: z.string('clienteId e nome sono obbligatori').min(1, 'clienteId e nome sono obbligatori').max(255),
  giurisdizioneId: z.string().optional().nullable(),
  giurisdizionePrimariaId: z.string().optional().nullable(),
  dataInizio: z.string().or(z.date()).optional().nullable(),
  dataScadenza: z.string().or(z.date()).optional().nullable(),
  valoreTotale: z.number().int().nonnegative().optional(),
  moduli: z.array(z.object({
    moduloTemplateId: z.string(),
    prezzo: z.number().int().nonnegative().optional(),
  })).optional(),
}).passthrough();

export const ConsuntivaOreSchema = z.object({
  ore: z.number().positive('Le ore devono essere maggiori di 0').optional(),
  oreAggiunte: z.number().positive('Le ore devono essere maggiori di 0').optional(),
  nota: z.string().max(1000).optional(),
}).refine(data => data.ore !== undefined || data.oreAggiunte !== undefined, {
  message: 'Il campo ore (o oreAggiunte) è obbligatorio',
});

/**
 * `POST /progetti/:id/comunicazioni`. L'handler valida già presenza di `canale`/`testo` e i ruoli
 * per `microvoceProgettoId`: lo schema aggiunge i tetti di lunghezza che mancavano (il `testo` era
 * illimitato). `.passthrough()` per i campi che l'handler legge a parte.
 */
export const NuovaComunicazioneSchema = z.object({
  canale: z.string().max(50).optional().nullable(),
  testo: z.string().max(20000).optional().nullable(),
  microvoceProgettoId: z.string().max(100).optional().nullable(),
  // Identità del messaggio: l'handler le impone per il portale, ma per lo studio le legge dal
  // corpo. Star qui le tiene tipate (prima erano `Record<string, any>` e un numero al posto del
  // nome passava fino alla colonna).
  mittente: z.string().max(200).optional().nullable(),
  destinatario: z.string().max(200).optional().nullable(),
  direzione: z.string().max(20).optional().nullable(),
  // Gli allegati arrivano già serializzati dai client nuovi e come oggetto dai vecchi: entrambe le
  // forme sono ammesse e la normalizzazione resta nell'handler.
  allegatiJson: z
    .union([z.string().max(100_000), z.record(z.string(), z.unknown()), z.array(z.unknown())])
    .optional()
    .nullable(),
}).passthrough();

