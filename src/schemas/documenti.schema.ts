import { z } from 'zod';

export const GeneraDocumentoSchema = z.object({
  progettoId: z.string('progettoId è obbligatorio.').min(1, 'progettoId è obbligatorio.'),
  microvoceProgettoId: z.string().optional().nullable(),
  modelloId: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  contenutoHtml: z.string().optional().nullable(),
  titolo: z.string().max(255).optional().nullable(),
  categoriaDoc: z.string().max(100).optional().nullable(),
  statoDoc: z.enum(['bozza', 'pubblicato']).optional().nullable(),
  dataScadenzaDoc: z.string().optional().nullable(),
  livelloFirmaRichiesto: z.string().optional().nullable(),
  // Il minimo di un modello standard della pagina (titolare, 28/11/2026): il server non lo ha a database.
  livelloFirmaMinimo: z.enum(['ses', 'fea', 'feq'], { message: 'livelloFirmaMinimo non valido: i valori ammessi sono ses, fea, feq.' }).optional().nullable(),
}).refine(data => Boolean(data.modelloId || data.templateId || data.contenutoHtml !== undefined), {
  message: 'Indicare il modello (modelloId) o il contenuto HTML del template.',
}).passthrough();

export const CambiaStatoRevisioneModelloSchema = z.object({
  statoRevisione: z.enum(['bozza', 'in_revisione', 'approvato']),
  noteRevisione: z.string().max(2000).optional().nullable(),
});
