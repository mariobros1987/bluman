import { escapeHtmlTesto } from '../../../../src/util/htmlSanitizer';
import { importoEuroTesto, mancante } from '../../utils/datiDocumentoEditor';
import type { ModuloProposta, TotaleModuli } from './types';

/** Corrispettivo di un modulo nel testo della lettera: due decimali, segnaposto se manca. */
const corrispettivo = (euro: number | null) => (euro == null ? mancante('corrispettivo del modulo') : importoEuroTesto(euro));

/** Totale nella lettera: se a qualche modulo manca il prezzo, è la somma dei noti e lo dice. */
export function totaleLetteraTesto(t: TotaleModuli): string {
  const importo = importoEuroTesto(t.totale);
  if (t.mancanti === 0) return importo;
  return `${importo} (parziale: ${t.mancanti} ${t.mancanti === 1 ? 'modulo' : 'moduli'} senza corrispettivo)`;
}

/** Tabella dei moduli che la lettera d'incarico del portale inserisce al posto di `{{TABELLA_MODULI}}`. */
export function tabellaModuliLetteraHtml(moduli: ModuloProposta[], totale: TotaleModuli): string {
  return `
      <div style="margin: 16px 0; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 10pt; text-align: left;">
          <thead style="background: #f1f5f9; color: #1e1b4b; font-weight: 700; border-bottom: 1px solid #cbd5e1;">
            <tr>
              <th style="padding: 8px 12px;">Modulo Specialistico</th>
              <th style="padding: 8px 12px;">Categoria</th>
              <th style="padding: 8px 12px; text-align: center;">Ore Stimate</th>
              <th style="padding: 8px 12px; text-align: right;">Corrispettivo</th>
            </tr>
          </thead>
          <tbody>
            ${moduli.map(m => `
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 12px; font-weight: 600; color: #0f172a;">${escapeHtmlTesto(m.nome)}</td>
                <td style="padding: 8px 12px; color: #475569;">${escapeHtmlTesto(m.cat)}</td>
                <td style="padding: 8px 12px; text-align: center; color: #475569;">${escapeHtmlTesto(m.ore)}h</td>
                <td style="padding: 8px 12px; text-align: right; font-weight: 700; color: #1e1b4b;">${escapeHtmlTesto(corrispettivo(m.prezzo))}</td>
              </tr>
            `).join('')}
            <tr style="background: #f8fafc; font-weight: 800;">
              <td colspan="3" style="padding: 10px 12px; text-align: right; color: #1e1b4b;">TOTALE COMPLESSIVO MANDATO:</td>
                <td style="padding: 10px 12px; text-align: right; color: #4338ca; font-size: 11pt;">${escapeHtmlTesto(totaleLetteraTesto(totale))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
}
