import { z } from 'zod';

export const RigaFatturaInputSchema = z.object({
  tipo: z.enum(['modulo_completo', 'modulo_parziale', 'milestone_libera']).default('milestone_libera'),
  moduloProgettoId: z.string().uuid().optional().nullable(),
  articoloId: z.string().uuid().optional().nullable(),
  descrizione: z.string().min(1, 'Descrizione riga obbligatoria').max(500),
  quantita: z.number().positive().default(1.0),
  unitaMisura: z.string().default('ore').optional(),
  prezzoUnitarioCent: z.number().int().min(0),
  scontoPercentuale: z.number().min(0).max(100).default(0).optional(),
  aliquotaIva: z.number().int().min(0).max(100).default(22).optional(),
  naturaEsenzione: z.string().max(10).optional().nullable(),
  applicaCassa: z.boolean().default(true).optional(),
  applicaRitenuta: z.boolean().default(true).optional(),
  applicaBollo: z.boolean().default(false).optional(),
  percentuale: z.number().min(1).max(100).optional().nullable(),
  importo: z.number().int().optional(),
});

export const EmettiFatturaSchema = z.object({
  clienteId: z.string().uuid('ID cliente obbligatorio'),
  progettoId: z.string().uuid().optional().nullable(),
  preventivoId: z.string().uuid().optional().nullable(),
  contrattoRicorrenteId: z.string().uuid().optional().nullable(),
  tipoDocumento: z.enum(['fattura', 'nota_credito', 'parcella', 'acconto']).default('fattura'),
  data: z.string().or(z.date()).default(() => new Date()).transform((val) => new Date(val)),
  condizionePagamento: z.enum(['immediato', 'bonifico_30gg', 'bonifico_60gg', 'bonifico_30_60gg', 'bonifico_fine_mese', 'personalizzato']).default('bonifico_30gg'),
  metodoPagamento: z.enum(['bonifico', 'carta', 'assegno', 'contanti', 'stripe']).default('bonifico'),
  contoAccreditoId: z.string().uuid().optional().nullable(),
  tipoCassa: z.enum(['nessuna', 'inps_gestione_separata', 'cassa_commercialisti', 'cassa_forense', 'inarcassa']).default('nessuna'),
  aliquotaCassa: z.number().min(0).max(100).default(0).optional(),
  aliquotaRitenuta: z.number().min(0).max(100).default(0).optional(),
  esigibilitaIva: z.enum(['immediata', 'differita', 'split']).default('immediata').optional(),
  note: z.string().max(2000).optional().nullable(),
  notePiePagina: z.string().max(1000).optional().nullable(),
  righe: z.array(RigaFatturaInputSchema).min(1, 'Almeno una riga fattura richiesta'),
});

export const RegistraIncassoSchema = z.object({
  importoIncassatoCentesimi: z.number().int().positive("L'importo incassato deve essere positivo"),
  dataIncasso: z.string().or(z.date()).default(() => new Date()).transform((val) => new Date(val)),
  metodoPagamento: z.enum(['bonifico', 'carta', 'assegno', 'contanti', 'stripe']).default('bonifico'),
  contoBancarioId: z.string().uuid().optional().nullable(),
  riferimentoTransazione: z.string().max(100).optional().nullable(),
  noteOperatore: z.string().max(1000).optional().nullable(),
});

export const CreaMovimentoPrimaNotaSchema = z.object({
  data: z.string().or(z.date()).default(() => new Date()).transform((val) => new Date(val)),
  tipo: z.enum(['entrata', 'uscita']),
  categoria: z.enum(['incasso_fattura', 'pagamento_fornitore', 'imposta_tasse', 'stipendi_compensi', 'spese_generali', 'giroconto', 'altro']).default('altro'),
  descrizione: z.string().min(1, 'Descrizione movimento obbligatoria').max(500),
  importoCentesimi: z.number().int().positive("L'importo deve essere positivo"),
  contoBancarioId: z.string().uuid().optional().nullable(),
  fatturaId: z.string().uuid().optional().nullable(),
  fatturaRicevutaId: z.string().uuid().optional().nullable(),
  clienteId: z.string().uuid().optional().nullable(),
  fornitoreId: z.string().uuid().optional().nullable(),
  metodoPagamento: z.enum(['bonifico', 'carta', 'assegno', 'contanti', 'stripe']).default('bonifico'),
  riferimentoTransazione: z.string().max(100).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});

export const CreaContoBancarioSchema = z.object({
  nomeBanca: z.string().min(1, 'Nome banca obbligatorio').max(150),
  intestatario: z.string().min(1, 'Intestatario conto obbligatorio').max(200),
  iban: z.string().min(15, 'IBAN non valido').max(50),
  bic: z.string().max(20).optional().nullable(),
  tipoConto: z.string().default('principale').optional(),
  saldoInizialeCentesimi: z.number().int().default(0).optional(),
  note: z.string().max(1000).optional().nullable(),
});

export const CreaContrattoRicorrenteSchema = z.object({
  clienteId: z.string().uuid('ID cliente obbligatorio'),
  progettoId: z.string().uuid().optional().nullable(),
  titolo: z.string().min(1, 'Titolo contratto obbligatorio').max(200),
  descrizione: z.string().max(1000).optional().nullable(),
  frequenza: z.enum(['mensile', 'trimestrale', 'semestrale', 'annuale']).default('mensile'),
  importoCentesimi: z.number().int().positive("L'importo deve essere positivo"),
  dataInizio: z.string().or(z.date()).default(() => new Date()).transform((val) => new Date(val)),
  dataFine: z.string().or(z.date()).optional().nullable().transform((val) => (val ? new Date(val) : null)),
  prossimaFatturazione: z.string().or(z.date()).optional().nullable().transform((val) => (val ? new Date(val) : null)),
  giornoFatturazione: z.number().int().min(1).max(31).default(1).optional(),
});
