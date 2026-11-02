/**
 * A5 — `<DatiCassaPrevidenziale>` dichiarava sempre `<AliquotaIVA>22.00`: la mappatura non passava
 * l'aliquota e il generatore usava `|| 22`, che trasforma anche lo 0 in 22. Su una parcella esente
 * la cassa risultava imponibile al 22%, contro il riepilogo e contro il motore (`fatturaEngine`),
 * che alla cassa applica l'aliquota delle righe soggette a cassa.
 */
import { describe, expect, it } from 'vitest';
import { costruisciDatiFatturaSdi, ivaCassaDaRighe, type RigaFatturaPerSdi } from './services/mappaturaFatturaSdi.js';
import { generaFatturaElettronicaXml } from './services/sdiXmlGenerator.js';

function xmlCassa(righe: RigaFatturaPerSdi[]): string {
  const dati = costruisciDatiFatturaSdi({
    fattura: {
      numero: 'FT-2026/001',
      numeroProgressivoSerie: 1,
      data: new Date(2026, 10, 2),
      tipoCassa: 'cassa_commercialisti',
      aliquotaCassa: 4,
      totaleCassaCentesimi: 4000,
      totaleImponibileCentesimi: 100000,
      totaleDocumentoCentesimi: 104000,
    },
    righe,
    cliente: { nome: 'Rossi Spa', piva: '09876543210', sdiCode: 'ABC1234' },
    studio: { ragioneSociale: 'Studio BluMan', piva: '01234567890', regimeFiscale: 'RF01' },
  });
  const xml = generaFatturaElettronicaXml(dati);
  const blocco = xml.match(/<DatiCassaPrevidenziale>[\s\S]*?<\/DatiCassaPrevidenziale>/);
  expect(blocco).not.toBeNull();
  return blocco![0];
}

const RIGA = { descrizione: 'Consulenza', imponibileCentesimi: 100000, applicaCassa: true };

describe('A5 — aliquota IVA della cassa previdenziale', () => {
  it('fattura esente con cassa → AliquotaIVA 0.00 e la natura delle righe', () => {
    const blocco = xmlCassa([{ ...RIGA, aliquotaIva: 0, naturaEsenzione: 'N4' }]);
    expect(blocco).toContain('<AliquotaIVA>0.00</AliquotaIVA>');
    expect(blocco).toContain('<Natura>N4</Natura>');
  });

  it('fattura al 22% → AliquotaIVA 22.00, nessuna natura', () => {
    const blocco = xmlCassa([{ ...RIGA, aliquotaIva: 22 }]);
    expect(blocco).toContain('<AliquotaIVA>22.00</AliquotaIVA>');
    expect(blocco).not.toContain('<Natura>');
  });

  it('esente senza natura sulle righe → nessuna natura inventata', () => {
    const blocco = xmlCassa([{ ...RIGA, aliquotaIva: 0, naturaEsenzione: null }]);
    expect(blocco).toContain('<AliquotaIVA>0.00</AliquotaIVA>');
    expect(blocco).not.toContain('<Natura>');
  });
});

describe('ivaCassaDaRighe', () => {
  it('ignora le righe escluse dalla cassa', () => {
    expect(
      ivaCassaDaRighe([
        { ...RIGA, aliquotaIva: 10 },
        { ...RIGA, aliquotaIva: 22, applicaCassa: false },
      ]),
    ).toEqual({ aliquotaIvaCassa: 10, naturaCassa: null });
  });

  it('aliquote diverse sulle righe soggette a cassa → nessun valore unico', () => {
    expect(ivaCassaDaRighe([{ ...RIGA, aliquotaIva: 10 }, { ...RIGA, aliquotaIva: 22 }])).toEqual({});
  });
});
