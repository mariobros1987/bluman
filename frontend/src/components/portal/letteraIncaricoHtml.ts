// La lettera d'incarico del portale: il modello `tmpl-engagement` riempito con cliente, incarico,
// moduli e studio. Lo studio viene da `getStudioInfoForTenant()`, cioè dalla copia locale che
// `useContattiStudioPortale` scrive con l'anagrafica del database prima che la lettera si mostri.
// Estratta da `pages/ClientPortal.tsx` senza cambiarne il comportamento.
import { PREBUILT_TEMPLATES, resolveDocumentTemplateHtml } from '../../utils/documentTemplates';
import { getStudioInfoForTenant } from '../../utils/tenant';
import { tabellaModuliLetteraHtml } from './tabellaModuliLettera';
import type { ModuloProposta, TotaleModuli } from './types';

export interface DatiLettera {
  moduliProposti: ModuloProposta[];
  totaleProposta: TotaleModuli;
  clientObj: any;
  clientName: string;
  formData: { ragioneSociale: string; piva: string; codiceFiscale: string };
  progettoAttivo: { nome?: string | null } | null | undefined;
}

export function letteraIncaricoHtml({ moduliProposti, totaleProposta, clientObj, clientName, formData, progettoAttivo }: DatiLettera): string {
  const tmpl = PREBUILT_TEMPLATES.find(t => t.id === 'tmpl-engagement');
  const baseHtml = tmpl ? tmpl.contenutoHtml : '';

  const modulesTableHtml = tabellaModuliLetteraHtml(moduliProposti, totaleProposta);

  const studio = getStudioInfoForTenant();
  return resolveDocumentTemplateHtml(baseHtml.replace('<!-- {{TABELLA_MODULI}} -->', modulesTableHtml), {
    cliente: clientObj || {
      nome: clientName,
      referenteNome: clientName,
      ragioneSociale: formData.ragioneSociale || clientName,
      piva: formData.piva || '',
      codiceFiscale: formData.codiceFiscale || '',
    },
    progetto: {
      // Il nome dell'incarico a database. Era cablato «Progetto Consulenza & Structuring
      // Patrimoniale»: compariva dentro il testo che il cliente sottoscrive, riferito a un
      // incarico che non è il suo. Senza progetto resta la dizione generica.
      titolo: progettoAttivo?.nome || 'Incarico professionale',
      // Totale parziale (moduli senza prezzo) → segnaposto: non si fa firmare un importo incompleto.
      totalePreventivo: totaleProposta.mancanti === 0 ? totaleProposta.totale : null,
    },
    studio,
  });
}
