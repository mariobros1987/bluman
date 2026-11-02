/**
 * A13 — `PrismaApp.creaPreventivo` trasformava ogni errore della lettura del modulo in
 * «Modulo non trovato» (`.catch(() => null)`): un database irraggiungibile si presentava
 * all'operatore come un modulo mancante dalla libreria. Ora solo la riga assente (P2025 di
 * `findFirstOrThrow`) è ModuloNonTrovatoError; ogni altro errore si propaga com'è.
 */
import { describe, expect, it, vi } from 'vitest';
import { PrismaApp } from './adapters/prisma/prismaApp.js';
import { ModuloNonTrovatoError } from './adapters/appErrors.js';

const BLUECODE = '00000000-0000-0000-0000-000000000001';
const INPUT = { clienteId: 'cli-1', progettoId: 'prg-1', righe: [{ moduloTemplateId: 'mod-1', moduloTemplateVersione: 1 }] };

/** PrismaApp con cliente e progetto presenti e la lettura del modulo che fallisce con `errore`. */
function appCheFallisce(errore: unknown) {
  const create = vi.fn();
  const app = new PrismaApp({ preventivo: { create } } as any, BLUECODE);
  vi.spyOn(app, 'getCliente').mockResolvedValue({ id: 'cli-1', nome: 'ACME', tipo: 'company' });
  vi.spyOn(app, 'getProgetto').mockResolvedValue({ id: 'prg-1' } as any);
  (app as any).istanziazione = { eseguiInTransazione: async () => { throw errore; } };
  return { app, create };
}

describe('creaPreventivo — modulo assente e guasto del database sono cose diverse (A13)', () => {
  it('modulo davvero assente (P2025) → ModuloNonTrovatoError', async () => {
    const assente = Object.assign(new Error('No ModuloTemplate found'), { code: 'P2025' });
    const { app, create } = appCheFallisce(assente);
    await expect(app.creaPreventivo(INPUT)).rejects.toBeInstanceOf(ModuloNonTrovatoError);
    expect(create).not.toHaveBeenCalled();
  });

  it('errore del database → si propaga com\'è, non diventa «Modulo non trovato»', async () => {
    const guasto = Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    const { app, create } = appCheFallisce(guasto);
    await expect(app.creaPreventivo(INPUT)).rejects.toBe(guasto);
    expect(create).not.toHaveBeenCalled();
  });
});
