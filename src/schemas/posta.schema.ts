import { z } from 'zod';

const testo = (massimo: number) => z.string().transform((v) => v.trim()).pipe(z.string().min(1).max(massimo));
const facoltativo = (massimo: number) =>
  z.string().max(massimo).transform((v) => v.trim()).optional().nullable();

/** I filtri dell'elenco. Tutto facoltativo: senza niente è la coda di lavoro (non archiviati). */
export const ElencoMessaggiSchema = z.object({
  vista: z.enum(['tutti', 'da_smistare', 'attribuiti']).default('tutti'),
  letti: z.enum(['si', 'no']).optional(),
  archiviati: z.enum(['si', 'no']).default('no'),
  clienteId: z.string().uuid().optional(),
  progettoId: z.string().uuid().optional(),
  casellaId: z.string().uuid().optional(),
  q: z.string().trim().min(2).max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  perPagina: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * Le modifiche a un messaggio. Chiave assente = resta com'è; `null` = togli l'attribuzione: senza
 * questa differenza un'attribuzione sbagliata non si potrebbe annullare.
 */
export const AggiornaMessaggioSchema = z
  .object({
    clienteId: z.string().uuid().nullable().optional(),
    progettoId: z.string().uuid().nullable().optional(),
    letto: z.boolean().optional(),
    archiviato: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nessuna modifica indicata' });

const campiCasella = {
  nome: testo(80),
  indirizzo: z.string().trim().toLowerCase().email('Indirizzo della casella non valido').max(254),
  host: testo(253),
  servername: facoltativo(253),
  porta: z.coerce.number().int().min(1).max(65535).default(993),
  utente: testo(254),
  cartella: z.string().trim().min(1).max(200).default('INBOX'),
  /** Da quale giorno raccogliere alla prima lettura (`AAAA-MM-GG`). Assente: gli ultimi 30 giorni. */
  raccogliDal: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida').optional().nullable(),
};

export const CreaCasellaSchema = z
  .object({
    ...campiCasella,
    password: z.string().min(1, 'La password della casella è obbligatoria').max(1024),
    tipo: z.enum(['raccolta', 'cliente']),
    clienteId: z.string().uuid().optional().nullable(),
    /** Per le caselle dei clienti: chi collega dichiara che il cliente ha autorizzato per iscritto. */
    consensoCliente: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo !== 'cliente') return;
    if (!v.clienteId) ctx.addIssue({ code: 'custom', path: ['clienteId'], message: 'Indica di quale cliente è la casella' });
    if (v.consensoCliente !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['consensoCliente'],
        message: 'Per collegare la casella di un cliente devi dichiarare che il cliente ha autorizzato per iscritto lo studio a leggerla',
      });
    }
  });

export const AggiornaCasellaSchema = z
  .object({
    nome: campiCasella.nome.optional(),
    indirizzo: campiCasella.indirizzo.optional(),
    host: campiCasella.host.optional(),
    servername: campiCasella.servername,
    porta: z.coerce.number().int().min(1).max(65535).optional(),
    utente: campiCasella.utente.optional(),
    cartella: z.string().trim().min(1).max(200).optional(),
    /** Vuota o assente: resta quella salvata. */
    password: z.string().max(1024).optional(),
    attiva: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nessuna modifica indicata' });

export const ProvaCasellaSchema = z.object({
  /** Con l'id si prova la casella salvata; i campi nel corpo, se presenti, sostituiscono i suoi. */
  casellaId: z.string().uuid().optional(),
  host: z.string().trim().max(253).optional(),
  servername: facoltativo(253),
  porta: z.coerce.number().int().min(1).max(65535).optional(),
  utente: z.string().trim().max(254).optional(),
  password: z.string().max(1024).optional(),
  cartella: z.string().trim().max(200).optional(),
});

export const InoltroClienteSchema = z.object({ attivo: z.boolean() });
