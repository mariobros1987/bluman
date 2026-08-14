import { describe, it, expect, beforeEach } from 'vitest';
import {
  registraConsuntivazione,
  marcaRitardo,
  risolviRitardo,
  completaMicrovoce,
  completaPassaggioDocumento,
  completaPassaggioForm,
  marcaPassaggioCompletato,
  ProceduraIncompletaError,
} from './esecuzione.js';
import { FakeIstanziazionePort } from './fakeIstanziazionePort.js';
import { istanziaProgetto } from './istanziaProgetto.js';
import { FakeNotificationPort } from './fakeIstanziazionePort.js';
import type { ModuloTemplateConDistinta } from './istanziazionePort.js';

// Due moduli, M02 dipende da M01 — stesso schema usato altrove nei test di istanziazione,
// qui per verificare che lo sblocco funzioni anche durante l'ESECUZIONE, non solo alla creazione.
function templateRadice(): ModuloTemplateConDistinta {
  return {
    id: 'M01',
    versione: 1,
    nome: 'Analisi patrimoniale iniziale',
    categoria: 'Analisi',
    prezzoPacchetto: null,
    dipendenzeDa: [],
    righe: [
      {
        id: 'RD01',
        articoloId: 'A01',
        articoloVersione: 1,
        articoloNome: 'Raccolta documentazione',
        quantita: 1,
        ordine: 1,
        oreEffettive: 4,
        prezzoEffettivo: 1000,
        passaggi: [
          { titolo: 'Carica documento identità', tipo: 'documento', chi: 'cliente', ordine: 1, descrizione: null, campiFormJson: null },
          { titolo: 'Compila dati anagrafici', tipo: 'form', chi: 'cliente', ordine: 2, descrizione: null, campiFormJson: null },
          { titolo: 'Verifica interna', tipo: 'verifica', chi: 'operatore', ordine: 3, descrizione: null, campiFormJson: null },
        ],
      },
    ],
  };
}

function templateDipendente(): ModuloTemplateConDistinta {
  return {
    id: 'M02',
    versione: 1,
    nome: 'Corporate structuring',
    categoria: 'Societario',
    prezzoPacchetto: null,
    dipendenzeDa: ['M01'],
    righe: [
      {
        id: 'RD02',
        articoloId: 'A02',
        articoloVersione: 1,
        articoloNome: 'Costituzione società',
        quantita: 1,
        ordine: 1,
        oreEffettive: 10,
        prezzoEffettivo: 3000,
        passaggi: [],
      },
    ],
  };
}

async function setupProgettoConDueModuli() {
  const port = new FakeIstanziazionePort();
  const notifiche = new FakeNotificationPort();
  port.registraTemplate(templateRadice());
  port.registraTemplate(templateDipendente());

  const r = await istanziaProgetto(
    {
      progettoId: 'P1',
      clienteId: 'C1',
      righe: [
        { moduloTemplateId: 'M01', moduloTemplateVersione: 1 },
        { moduloTemplateId: 'M02', moduloTemplateVersione: 1 },
      ],
    },
    port,
    notifiche,
  );

  const db = port.snapshot();
  const m01Id = [...db.moduliProgetto.values()].find((m) => m.moduloTemplateId === 'M01')!.id;
  const m02Id = [...db.moduliProgetto.values()].find((m) => m.moduloTemplateId === 'M02')!.id;
  const microvoceM01Id = [...db.microvociProgetto.values()].find((m) => m.moduloProgettoId === m01Id)!.id;
  const passaggi = [...db.passaggiProgetto.values()].filter((p) => p.microvoceProgettoId === microvoceM01Id);

  return { port, m01Id, m02Id, microvoceM01Id, passaggi, risultatoIstanziazione: r };
}

describe('registraConsuntivazione (§17.1) — cascata verso il modulo', () => {
  it('somma le ore e ricalcola il segnale di rischio sulla micro-voce', async () => {
    const { port, microvoceM01Id } = await setupProgettoConDueModuli();
    await registraConsuntivazione(microvoceM01Id, 3, port);
    const mv = await port.getMicrovoce(microvoceM01Id);
    expect(mv.oreConsuntivate).toBe(3);
    expect(mv.segnaleRischio).toBe(false); // 3 <= 4 (ore preventivate)
  });

  it('il modulo passa a in_progress quando la sua unica micro-voce diventa active', async () => {
    const { port, m01Id, microvoceM01Id } = await setupProgettoConDueModuli();
    await port.aggiornaMicrovoce(microvoceM01Id, { stato: 'active' });
    await registraConsuntivazione(microvoceM01Id, 1, port);
    const modulo = await port.getModulo(m01Id);
    expect(modulo.stato).toBe('in_progress');
  });

  it('rifiuta ore non positive', async () => {
    const { port, microvoceM01Id } = await setupProgettoConDueModuli();
    await expect(registraConsuntivazione(microvoceM01Id, 0, port)).rejects.toThrow();
  });
});

