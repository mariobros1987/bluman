// Ciò che esce da `GET /progetti` e `GET /progetti/:id`: nessun segreto di accesso a nessuno, e al
// cliente niente di ciò che è lavoro interno dello studio.
import { describe, expect, it } from 'vitest';
import { progettoPerCliente, progettoPerRuolo, progettoSenzaSegreti } from './proiezioneProgetto.js';

function progetto() {
  return {
    id: 'p-1',
    nome: 'Costituzione Malta',
    stato: 'in_progress',
    clienteId: 'cli-1',
    cliente: { id: 'cli-1', nome: 'Rossi Srl', tipo: 'company', email: 'r@example.test', passwordHash: '$2b$impronta', sessionVersion: 3, rischioAml: 'alto', iban: 'IT60X' },
    accessiRisorsa: [
      { id: 'acc-1', livello: 'write', user: { id: 'u-1', nome: 'Ada', email: 'ada@example.test', ruolo: 'advisor', passwordHash: '$2b$operatore', totpSecret: 'SEGRETO', totpBackupCodes: ['111111'], costoOrarioCentesimi: 9000 } },
    ],
    fatture: [{ id: 'f-1', stato: 'bozza' }],
    moduli: [
      {
        id: 'm-1',
        nome: 'Costituzione',
        stato: 'in_progress',
        orePreventivate: 10,
        accessiRisorsa: [{ id: 'acc-2' }],
        microvoci: [
          {
            id: 'mv-1',
            nome: 'Raccolta documenti',
            stato: 'active',
            risorsaId: 'u-1',
            risorsa: { id: 'u-1', nome: 'Ada', email: 'ada@example.test', ruolo: 'advisor' },
            passaggi: [{ id: 'ps-1', titolo: 'Visura', chi: 'cliente', noteOperatoreJson: { nota: 'cliente lento' }, campiFormJson: ['P.IVA'] }],
          },
        ],
        microvociCondivise: [
          { microvoceProgetto: { id: 'mv-9', nome: 'Condivisa', stato: 'done', risorsa: { id: 'u-2', nome: 'Bo', email: 'bo@example.test' }, passaggi: [{ id: 'ps-9', noteOperatoreJson: 'x' }] } },
        ],
      },
    ],
    avanzamento: { percentuale: 40, stato: 'in_progress', moduli: [{ id: 'm-1', stato: 'in_progress', percentuale: 40 }] },
  };
}

describe('per lo studio', () => {
  it('toglie impronte di password e segreti del secondo fattore, e lascia il resto', () => {
    const uscita = progettoSenzaSegreti(progetto());
    const testo = JSON.stringify(uscita);
    expect(testo).not.toMatch(/\$2b\$|SEGRETO|111111|passwordHash|totp|sessionVersion|costoOrario/);
    expect(uscita.cliente).toMatchObject({ id: 'cli-1', nome: 'Rossi Srl', rischioAml: 'alto', iban: 'IT60X' });
    expect(uscita.accessiRisorsa[0]).toEqual({ id: 'acc-1', livello: 'write', user: { id: 'u-1', nome: 'Ada', email: 'ada@example.test', ruolo: 'advisor' } });
    expect(uscita.fatture).toHaveLength(1);
    expect(uscita.moduli[0]!.microvoci[0]!.passaggi[0]!.noteOperatoreJson).toEqual({ nota: 'cliente lento' });
  });

  it('non modifica l’oggetto che riceve', () => {
    const originale = progetto();
    progettoSenzaSegreti(originale);
    progettoPerCliente(originale);
    expect(originale).toEqual(progetto());
  });
});

describe('per il cliente', () => {
  it('non riceve segreti, valutazione AML, fatture interne, accessi né note degli operatori', () => {
    const uscita = progettoPerCliente(progetto());
    const testo = JSON.stringify(uscita);
    expect(testo).not.toMatch(/\$2b\$|SEGRETO|passwordHash|totp|rischioAml|IT60X|accessiRisorsa|bozza|cliente lento|noteOperatore|example\.test/);
    expect(uscita.cliente).toEqual({ id: 'cli-1', nome: 'Rossi Srl', tipo: 'company' });
  });

  it('conserva ciò che il portale mostra: fasi, attività, stati e percentuali calcolati dal server', () => {
    const uscita = progettoPerCliente(progetto());
    expect(uscita.avanzamento).toEqual(progetto().avanzamento);
    expect(uscita.moduli[0]).toMatchObject({ id: 'm-1', nome: 'Costituzione', stato: 'in_progress', orePreventivate: 10 });
    expect(uscita.moduli[0]!.microvoci[0]).toMatchObject({ id: 'mv-1', nome: 'Raccolta documenti', stato: 'active', risorsa: { nome: 'Ada' } });
    expect(uscita.moduli[0]!.microvoci[0]!.passaggi[0]).toEqual({ id: 'ps-1', titolo: 'Visura', chi: 'cliente', campiFormJson: ['P.IVA'] });
    expect(uscita.moduli[0]!.microvociCondivise[0]!.microvoceProgetto).toMatchObject({ id: 'mv-9', risorsa: { nome: 'Bo' }, passaggi: [{ id: 'ps-9' }] });
  });

  it('la proiezione si sceglie dal ruolo', () => {
    expect(progettoPerRuolo(progetto(), 'cliente').fatture).toBeUndefined();
    expect(progettoPerRuolo(progetto(), 'advisor').fatture).toHaveLength(1);
    expect(progettoPerRuolo(progetto(), undefined).cliente.passwordHash).toBeUndefined();
  });
});
