/**
 * `PrismaApp` scrive nel tenant della richiesta, non in quello del costruttore (voce 7).
 *
 * Il difetto che questi test uccidono: `PrismaApp` (e `PrismaIstanziazionePort`) veniva costruito
 * **una volta sola** in `index.ts` con il tenant di Bluecode, e ogni metodo scriveva
 * `tenantId: this.tenantId` — cioè sempre Bluecode. Per un advisor di un altro studio la sessione
 * RLS aveva `app.current_tenant_id = studio 2`, ma l'insert portava `tenant_id = Bluecode`: la
 * `WITH CHECK (tenant_id = app_tenant_corrente())` lo respingeva. Risultato osservato in produzione:
 * gli studi diversi da Bluecode «non facevano registrare clienti e progetti».
 *
 * Il fix rende `tenantId` un getter che legge `contestoTenant` a ogni query, con ripiego al default
 * del costruttore fuori da una richiesta (script, cron). Questi test costruiscono l'istanza col
 * tenant di default (Bluecode, come in produzione) e poi la usano dentro il contesto di un secondo
 * studio: la scrittura deve portare il tenant del **contesto**, non quello del costruttore.
 */
import { describe, expect, it } from 'vitest';
import { PrismaApp } from './adapters/prisma/prismaApp.js';
import { contestoTenant } from './util/prismaClient.js';

const BLUECODE = '00000000-0000-0000-0000-000000000001';
const STUDIO_2 = '00000000-0000-0000-0000-000000000002';

/** Finto Prisma che cattura il `tenantId` con cui viene creata la riga. */
function fintoPrisma() {
  const catturato: { cliente?: any; progetto?: any } = {};
  const prisma: any = {
    cliente: {
      create: async ({ data }: any) => {
        catturato.cliente = data;
        return { id: 'cli-1', nome: data.nome, tipo: data.tipo };
      },
      // getCliente() dentro creaProgetto: risponde nel tenant richiesto
      findUnique: async () => ({ id: 'cli-1', nome: 'ACME', tipo: 'company' }),
    },
    progetto: {
      create: async ({ data }: any) => {
        catturato.progetto = data;
        return { id: 'prg-1', clienteId: data.clienteId, nome: data.nome, stato: data.stato };
      },
    },
  };
  return { prisma, catturato };
}

describe('la scrittura porta il tenant del contesto della richiesta, non quello del costruttore', () => {
  it('creaCliente in contesto studio-2 scrive tenant_id = studio-2 (non Bluecode)', async () => {
    const { prisma, catturato } = fintoPrisma();
    const app = new PrismaApp(prisma, BLUECODE); // costruito con Bluecode, come in produzione

    await contestoTenant.run({ tenantId: STUDIO_2, ruolo: 'advisor' }, async () => {
      await app.creaCliente({ nome: 'ACME', tipo: 'company' });
    });

    expect(catturato.cliente.tenantId).toBe(STUDIO_2);
  });

  it('creaProgetto in contesto studio-2 scrive tenant_id = studio-2', async () => {
    const { prisma, catturato } = fintoPrisma();
    const app = new PrismaApp(prisma, BLUECODE);

    await contestoTenant.run({ tenantId: STUDIO_2, ruolo: 'advisor' }, async () => {
      await app.creaProgetto({ clienteId: 'cli-1', nome: 'Progetto X' });
    });

    expect(catturato.progetto.tenantId).toBe(STUDIO_2);
  });

  it('fuori da una richiesta (nessun contesto) si ripiega sul tenant del costruttore', async () => {
    // È il caso di script e cron: nessun contesto attivo → il default del costruttore.
    const { prisma, catturato } = fintoPrisma();
    const app = new PrismaApp(prisma, BLUECODE);

    await app.creaCliente({ nome: 'Interno', tipo: 'company' });

    expect(catturato.cliente.tenantId).toBe(BLUECODE);
  });

  it('due studi in sequenza non si contaminano: ognuno scrive nel proprio tenant', async () => {
    // La stessa istanza condivisa serve richieste di studi diversi: il tenant non deve «restare
    // attaccato» dalla richiesta precedente. Con un campo fisso questo test non avrebbe senso;
    // con il getter dimostra che ogni scrittura rilegge il contesto corrente.
    const { prisma, catturato } = fintoPrisma();
    const app = new PrismaApp(prisma, BLUECODE);

    await contestoTenant.run({ tenantId: STUDIO_2, ruolo: 'advisor' }, async () => {
      await app.creaCliente({ nome: 'Studio2', tipo: 'company' });
    });
    expect(catturato.cliente.tenantId).toBe(STUDIO_2);

    await contestoTenant.run({ tenantId: BLUECODE, ruolo: 'advisor' }, async () => {
      await app.creaCliente({ nome: 'Bluecode', tipo: 'company' });
    });
    expect(catturato.cliente.tenantId).toBe(BLUECODE);
  });
});
