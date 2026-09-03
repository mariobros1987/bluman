/**
 * §14 — il contesto tenant che rende effettive le policy RLS.
 *
 * Le policy stesse non sono verificabili qui: la suite gira con un DATABASE_URL che
 * rifiuta la connessione (vedi vitest.setup.ts), di proposito. Quello che si verifica è
 * il lato applicativo, che è dove stavano i due errori più facili da fare:
 *
 *   1. usare `run` invece di `enterWith` — il contesto morirebbe appena l'hook Fastify
 *      ritorna, e ogni query della richiesta partirebbe senza tenant;
 *   2. dimenticare di reimpostare la variabile dentro una transazione interattiva, che
 *      gira su una connessione propria dove la `set_config` esterna non arriva.
 *
 * In entrambi i casi il sintomo sarebbe "zero righe", non un errore: da qui i test.
 */
import { describe, it, expect } from 'vitest';
import {
  attivaContestoTenant,
  contestoTenant,
  conContestoInTransazione,
  prismaAmministrativo,
} from './prismaClient.js';

const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

/** Registra le chiamate a `$executeRaw` come (frammenti, valori) del tag template. */
function txFinta() {
  const chiamate: Array<{ sql: string; valori: unknown[] }> = [];
  return {
    chiamate,
    $executeRaw: (frammenti: TemplateStringsArray | string[], ...valori: unknown[]) => {
      chiamate.push({ sql: Array.from(frammenti).join('?'), valori });
      return Promise.resolve(1);
    },
  };
}

describe('prismaClient — §14 contesto tenant', () => {
  it('il contesto sopravvive al ritorno della funzione che lo imposta', async () => {
    // Riproduce la forma di un hook Fastify: imposta e ritorna, senza racchiudere il
    // resto della richiesta. Con `run` al posto di `enterWith` questo test fallirebbe.
    function hookFinto() {
      attivaContestoTenant({ tenantId: TENANT_A, ruolo: 'advisor' });
    }
    hookFinto();
    await Promise.resolve();

    expect(contestoTenant.getStore()).toEqual({ tenantId: TENANT_A, ruolo: 'advisor' });
  });

  it('una seconda attivazione sostituisce la prima (il login scopre il tenant dopo l\'hook)', () => {
    attivaContestoTenant({ tenantId: TENANT_A, ruolo: 'advisor' });
    attivaContestoTenant({ tenantId: TENANT_B, ruolo: 'super_admin' });

    expect(contestoTenant.getStore()?.tenantId).toBe(TENANT_B);
  });

  it('conContestoInTransazione imposta tenant e ruolo come parametri, non concatenati', async () => {
    const tx = txFinta();

    const risultato = await contestoTenant.run({ tenantId: TENANT_A, ruolo: 'advisor' }, () =>
      conContestoInTransazione(tx, async () => 'valore di ritorno'),
    );

    expect(risultato).toBe('valore di ritorno');
    expect(tx.chiamate).toHaveLength(1);
    // I valori restano parametri del tag template: un tenantId che arriva da un header
    // non può chiudere la stringa e aggiungere SQL.
    expect(tx.chiamate[0]!.valori).toEqual([TENANT_A, 'advisor']);
    expect(tx.chiamate[0]!.sql).toContain('app.current_tenant_id');
    expect(tx.chiamate[0]!.sql).toContain('app.current_ruolo');
    // Terzo argomento `true` di set_config: vale solo per questa transazione, altrimenti
    // resterebbe sulla connessione e verrebbe riusato dalla richiesta successiva.
    expect(tx.chiamate[0]!.sql).toContain('true');
  });

  it('senza ruolo passa stringa vuota, non "undefined"', async () => {
    const tx = txFinta();

    // `NULLIF(current_setting(...), '')` traduce la stringa vuota in NULL, e nessuna
    // policy è vera per NULL. La stringa 'undefined' invece verrebbe confrontata come
    // un ruolo reale.
    await contestoTenant.run({ tenantId: TENANT_A }, () => conContestoInTransazione(tx, async () => null));

    expect(tx.chiamate[0]!.valori).toEqual([TENANT_A, '']);
  });

  it('fuori da una richiesta non tocca la transazione', async () => {
    const tx = txFinta();

    // Script, seed e bootstrap girano senza contesto: devono passare invariati, perché
    // usano la connessione amministrativa che non è soggetta alle policy.
    const risultato = await contestoTenant.exit(() => conContestoInTransazione(tx, async () => 42));

    expect(risultato).toBe(42);
    expect(tx.chiamate).toHaveLength(0);
  });

  it('prismaAmministrativo riusa la stessa istanza', () => {
    // Un client nuovo a ogni chiamata aprirebbe un pool di connessioni per ogni script.
    expect(prismaAmministrativo()).toBe(prismaAmministrativo());
  });
});
