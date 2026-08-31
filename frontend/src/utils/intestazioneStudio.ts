/**
 * §39 — L'intestazione e il piè di pagina dello studio, in un posto solo.
 *
 * Prima esistevano in tre copie che si somigliavano: il JSX del canvas di Document Studio, l'HTML
 * costruito in `handleExportPdf` e quello costruito in `handleExportWord`. Tre copie della stessa
 * cosa significano che si vede una cosa e si stampa un'altra, ed è quello che accadeva.
 *
 * Ora sono funzioni che producono HTML: lo stesso HTML che si vede nel foglio dell'editor è quello
 * che finisce nel PDF, nel .doc e nel documento salvato. E siccome è HTML, l'operatore può
 * modificarlo (§39: doppio clic per sbloccare) e quello che modifica viene salvato — mentre da un
 * JSX non si poteva sbloccare niente.
 */

export interface DatiIntestazioneStudio {
  ragioneSociale: string;
  sedeLegale: string;
  piva: string;
  telefono: string;
  /** URL del logo già normalizzato, o stringa vuota: senza logo si stampa il nome dello studio. */
  logo: string;
}

/** Il livello legale che l'atto esige, in parole: la stessa etichetta nell'editor e nel PDF. */
export function etichettaLivelloFirma(livello: 'ses' | 'fea' | 'feq'): string {
  if (livello === 'fea') return 'Firma Elettronica Avanzata Richiesta • eIDAS art. 26';
  if (livello === 'feq') return 'Firma Elettronica Qualificata Richiesta • eIDAS art. 25';
  return 'Firma Elettronica Semplice • art. 20 CAD';
}

/** La fascia in testa al foglio: logo (o nome) a sinistra, recapiti dello studio a destra. */
export function intestazioneStudioHtml(dati: DatiIntestazioneStudio): string {
  const marchio = dati.logo
    ? `<img src="${dati.logo}" alt="Logo studio" style="max-height: 45px; max-width: 180px; object-fit: contain;" />`
    : `<div style="font-size: 16px; font-weight: 800; color: #1e1b4b;">🏛 ${(dati.ragioneSociale || 'STUDIO PROFESSIONALE').toUpperCase()}</div>`;

  const righe = [
    `<strong style="color: #1e1b4b;">${dati.ragioneSociale || 'Studio Professionale'}</strong>`,
    dati.sedeLegale || '',
    [dati.piva ? `P.IVA: ${dati.piva}` : '', dati.telefono ? `Tel: ${dati.telefono}` : ''].filter(Boolean).join(' | '),
  ].filter(Boolean).join('<br/>');

  return `<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #4338ca; padding-bottom: 14px; margin-bottom: 24px;">
  ${marchio}
  <div style="text-align: right; font-size: 10px; color: #64748b; line-height: 1.45;">${righe}</div>
</div>`;
}

export interface DatiPiedeStudio {
  ragioneSociale: string;
  /** Il progetto a cui l'atto appartiene, come lo legge il cliente. */
  pratica: string;
  livelloFirma: 'ses' | 'fea' | 'feq';
}

/**
 * La fascia in fondo al foglio.
 *
 * Dichiara il livello legale che l'atto ESIGE, non quello con cui è stato firmato: il secondo lo
 * scrive solo il server nel sigillo, al momento della firma (regola 7).
 */
export function piedeStudioHtml(dati: DatiPiedeStudio): string {
  return `<div style="border-top: 1px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 8.5px; color: #94a3b8;">
  <span>${dati.ragioneSociale || 'Studio Professionale'} • Pratica: ${dati.pratica || 'Incarico Professionale'}</span>
  <span>${etichettaLivelloFirma(dati.livelloFirma)}</span>
</div>`;
}
