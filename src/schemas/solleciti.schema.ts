import { z } from 'zod';

export const InviaSollecitoSchema = z.object({
  livello: z.enum(['1_avviso_bonario', '2_sollecito_mora', '3_diffida_legale']).default('1_avviso_bonario'),
  canale: z.enum(['email', 'whatsapp', 'entrambi']).default('email').optional(),
  emailDestinatario: z.string().optional().nullable().transform((v) => (v && v.trim() ? v.trim() : null)),
  telefonoDestinatario: z.string().optional().nullable().transform((v) => (v && v.trim() ? v.trim() : null)),
  oggettoPersonalizzato: z.string().max(255).optional().nullable(),
  testoPersonalizzato: z.string().max(5000).optional().nullable(),
  saggioInteresse: z.number().min(0).max(100).optional(),
});
