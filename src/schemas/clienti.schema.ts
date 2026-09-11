import { z } from 'zod';

export const CreaClienteSchema = z.object({
  nome: z.string('Il nome del cliente è obbligatorio').min(1, 'Il nome del cliente è obbligatorio').max(255),
  tipo: z.enum(['individual', 'company'], {
    message: "Il tipo cliente è obbligatorio: 'individual' o 'company'",
  }),
  email: z.string().email('Formato email non valido').optional().nullable().or(z.literal('')),
  cellulare: z.string().optional().nullable(),
  canaleOtpPreferito: z.enum(['whatsapp', 'email', 'telegram']).optional().nullable(),
  password: z.string().min(6).optional().nullable(),
  piva: z.string().max(50).optional().nullable(),
  codiceFiscale: z.string().max(50).optional().nullable(),
  codFisc: z.string().max(50).optional().nullable(),
  giurisdizione: z.string().max(100).optional().nullable(),
  sedeLegale: z.string().max(255).optional().nullable(),
  sede: z.string().max(255).optional().nullable(),
  sdiCode: z.string().max(20).optional().nullable(),
  codiceSdi: z.string().max(20).optional().nullable(),
  iban: z.string().max(50).optional().nullable(),
  rischioAml: z.string().max(50).optional().nullable(),
  ubo: z.string().optional().nullable(),
  fontePatrimonio: z.string().optional().nullable(),
  dataKyc: z.string().optional().nullable(),
  referentiJson: z.any().optional(),
}).passthrough();
