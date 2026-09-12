// src/jwtRotation.test.ts
// §6.2b — Test suite per la rotazione dual-key / multi-key JWT zero-downtime.
//
// Strategia: sovrascriviamo process.env prima dell'import del modulo, che
// legge JWT_SEGRETI una volta sola alla startup. Ogni test usa `vi.resetModules()`
// + `import()` dinamico per rileggere il modulo con env diverso.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const SEGRETO_A = 'a'.repeat(32); // 32 char, lunghezza minima
const SEGRETO_B = 'b'.repeat(32);
const SEGRETO_C = 'c'.repeat(32);

async function caricaJwt(env: Record<string, string | undefined>) {
  vi.resetModules();
  const backup: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    backup[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import('./util/jwt.js');
  // ripristina
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return mod;
}

describe('§6.2b — JWT Dual-Key Rotation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('signJwt firma con il segreto corrente e verifyJwt lo verifica', async () => {
    const { signJwt, verifyJwt } = await caricaJwt({
      JWT_SECRET: SEGRETO_A,
      JWT_PREVIOUS_SECRETS: undefined,
      NODE_ENV: 'test',
    });

    const payload = { userId: 'u1', tenantId: 't1', email: 'a@b.it', ruolo: 'advisor' as const };
    const token = signJwt(payload, 60);
    const verificato = verifyJwt(token);

    expect(verificato).not.toBeNull();
    expect(verificato!.userId).toBe('u1');
    expect(verificato!.ruolo).toBe('advisor');
  });

  it('un token firmato con il vecchio segreto è verificabile se in JWT_PREVIOUS_SECRETS', async () => {
    // Prima fase: firma con SEGRETO_A (vecchio)
    const moduloVecchio = await caricaJwt({
      JWT_SECRET: SEGRETO_A,
      JWT_PREVIOUS_SECRETS: undefined,
      NODE_ENV: 'test',
    });
    const tokenVecchio = moduloVecchio.signJwt(
      { userId: 'u2', tenantId: 't1', email: 'b@b.it', ruolo: 'advisor' as const },
      60,
    );

    // Seconda fase: rotazione — nuovo segreto B, vecchio A in JWT_PREVIOUS_SECRETS
    const moduloNuovo = await caricaJwt({
      JWT_SECRET: SEGRETO_B,
      JWT_PREVIOUS_SECRETS: SEGRETO_A,
      NODE_ENV: 'test',
    });

    const risultato = moduloNuovo.verifyJwt(tokenVecchio);
    expect(risultato).not.toBeNull();
    expect(risultato!.userId).toBe('u2');
  });

  it('signJwt usa sempre il segreto corrente (non il precedente)', async () => {
    const { signJwt, verifyJwt } = await caricaJwt({
      JWT_SECRET: SEGRETO_B,
      JWT_PREVIOUS_SECRETS: SEGRETO_A,
      NODE_ENV: 'test',
    });

    // Il nuovo token deve essere verificabile solo con B
    const token = signJwt(
      { userId: 'u3', tenantId: 't1', email: 'c@b.it', ruolo: 'advisor' as const },
      60,
    );

    // Verifica che il modulo con solo A non accetti il token firmato con B
    const moduloSoloA = await caricaJwt({
      JWT_SECRET: SEGRETO_A,
      JWT_PREVIOUS_SECRETS: undefined,
      NODE_ENV: 'test',
    });
    expect(moduloSoloA.verifyJwt(token)).toBeNull();

    // Ma il modulo con B corrente lo accetta
    expect(verifyJwt(token)).not.toBeNull();
  });

  it('un token non firmato con nessun segreto della lista viene rifiutato', async () => {
    // Firma con C (non in lista)
    const moduloC = await caricaJwt({
      JWT_SECRET: SEGRETO_C,
      JWT_PREVIOUS_SECRETS: undefined,
      NODE_ENV: 'test',
    });
    const tokenC = moduloC.signJwt(
      { userId: 'u4', tenantId: 't1', email: 'd@b.it', ruolo: 'advisor' as const },
      60,
    );

    // Il modulo con A+B non accetta il token di C
    const moduloAB = await caricaJwt({
      JWT_SECRET: SEGRETO_B,
      JWT_PREVIOUS_SECRETS: SEGRETO_A,
      NODE_ENV: 'test',
    });
    expect(moduloAB.verifyJwt(tokenC)).toBeNull();
  });

  it('supporta più segreti precedenti separati da virgola', async () => {
    // Firma con A (più vecchio)
    const moduloA = await caricaJwt({ JWT_SECRET: SEGRETO_A, NODE_ENV: 'test' });
    const tokenA = moduloA.signJwt(
      { userId: 'u5', tenantId: 't1', email: 'e@b.it', ruolo: 'super_admin' as const },
      60,
    );

    // Modulo con C corrente, B e A precedenti
    const moduloC = await caricaJwt({
      JWT_SECRET: SEGRETO_C,
      JWT_PREVIOUS_SECRETS: `${SEGRETO_B},${SEGRETO_A}`,
      NODE_ENV: 'test',
    });
    expect(moduloC.verifyJwt(tokenA)).not.toBeNull();
  });
});