describe('marcaRitardo / risolviRitardo (§17.1, §7bis)', () => {
  it('rifiuta causaNota vuota', async () => {
    const { port, microvoceM01Id } = await setupProgettoConDueModuli();
    await expect(marcaRitardo(microvoceM01Id, 'blocked', '', port)).rejects.toThrow(/causaNota/);
  });

  it('marca la micro-voce come blocked e il modulo eredita lo stato', async () => {
    const { port, m01Id, microvoceM01Id } = await setupProgettoConDueModuli();
    await marcaRitardo(microvoceM01Id, 'blocked', 'KYC respinto dalla banca', port);
    expect((await port.getMicrovoce(microvoceM01Id)).stato).toBe('blocked');
    expect((await port.getModulo(m01Id)).stato).toBe('blocked');
  });

  it('risolviRitardo riporta a active e il modulo si aggiorna di conseguenza', async () => {
    const { port, m01Id, microvoceM01Id } = await setupProgettoConDueModuli();
    await marcaRitardo(microvoceM01Id, 'blocked', 'causa qualsiasi', port);
    await risolviRitardo(microvoceM01Id, port);
    expect((await port.getMicrovoce(microvoceM01Id)).stato).toBe('active');
    expect((await port.getModulo(m01Id)).stato).toBe('in_progress');
  });
});

describe('completaMicrovoce (§17.1) — il punto di raccordo con la procedura guidata', () => {
  it('rifiuta il completamento se ci sono passaggi non completati', async () => {
    const { port, microvoceM01Id } = await setupProgettoConDueModuli();
    await expect(completaMicrovoce(microvoceM01Id, port)).rejects.toThrow(ProceduraIncompletaError);
  });

  it('il messaggio di errore elenca quanti passaggi mancano', async () => {
    const { port, microvoceM01Id } = await setupProgettoConDueModuli();
    try {
      await completaMicrovoce(microvoceM01Id, port);
      expect.fail('doveva lanciare');
    } catch (e) {
      expect((e as Error).message).toMatch(/3 passaggio/);
    }
  });

  it('permette il completamento SOLO dopo che tutti i passaggi sono done', async () => {
    const { port, microvoceM01Id, passaggi } = await setupProgettoConDueModuli();

    const documento = passaggi.find((p) => p.tipo === 'documento')!;
    const form = passaggi.find((p) => p.tipo === 'form')!;
    const verifica = passaggi.find((p) => p.tipo === 'verifica')!;

    await completaPassaggioDocumento(documento.id, port);
    await expect(completaMicrovoce(microvoceM01Id, port)).rejects.toThrow(ProceduraIncompletaError); // ancora 2 mancanti

    await completaPassaggioForm(form.id, port);
    await expect(completaMicrovoce(microvoceM01Id, port)).rejects.toThrow(ProceduraIncompletaError); // ancora 1 mancante

    await marcaPassaggioCompletato(verifica.id, port);
    await completaMicrovoce(microvoceM01Id, port); // ora deve passare, nessun errore

    expect((await port.getMicrovoce(microvoceM01Id)).stato).toBe('done');
  });

  it('rifiuta completaPassaggioDocumento su un passaggio che non è di tipo documento', async () => {
    const { port, passaggi } = await setupProgettoConDueModuli();
    const form = passaggi.find((p) => p.tipo === 'form')!;
    await expect(completaPassaggioDocumento(form.id, port)).rejects.toThrow();
  });

  it(
    'INTEGRAZIONE: completare l\'unica micro-voce di M01 sblocca M02 (attesa_dipendenza → pending) — ' +
      'non solo alla creazione (già testato in istanziaProgetto.test.ts), ma anche durante l\'esecuzione',
    async () => {
      const { port, m02Id, microvoceM01Id, passaggi } = await setupProgettoConDueModuli();

      // Prima di completare M01: la micro-voce di M02 deve essere attesa_dipendenza
      const microvociM02Prima = await port.getMicrovociDelModulo(m02Id);
      expect(microvociM02Prima.every((m) => m.stato === 'attesa_dipendenza')).toBe(true);

      for (const p of passaggi) {
        if (p.tipo === 'documento') await completaPassaggioDocumento(p.id, port);
        else if (p.tipo === 'form') await completaPassaggioForm(p.id, port);
        else await marcaPassaggioCompletato(p.id, port);
      }
      await completaMicrovoce(microvoceM01Id, port); // M01 diventa done -> dovrebbe sbloccare M02

      const microvociM02Dopo = await port.getMicrovociDelModulo(m02Id);
      expect(microvociM02Dopo.every((m) => m.stato === 'pending')).toBe(true);

      const m02 = await port.getModulo(m02Id);
      expect(m02.stato).toBe('pending'); // pronto per essere preso in carico, non più in attesa
    },
  );
});
