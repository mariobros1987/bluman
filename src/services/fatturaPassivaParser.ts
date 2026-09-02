/**
 * Parser leggero per XML FatturaPA 1.2 (Fatture Ricevute / Ciclo Passivo)
 * Estrae CedentePrestatore (Fornitore), DatiGeneraliDocumento (Numero, Data) e DatiBeniServizi (Totali, IVA).
 */

export interface DatiFatturaPassivaEstratti {
  fornitore: {
    ragioneSociale: string;
    partitaIva?: string;
    codiceFiscale?: string;
    indirizzo?: string;
    cap?: string;
    citta?: string;
    nazione?: string;
    sdiCode?: string;
    pec?: string;
  };
  documento: {
    numero: string;
    data: string;
    imponibileCentesimi: number;
    ivaCentesimi: number;
    totaleCentesimi: number;
    esigibilitaIva?: 'immediata' | 'differita' | 'split';
  };
}

function estraiTag(xml: string | undefined, tag: string): string | undefined {
  if (!xml) return undefined;
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match && match[1] ? match[1].trim() : undefined;
}

export function parseXmlFatturaPassiva(xmlContent: string): DatiFatturaPassivaEstratti {
  // 1. Cedente / Prestatore (Fornitore)
  const bloccoCedente = estraiTag(xmlContent, 'CedentePrestatore') || '';
  const denominazione: string =
    estraiTag(bloccoCedente, 'Denominazione') ||
    [estraiTag(bloccoCedente, 'Nome'), estraiTag(bloccoCedente, 'Cognome')].filter(Boolean).join(' ') ||
    'Fornitore Sconosciuto';
  
  const idCodice = estraiTag(bloccoCedente, 'IdCodice');
  const codFisc = estraiTag(bloccoCedente, 'CodiceFiscale');
  const indirizzo = estraiTag(bloccoCedente, 'Indirizzo');
  const cap = estraiTag(bloccoCedente, 'CAP');
  const comune = estraiTag(bloccoCedente, 'Comune');
  const nazione: string = estraiTag(bloccoCedente, 'Nazione') || 'IT';
  const pec = estraiTag(bloccoCedente, 'PECDestinatario');

  // 2. Dati Generali Documento
  const bloccoGenerali = estraiTag(xmlContent, 'DatiGeneraliDocumento') || '';
  const numeroVal = estraiTag(bloccoGenerali, 'Numero');
  const numeroDoc: string = numeroVal && numeroVal.length > 0 ? numeroVal : `PASS-${Date.now()}`;

  const dataVal = estraiTag(bloccoGenerali, 'Data');
  const dataDoc: string = dataVal && dataVal.length > 0 ? dataVal : new Date().toISOString().split('T')[0] || '';

  const importoTotaleDoc = estraiTag(bloccoGenerali, 'ImportoTotaleDocumento');

  // 3. Dati Riepilogo IVA
  let imponibileTotale = 0;
  let impostaTotale = 0;
  let esigibilita: 'immediata' | 'differita' | 'split' = 'immediata';

  const regexRiepilogo = /<DatiRiepilogo[^>]*>([\s\S]*?)<\/DatiRiepilogo>/gi;
  let matchRiepilogo: RegExpExecArray | null;

  while ((matchRiepilogo = regexRiepilogo.exec(xmlContent)) !== null) {
    const blocco = matchRiepilogo[1] || '';
    const impStr = estraiTag(blocco, 'ImponibileImporto');
    const impostaStr = estraiTag(blocco, 'Imposta');
    const esigStr = estraiTag(blocco, 'EsigibilitaIVA');

    if (impStr) {
      imponibileTotale += Math.round(parseFloat(impStr.replace(',', '.')) * 100);
    }
    if (impostaStr) {
      impostaTotale += Math.round(parseFloat(impostaStr.replace(',', '.')) * 100);
    }
    if (esigStr) {
      if (esigStr.toUpperCase() === 'D') esigibilita = 'differita';
      if (esigStr.toUpperCase() === 'S') esigibilita = 'split';
    }
  }

  let totaleDocCentesimi = imponibileTotale + impostaTotale;
  if (importoTotaleDoc) {
    totaleDocCentesimi = Math.round(parseFloat(importoTotaleDoc.replace(',', '.')) * 100);
  }

  return {
    fornitore: {
      ragioneSociale: denominazione,
      partitaIva: idCodice,
      codiceFiscale: codFisc,
      indirizzo,
      cap,
      citta: comune,
      nazione,
      pec,
    },
    documento: {
      numero: numeroDoc,
      data: dataDoc,
      imponibileCentesimi: imponibileTotale,
      ivaCentesimi: impostaTotale,
      totaleCentesimi: totaleDocCentesimi,
      esigibilitaIva: esigibilita,
    },
  };
}
