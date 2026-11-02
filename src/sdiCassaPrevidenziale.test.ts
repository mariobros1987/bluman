/**
 * A5 — `<DatiCassaPrevidenziale>` dichiarava sempre `<AliquotaIVA>22.00`: la mappatura non passava
 * l'aliquota e il generatore usava `|| 22`, che trasforma anche lo 0 in 22. Su una parcella esente
 * la cassa risultava imponibile al 22%, contro il riepilogo e contro il motore (`fatturaEngine`),
 * che alla cassa applica l'aliquota delle righe soggette a cassa.
 */
import { describe, expect, it } from 'vitest';
import { costruisciDatiFatturaSdi, ivaCassaDaRighe, type RigaFatturaPerSdi } from './services/mappaturaFatturaSdi.js';
import { generaFatturaElettronicaXml } from './services/sdiXmlGenerator.js';

function xmlFattura(righe: RigaFatturaPerSdi[], totaleCassaCentesimi = 4000): string {
  const dati = costruisciDatiFatturaSdi({
    fattura: {
      numero: 'FT-2026/001',
      numeroProgressivoSerie: 1,
      data: new Date(2026, 10, 2),
      tipoCassa: 'cassa_commercialisti',
      aliquotaCassa: 4,
      totaleCassaCentesimi,
      totaleImponibileCentesimi: 100000,
      totaleDocumentoCentesimi: 104000,
    },
    righe,
    cliente: { nome: 'Rossi Spa', piva: '09876543210', sdiCode: 'ABC1234' },
    studio: { ragioneSociale: 'Studio BluMan', piva: '01234567890', regimeFiscale: 'RF01' },
  });
  return generaFatturaElettronicaXml(dati);
}

function xmlCassa(righe: RigaFatturaPerSdi[]): string {
  const xml = xmlFattura(righe);
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

describe('A5 — cassa su righe con aliquote miste: un blocco per combinazione', () => {
  const blocchi = (xml: string) => xml.match(/<DatiCassaPrevidenziale>[\s\S]*?<\/DatiCassaPrevidenziale>/g) ?? [];
  const valore = (blocco: string, tag: string) => Number(blocco.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1]);

  it('righe al 22% ed esenti N4 → due blocchi, contributi che sommano il totale cassa', () => {
    // 333,33 + 666,67 di imponibile, cassa 40,01: la ripartizione ha un resto di arrotondamento.
    const xml = xmlFattura(
      [
        { descrizione: 'Consulenza', imponibileCentesimi: 33333, aliquotaIva: 22, applicaCassa: true },
        { descrizione: 'Formazione', imponibileCentesimi: 66667, aliquotaIva: 0, naturaEsenzione: 'N4', applicaCassa: true },
      ],
      4001,
    );
    const [b22, bN4] = blocchi(xml);
    expect(blocchi(xml)).toHaveLength(2);
    expect(b22).toContain('<AliquotaIVA>22.00</AliquotaIVA>');
    expect(b22).not.toContain('<Natura>');
    expect(valore(b22!, 'ImponibileCassa')).toBe(333.33);
    expect(bN4).toContain('<AliquotaIVA>0.00</AliquotaIVA>');
    expect(bN4).toContain('<Natura>N4</Natura>');
    expect(valore(bN4!, 'ImponibileCassa')).toBe(666.67);
    const somma = Math.round((valore(b22!, 'ImportoContributoCassa') + valore(bN4!, 'ImportoContributoCassa')) * 100);
    expect(somma).toBe(4001);
  });

  it('una sola aliquota → un solo blocco, identico a quello di prima', () => {
    const xml = xmlFattura([
      { ...RIGA, aliquotaIva: 22 },
      { ...RIGA, aliquotaIva: 22, descrizione: 'Altra' },
    ]);
    expect(blocchi(xml)).toEqual([
      [
        '<DatiCassaPrevidenziale>',
        '          <TipoCassa>TC22</TipoCassa>',
        '          <AlCassa>4.00</AlCassa>',
        '          <ImportoContributoCassa>40.00</ImportoContributoCassa>',
        '          <ImponibileCassa>0.00</ImponibileCassa>',
        '          <AliquotaIVA>22.00</AliquotaIVA>',
        '        </DatiCassaPrevidenziale>',
      ].join('\n'),
    ]);
  });
});
