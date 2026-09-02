import { z } from 'zod';

export const InviaSollecitoSchema = z.object({
  livello: z.enum(['1_avviso_bonario', '2_sollecito_mora', '3_diffida_legale']).default('1_avviso_bonario'),
  emailDestinatario: z.string().email('Email destinatario non valida').optional().nullable(),
  oggettoPersonalizzato: z.string().max(255).optional().nullable(),
  testoPersonalizzato: z.string().max(5000).optional().nullable(),
  saggioInteresse: z.number().min(0).max(100).optional(),
});
