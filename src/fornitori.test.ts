import { describe, it, expect, beforeEach } from 'vitest';
import { parseXmlFatturaPassiva } from './services/fatturaPassivaParser.js';
import { buildServer } from './server.js';
import { signJwt } from './util/jwt.js';

describe('🧪 Ciclo Passivo & Fornitori — Test Suite', () => {
  const XML_ESEMPIO_FATTURA_PASSIVA = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">
  <FatturaElettronicaHeader>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA>
          <IdPaese>IT</IdPaese>
          <IdCodice>01234567890</IdCodice>
        </IdFiscaleIVA>
        <CodiceFiscale>01234567890</CodiceFiscale>
        <Anagrafica>
          <Denominazione>Fornitore Servizi Cloud S.r.l.</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
      <Sede>
        <Indirizzo>Via Roma 100</Indirizzo>
        <CAP>20121</CAP>
        <Comune>Milano</Comune>
        <Provincia>MI</Provincia>
        <Nazione>IT</Nazione>
      </Sede>
      <Contatti>
        <PECDestinatario>fornitorecloud@pec.it</PECDestinatario>
      </Contatti>
    </CedentePrestatore>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-09-01</Data>
        <Numero>FT-PASS-2026-99</Numero>
        <ImportoTotaleDocumento>122.00</ImportoTotaleDocumento>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DatiRiepilogo>
        <AliquotaIVA>22.00</AliquotaIVA>
        <ImponibileImporto>100.00</ImponibileImporto>
        <Imposta>22.00</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;

  describe('Parser XML FatturaPA Passiva', () => {
    it('estrae correttamente i dati del fornitore, documento e totali centesimi', () => {
      const dati = parseXmlFatturaPassiva(XML_ESEMPIO_FATTURA_PASSIVA);

      expect(dati.fornitore.ragioneSociale).toBe('Fornitore Servizi Cloud S.r.l.');
      expect(dati.fornitore.partitaIva).toBe('01234567890');
      expect(dati.fornitore.indirizzo).toBe('Via Roma 100');
      expect(dati.fornitore.cap).toBe('20121');
      expect(dati.fornitore.citta).toBe('Milano');
      expect(dati.fornitore.pec).toBe('fornitorecloud@pec.it');

      expect(dati.documento.numero).toBe('FT-PASS-2026-99');
      expect(dati.documento.data).toBe('2026-09-01');
      expect(dati.documento.imponibileCentesimi).toBe(10000);
      expect(dati.documento.ivaCentesimi).toBe(2200);
      expect(dati.documento.totaleCentesimi).toBe(12200);
      expect(dati.documento.esigibilitaIva).toBe('immediata');
    });

    it('gestisce XML con split payment o esigibilità differita', () => {
      const xmlSplit = XML_ESEMPIO_FATTURA_PASSIVA.replace('<EsigibilitaIVA>I</EsigibilitaIVA>', '<EsigibilitaIVA>S</EsigibilitaIVA>');
      const dati = parseXmlFatturaPassiva(xmlSplit);
      expect(dati.documento.esigibilitaIva).toBe('split');
    });
  });

  describe('Rotte Fornitori HTTP & Validazione', () => {
    it('rifiuta la creazione di un fornitore senza ragione sociale', async () => {
      const server = await buildServer({} as any);
      const token = signJwt({
        userId: 'admin-1',
        tenantId: 'tenant-test',
        ruolo: 'advisor',
        email: 'advisor@test.it',
      });

      const res = await server.inject({
        method: 'POST',
        url: '/fornitori',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          ragioneSociale: '',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.errore).toMatch(/obbligatoria/i);
    });

    it('rifiuta import XML senza contenuto', async () => {
      const server = await buildServer({} as any);
      const token = signJwt({
        userId: 'admin-1',
        tenantId: 'tenant-test',
        ruolo: 'advisor',
        email: 'advisor@test.it',
      });

      const res = await server.inject({
        method: 'POST',
        url: '/fatture-ricevute/import-xml',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          xmlContent: '   ',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.errore).toMatch(/mancante/i);
    });
  });
});
