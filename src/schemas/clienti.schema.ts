import { z } from 'zod';

export const CreaClienteSchema = z.object({
  nome: z.string('Il nome del cliente è obbligatorio').min(1, 'Il nome del cliente è obbligatorio').max(255),
  tipo: z.enum(['individual', 'company'], {
    message: "Il tipo cliente è obbligatorio: 'individual' o 'company'",
  }),
  email: z.string().email('Formato email non valido').optional().nullable().or(z.literal('')),
  cellulare: z.string().optional().nullable(),
  /**
   * L'identificativo numerico della chat Telegram — non lo `@username`, che `sendMessage`
   * non accetta. È questo che l'anagrafica scrive nella colonna `telegramChatId`, da cui
   * lo leggono l'OTP di firma, la scheda cliente e i webhook.
   */
  telegramChatId: z.string().max(50).optional().nullable(),
  // L'elenco deve restare quello di `CANALI_OTP`: `serverHelpers.canaleOtpValido` ora delega
  // là, e uno zod più stretto rifiuterebbe con un 400 il canale che il server sa spedire.
  canaleOtpPreferito: z.enum(['whatsapp', 'email', 'telegram', 'signal']).optional().nullable(),
  password: z.string().min(6).optional().nullable(),
  piva: z.string().max(50).optional().nullable(),
  codiceFiscale: z.string().max(50).optional().nullable(),
  codFisc: z.string().max(50).optional().nullable(),
  giurisdizione: z.string().max(100).optional().nullable(),
  sedeLegale: z.string().max(255).optional().nullable(),
  sede: z.string().max(255).optional().nullable(),
  sdiCode: z.string().max(20).optional().nullable(),
  codiceSdi: z.string().max(20).optional().nullable(),
  // Regime IVA: l'aliquota di default del cliente (0..100), e la natura di esenzione (N1..N7)
  // che la accompagna quando è 0. Validati qui perché finiscono in colonna e guidano il calcolo
  // dell'IVA in fattura: un'aliquota fuori scala o non numerica non deve entrare in banca dati.
  aliquotaIvaDefault: z.number().int().min(0).max(100).optional().nullable(),
  naturaEsenzioneDefault: z.string().max(10).optional().nullable(),
  iban: z.string().max(50).optional().nullable(),
  rischioAml: z.string().max(50).optional().nullable(),
  ubo: z.string().optional().nullable(),
  fontePatrimonio: z.string().optional().nullable(),
  dataKyc: z.string().optional().nullable(),
  documentoTipo: z.string().max(40).optional().nullable(),
  documentoNumero: z.string().max(60).optional().nullable(),
  dataNascita: z.string().max(40).optional().nullable(),
  luogoNascita: z.string().max(120).optional().nullable(),
  indirizzoResidenza: z.string().max(255).optional().nullable(),
  indirizzoAlloggio: z.string().max(255).optional().nullable(),
  referentiJson: z.any().optional(),
}).passthrough();
