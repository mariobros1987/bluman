// Analisi del 26/11, E10 — il valore del progetto si scrive sul server come somma dei prezzi dei
// moduli. Qui si prova la regola da sola, con un client finto: quanto scrive, e quando non scrive.
import { describe, it, expect } from 'vitest';
import { riallineaValoreProgetto, type ClientValoreProgetto } from './services/valoreProgetto.js';

function clientFinto(prezzi: number[]) {
  const scritture: Array<{ id: string; valoreTotale: number }> = [];
  const client: ClientValoreProgetto = {
    moduloProgetto: {
      aggregate: async () => ({
        _sum: { prezzo: prezzi.length ? prezzi.reduce((a, b) => a + b, 0) : null },
        _count: { _all: prezzi.length },
      }),
    },
    progetto: {
      update: async ({ where, data }) => {
        scritture.push({ id: where.id, valoreTotale: data.valoreTotale });
      },
    },
  };
  return { client, scritture };
}

describe('riallineaValoreProgetto', () => {
  it('scrive la somma dei prezzi dei moduli, in centesimi', async () => {
    const { client, scritture } = clientFinto([180000, 150000]);
    await expect(riallineaValoreProgetto(client, 'P1')).resolves.toBe(330000);
    expect(scritture).toEqual([{ id: 'P1', valoreTotale: 330000 }]);
  });

  it('moduli tutti a prezzo zero → il valore è 0, ed è un valore scritto', async () => {
    const { client, scritture } = clientFinto([0, 0]);
    await expect(riallineaValoreProgetto(client, 'P1')).resolves.toBe(0);
    expect(scritture).toEqual([{ id: 'P1', valoreTotale: 0 }]);
  });

  it('progetto senza moduli → non tocca il valore scritto a mano', async () => {
    const { client, scritture } = clientFinto([]);
    await expect(riallineaValoreProgetto(client, 'P1')).resolves.toBeNull();
    expect(scritture).toEqual([]);
  });

  it('tolto l’ultimo modulo → il valore si azzera, perché era la somma di moduli che non ci sono più', async () => {
    const { client, scritture } = clientFinto([]);
    await expect(riallineaValoreProgetto(client, 'P1', { azzeraSeSenzaModuli: true })).resolves.toBe(0);
    expect(scritture).toEqual([{ id: 'P1', valoreTotale: 0 }]);
  });
});
