import { z } from 'zod';

export const CreaProgettoSchema = z.object({
  clienteId: z.string().min(1, 'Cliente obbligatorio'),
  nome: z.string().min(1, 'Nome progetto obbligatorio').max(255),
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
  ore: z.number().positive('Le ore devono essere maggiori di 0'),
  nota: z.string().max(1000).optional(),
});
