import { describe, it, expect, beforeEach } from 'vitest';
import { istanziaProgetto } from './istanziaProgetto.js';
import { FakeIstanziazionePort, FakeNotificationPort } from './fakeIstanziazionePort.js';
import type { ModuloTemplateConDistinta } from './istanziazionePort.js';

function templateSemplice(overrides: Partial<ModuloTemplateConDistinta> = {}): ModuloTemplateConDistinta {
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
        articoloId: 'A_RACCOLTA_DOC',
        articoloVersione: 2,
        articoloNome: 'Raccolta documentazione cliente',
        quantita: 1,
        ordine: 1,
        oreEffettive: 2,
        prezzoEffettivo: 600,
        passaggi: [
          { titolo: 'Carica documento identità', tipo: 'documento', chi: 'cliente', ordine: 1, descrizione: null, campiFormJson: null },
        ],
      },
      {
        id: 'RD02',
        articoloId: 'A_ANALISI_STRUTT',
        articoloVersione: 2,
        articoloNome: 'Analisi struttura patrimoniale esistente',
        quantita: 1,
        ordine: 2,
        oreEffettive: 4,
        prezzoEffettivo: 1200,
        passaggi: [],
      },
    ],
    ...overrides,
  };
}

describe('istanziaProgetto (§15.3) — caso felice', () => {
  let port: FakeIstanziazionePort;
  let notifiche: FakeNotificationPort;

  beforeEach(() => {
    port = new FakeIstanziazionePort();
    notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice());
  });

  it('porta il progetto a in_progress', async () => {
    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    expect(port.snapshot().progettiStato.get('P1')).toBe('in_progress');
  });

  it('crea un modulo_progetto con versione template congelata, prezzo e ore come somma delle righe', async () => {
    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    const moduli = [...port.snapshot().moduliProgetto.values()];
    expect(moduli).toHaveLength(1);
    expect(moduli[0]).toMatchObject({
      moduloTemplateId: 'M01',
      moduloTemplateVersione: 1,
      prezzo: 1800, // 600 + 1200, somma righe (nessun prezzo_pacchetto)
      orePreventivate: 6, // 2 + 4
    });
  });

  it('rispetta il prezzo_pacchetto quando presente, invece della somma righe', async () => {
    port.registraTemplate(templateSemplice({ id: 'M02', prezzoPacchetto: 1500 }));
    const r = await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M02', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    const modulo = port.snapshot().moduliProgetto.get(r.moduliProgettoIds[0]!);
    expect(modulo?.prezzo).toBe(1500);
  });

  it('crea una micro-voce per riga di distinta, congelando articolo_versione', async () => {
    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    const microvoci = [...port.snapshot().microvociProgetto.values()];
    expect(microvoci).toHaveLength(2);
    expect(microvoci.every((m) => m.articoloVersione === 2)).toBe(true);
  });

  it('quantità > 1 genera una micro-voce per unità (dimostra il caso "Apertura conto ×2", §3bis)', async () => {
    port.registraTemplate(
      templateSemplice({
        id: 'M03',
        righe: [
          {
            id: 'RD_CONTO',
            articoloId: 'A_APERTURA_CONTO',
            articoloVersione: 1,
            articoloNome: 'Apertura conto corrente singolo',
            quantita: 2,
            ordine: 1,
            oreEffettive: 4,
            prezzoEffettivo: 900,
            passaggi: [],
          },
        ],
      }),
    );
    const r = await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M03', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    const microvoci = [...port.snapshot().microvociProgetto.values()];
    expect(microvoci).toHaveLength(2); // due micro-voci, non una con quantità=2 scritta nel campo
    const modulo = port.snapshot().moduliProgetto.get(r.moduliProgettoIds[0]!);
    expect(modulo?.prezzo).toBe(1800); // 900 × 2
  });

  it('due righe con lo STESSO nome nel modulo generano UNA sola micro-voce (dedup per nome)', async () => {
    // Il caso del template popolato da due seed diversi: stesso articolo (stesso nome) sotto id
    // diversi. La regola è «una micro-voce per nome nel modulo»: si tiene la prima riga, si salta l'altra.
    port.registraTemplate(
      templateSemplice({
        id: 'M04',
        righe: [
          { id: 'RD_ART08', articoloId: 'art-08', articoloVersione: 1, articoloNome: 'Atto costitutivo e statuto', quantita: 1, ordine: 3, oreEffettive: 3, prezzoEffettivo: 500, passaggi: [] },
          { id: 'RD_A_ATTO', articoloId: 'A_ATTO_COST', articoloVersione: 1, articoloNome: 'Atto costitutivo e statuto', quantita: 1, ordine: 3, oreEffettive: 3, prezzoEffettivo: 500, passaggi: [] },
        ],
      }),
    );
    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M04', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    const microvoci = [...port.snapshot().microvociProgetto.values()];
    expect(microvoci).toHaveLength(1);
    expect(microvoci[0]!.nome).toBe('Atto costitutivo e statuto');
    expect(microvoci[0]!.articoloId).toBe('art-08'); // tiene la prima riga in ordine
  });

  it('crea un passaggio_progetto per copia da ogni passaggio_template dell\'articolo', async () => {
    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    expect(port.snapshot().passaggiProgetto.size).toBe(1); // solo RD01 ha un passaggio definito
    expect([...port.snapshot().passaggiProgetto.values()][0]?.titolo).toBe('Carica documento identità');
  });

  it('notifica cliente e team a istanziazione completata', async () => {
    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );
    expect(notifiche.chiamate).toHaveLength(1);
    expect(notifiche.chiamate[0]).toMatchObject({ progettoId: 'P1', clienteId: 'C1' });
  });

  it('rifiuta un\'istanziazione senza righe', async () => {
    await expect(istanziaProgetto({ progettoId: 'P1', clienteId: 'C1', righe: [] }, port, notifiche)).rejects.toThrow();
  });
});

