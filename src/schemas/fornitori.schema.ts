import { z } from 'zod';

export const CreaFornitoreSchema = z.object({
  ragioneSociale: z.string().min(1, 'La ragione sociale del fornitore è obbligatoria').max(255),
  partitaIva: z.string().max(50).optional().nullable(),
  codiceFiscale: z.string().max(50).optional().nullable(),
  email: z.string().email('Formato email non valido').optional().nullable(),
  pec: z.string().email('Formato PEC non valido').optional().nullable(),
  sdiCode: z.string().max(20).optional().nullable(),
  indirizzo: z.string().max(255).optional().nullable(),
  citta: z.string().max(100).optional().nullable(),
  cap: z.string().max(10).optional().nullable(),
  nazione: z.string().max(10).default('IT').optional(),
  iban: z.string().max(50).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
}).passthrough();

export const AggiornaFornitoreSchema = CreaFornitoreSchema.partial();

export const RegistraFatturaRicevutaSchema = z.object({
  fornitoreId: z.string().uuid('ID fornitore non valido'),
  numero: z.string().min(1, 'Numero fattura passiva obbligatorio').max(100),
  data: z.string().or(z.date()).transform((val) => new Date(val)),
  imponibileCentesimi: z.number().int().min(0, "L'imponibile deve essere positivo"),
  ivaCentesimi: z.number().int().min(0, "L'IVA deve essere positiva"),
  totaleCentesimi: z.number().int().min(0, 'Il totale deve essere positivo'),
  esigibilitaIva: z.enum(['immediata', 'differita', 'split']).default('immediata').optional(),
  pagata: z.boolean().default(false).optional(),
  dataPagamento: z.string().or(z.date()).optional().nullable().transform((val) => (val ? new Date(val) : null)),
  xmlSdiRaw: z.string().optional().nullable(),
  // Dati opzionali per registrazione automatica in Prima Nota all'inserimento
  registraMovimentoPrimaNota: z.boolean().default(false).optional(),
  contoBancarioId: z.string().uuid().optional().nullable(),
  metodoPagamento: z.enum(['bonifico', 'carta', 'assegno', 'contanti', 'stripe']).default('bonifico').optional(),
  riferimentoTransazione: z.string().optional().nullable(),
}).passthrough();

export const PagaFatturaRicevutaSchema = z.object({
  contoBancarioId: z.string().uuid().optional().nullable(),
  dataPagamento: z.string().or(z.date()).default(() => new Date()).transform((val) => new Date(val)),
  metodoPagamento: z.enum(['bonifico', 'carta', 'assegno', 'contanti', 'stripe']).default('bonifico'),
  riferimentoTransazione: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});
