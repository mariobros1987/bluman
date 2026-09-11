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