describe('istanziaProgetto — dipendenze tra moduli (§7ter, §15.3 passo 5)', () => {
  it('un modulo con dipendenza soddisfatta nello stesso batch parte in attesa_dipendenza, non pending', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice({ id: 'M01' })); // radice, nessuna dipendenza
    port.registraTemplate(templateSemplice({ id: 'M02', dipendenzeDa: ['M01'] })); // dipende da M01

    await istanziaProgetto(
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

    const microvoci = [...port.snapshot().microvociProgetto.values()];
    const moduli = port.snapshot().moduliProgetto;
    const m02Id = [...moduli.values()].find((m) => m.moduloTemplateId === 'M02')!.id;
    const microvociM02 = microvoci.filter((m) => m.moduloProgettoId === m02Id);

    expect(microvociM02.every((m) => m.stato === 'attesa_dipendenza')).toBe(true);

    const m01Id = [...moduli.values()].find((m) => m.moduloTemplateId === 'M01')!.id;
    const microvociM01 = microvoci.filter((m) => m.moduloProgettoId === m01Id);
    expect(microvociM01.every((m) => m.stato === 'pending')).toBe(true); // M01 non ha dipendenze
  });

  it('crea una riga modulo_progetto_dipendenza per ogni dipendenza soddisfatta nel batch', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice({ id: 'M01' }));
    port.registraTemplate(templateSemplice({ id: 'M02', dipendenzeDa: ['M01'] }));

    await istanziaProgetto(
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

    expect(port.snapshot().dipendenze).toHaveLength(1);
  });

  it('un modulo la cui dipendenza NON fa parte del batch resta pending (limite dichiarato)', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    // M02 dipende da un modulo M99 mai selezionato in questo progetto
    port.registraTemplate(templateSemplice({ id: 'M02', dipendenzeDa: ['M99'] }));

    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M02', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );

    const microvoci = [...port.snapshot().microvociProgetto.values()];
    expect(microvoci.every((m) => m.stato === 'pending')).toBe(true);
    expect(port.snapshot().dipendenze).toHaveLength(0);
  });
});

