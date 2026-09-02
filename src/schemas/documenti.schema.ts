import { z } from 'zod';

export const GeneraDocumentoSchema = z.object({
  progettoId: z.string().uuid().optional().nullable(),
  moduloProgettoId: z.string().uuid().optional().nullable(),
  microvoceProgettoId: z.string().uuid().optional().nullable(),
  titolo: z.string().min(1, 'Titolo documento obbligatorio').max(255),
  categoria: z.string().max(100).default('generale').optional(),
  contenutoHtml: z.string().min(1, 'Contenuto HTML obbligatorio'),
  livelloFirmaRichiesto: z.enum(['ses', 'fea', 'feq']).default('ses').optional(),
  templateId: z.string().optional().nullable(),
});

export const CambiaStatoRevisioneModelloSchema = z.object({
  statoRevisione: z.enum(['bozza', 'in_revisione', 'approvato']),
  noteRevisione: z.string().max(2000).optional().nullable(),
});
