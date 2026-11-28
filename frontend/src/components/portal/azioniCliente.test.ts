// Le cose da fare del cliente: l'elenco è del server; qui si aggiungono solo i documenti che il
// server segnala «da firmare», senza rifarne la regola.
import { describe, expect, it } from 'vitest';
import type { AzioneCliente, RiepilogoProgetto } from '../../api/canaleProtetto';
import type { DocumentoPortale } from '../../api/client';
import { azioniDelProgetto, turnoDelProgetto } from './azioniCliente';

function progetto(azioni: AzioneCliente[], turno: RiepilogoProgetto['turno'] = 'studio'): RiepilogoProgetto {
  return { id: 'p-1', nome: 'Costituzione Malta', numeroContratto: null, stato: 'in_progress', percentuale: 40, turno, letteraFirmata: true, fasi: [], azioni, richieste: [] };
}

const azione = (tipo: AzioneCliente['tipo'], urgente = false): AzioneCliente => ({ tipo, titolo: tipo, dettaglio: '', scheda: 'richieste', riferimentoId: tipo, urgente });
const documento = (id: string, parziale: Partial<DocumentoPortale>): DocumentoPortale => ({ id, titolo: `Doc ${id}`, progettoId: 'p-1', richiedeFirma: true, ...parziale } as DocumentoPortale);

describe('azioniDelProgetto', () => {
  it('aggiunge i documenti da firmare di questo incarico, dopo le urgenti e prima del resto', () => {
    const azioni = azioniDelProgetto(
      progetto([azione('firma_incarico', true), azione('richiesta'), azione('messaggi')]),
      [documento('d-1', {}), documento('d-2', { richiedeFirma: false }), documento('d-3', { progettoId: 'altro' })],
    );
    expect(azioni.map((a) => [a.tipo, a.riferimentoId])).toEqual([
      ['firma_incarico', 'firma_incarico'],
      ['firma_documento', 'd-1'],
      ['richiesta', 'richiesta'],
      ['messaggi', 'messaggi'],
    ]);
    expect(azioni[1]).toMatchObject({ scheda: 'documenti', titolo: 'Firma «Doc d-1»', progettoId: 'p-1', progettoNome: 'Costituzione Malta' });
  });

  it('senza documenti da firmare l’elenco è quello del server', () => {
    expect(azioniDelProgetto(progetto([azione('richiesta')]), []).map((a) => a.tipo)).toEqual(['richiesta']);
  });
});

describe('turnoDelProgetto', () => {
  it('tocca al cliente anche quando l’unica cosa da fare è un documento da firmare', () => {
    const p = progetto([], 'studio');
    expect(turnoDelProgetto(p, azioniDelProgetto(p, [documento('d-1', {})]))).toBe('cliente');
    expect(turnoDelProgetto(p, [])).toBe('studio');
    expect(turnoDelProgetto(progetto([], 'concluso'), [])).toBe('concluso');
  });
});