describe('istanziaProgetto — atomicità: rollback su fallimento a metà (§15.3, ultima riga)', () => {
  it('se la creazione di una micro-voce fallisce, NESSUNA scrittura precedente resta applicata', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice()); // due righe: A_RACCOLTA_DOC, A_ANALISI_STRUTT
    port.guastaAllaCreazioneMicrovoce = 'A_ANALISI_STRUTT'; // fallisce sulla SECONDA riga

    await expect(
      istanziaProgetto(
        { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
        port,
        notifiche,
      ),
    ).rejects.toThrow(/Guasto simulato/);

    const db = port.snapshot();
    // Il modulo_progetto era già stato creato PRIMA del fallimento, e la prima micro-voce
    // (A_RACCOLTA_DOC) pure — eppure dopo il rollback non deve restare traccia di nessuno dei due.
    expect(db.moduliProgetto.size).toBe(0);
    expect(db.microvociProgetto.size).toBe(0);
    expect(db.progettiStato.has('P1')).toBe(false); // nemmeno il passo 1 deve sopravvivere
  });

  it('un fallimento nella notifica (fuori transazione) NON annulla i dati già scritti', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice());
    notifiche.guasta = true;

    await expect(
      istanziaProgetto(
        { progettoId: 'P1', clienteId: 'C1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
        port,
        notifiche,
      ),
    ).rejects.toThrow(/Guasto simulato nel servizio notifiche/);

    // A differenza del test precedente: qui il progetto DEVE risultare istanziato,
    // perché il fallimento è nel passo 6 (notifica), fuori dalla transazione (§15.3).
    const db = port.snapshot();
    expect(db.moduliProgetto.size).toBe(1);
    expect(db.progettiStato.get('P1')).toBe('in_progress');
  });

  it('con preventivoId: se l’istanziazione fallisce, il preventivo NON resta accettato', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice());
    port.guastaAllaCreazioneMicrovoce = 'A_ANALISI_STRUTT'; // fallisce a metà

    // È il guasto osservato in produzione: l’accettazione fuori transazione lasciava un
    // preventivo «accettato» senza moduli, e non più riprovabile (il controllo di stato
    // a monte rifiuta i preventivi già accettati) — cliente bloccato.
    await expect(
      istanziaProgetto(
        { progettoId: 'P1', clienteId: 'C1', preventivoId: 'PREV1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
        port,
        notifiche,
      ),
    ).rejects.toThrow(/Guasto simulato/);

    expect(port.statoPreventivo('PREV1')).toBeNull(); // il rollback annulla anche il passo 0
  });

  it('con preventivoId: a successo il preventivo risulta accettato', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice());

    await istanziaProgetto(
      { progettoId: 'P1', clienteId: 'C1', preventivoId: 'PREV1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] },
      port,
      notifiche,
    );

    expect(port.statoPreventivo('PREV1')).toBe('accettato');
  });

  it('B3 — idempotenza: istanziare due volte lo stesso preventivo aborta senza duplicare i moduli', async () => {
    const port = new FakeIstanziazionePort();
    const notifiche = new FakeNotificationPort();
    port.registraTemplate(templateSemplice());
    const args = { progettoId: 'P1', clienteId: 'C1', preventivoId: 'PREV1', righe: [{ moduloTemplateId: 'M01', moduloTemplateVersione: 1 }] };

    const primo = await istanziaProgetto(args, port, notifiche);
    const moduliDopoPrimo = port.snapshot().moduliProgetto.size;

    // Secondo tentativo (doppio-invio/race): il compare-and-set trova già 'accettato' → aborta.
    await expect(istanziaProgetto(args, port, notifiche)).rejects.toThrow(/già accettato/i);
    expect(port.snapshot().moduliProgetto.size).toBe(moduliDopoPrimo); // nessun modulo duplicato
    expect(primo.moduliProgettoIds.length).toBeGreaterThan(0);
  });
});
