/**
 * Test Suite per lo Script di Ripristino e Disaster Recovery (restoreDbTest.ts)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  eseguiRestoreBackup,
  validaStrutturaBackup,
  type BackupPayload,
} from './restoreDbTest.js';

describe('restoreDbTest — Disaster Recovery & Restore Drill', () => {
  const TENANT_ORIGINALE = '00000000-0000-0000-0000-000000000001';
  const TENANT_STAGING = '99999999-9999-9999-9999-999999999999';

  let fakePrisma: any;
  let chiamateUpsert: Record<string, any[]>;

  const backupValido: BackupPayload = {
    metadata: {
      tenantId: TENANT_ORIGINALE,
      exportedAt: '2026-09-12T10:00:00.000Z',
      platform: 'BluMan ERP Advisory',
      version: '2.5.0',
    },
    tenants: [
      { id: TENANT_ORIGINALE, ragioneSociale: 'Studio Legale Alfa' },
    ],
    utenti: [
      { id: 'usr-1', tenantId: TENANT_ORIGINALE, email: 'admin@alfa.test', ruolo: 'super_admin' },
    ],
    giurisdizioni: [
      { id: 'giur-it', tenantId: TENANT_ORIGINALE, nome: 'Italia' },
    ],
    articoli: [
      { id: 'art-1', tenantId: TENANT_ORIGINALE, codice: 'A01', nome: 'Consulenza Societaria', oreDefault: 4, prezzoDefault: 1000 },
    ],
    passaggiTemplate: [
      { id: 'pt-1', articoloId: 'art-1', titolo: 'Bozza Atto', ordine: 1, chi: 'operatore', tipo: 'documento' },
    ],
    moduliTemplate: [
      { id: 'tpl-1', tenantId: TENANT_ORIGINALE, nome: 'Costituzione Holding', categoria: 'Societario', versione: 1 },
    ],
    righeDistinta: [
      { id: 'rd-1', tenantId: TENANT_ORIGINALE, moduloTemplateId: 'tpl-1', articoloId: 'art-1', quantita: 1, ordine: 1 },
    ],
    clienti: [
      { id: 'cli-1', tenantId: TENANT_ORIGINALE, denominazione: 'Beta S.r.l.', codiceFiscale: '12345678901' },
    ],
    progetti: [
      { id: 'prj-1', tenantId: TENANT_ORIGINALE, clienteId: 'cli-1', nome: 'Operazione Beta 2026', stato: 'in_progress' },
    ],
    moduli: [
      { id: 'mod-1', tenantId: TENANT_ORIGINALE, progettoId: 'prj-1', moduloTemplateId: 'tpl-1', nome: 'Costituzione Holding', stato: 'pending' },
    ],
    microvoci: [
      { id: 'mv-1', tenantId: TENANT_ORIGINALE, moduloProgettoId: 'mod-1', articoloId: 'art-1', nome: 'Consulenza Societaria', stato: 'pending', ordine: 1 },
    ],
    passaggi: [
      { id: 'p-1', tenantId: TENANT_ORIGINALE, microvoceProgettoId: 'mv-1', titolo: 'Bozza Atto', stato: 'pending', chi: 'operatore', tipo: 'documento', ordine: 1 },
    ],
    fatture: [
      { id: 'fat-1', tenantId: TENANT_ORIGINALE, clienteId: 'cli-1', numero: 'FT-2026/001', totaleDocumentoCentesimi: 122000 },
    ],
  };

  beforeEach(() => {
    chiamateUpsert = {};
    const registraUpsert = (modello: string) => async (args: any) => {
      if (!chiamateUpsert[modello]) chiamateUpsert[modello] = [];
      chiamateUpsert[modello].push(args);
      return args.create;
    };

    fakePrisma = {
      tenant: { upsert: vi.fn(registraUpsert('tenant')) },
      user: { upsert: vi.fn(registraUpsert('user')) },
      giurisdizione: { upsert: vi.fn(registraUpsert('giurisdizione')) },
      articolo: { upsert: vi.fn(registraUpsert('articolo')) },
      passaggioTemplate: { upsert: vi.fn(registraUpsert('passaggioTemplate')) },
      moduloTemplate: { upsert: vi.fn(registraUpsert('moduloTemplate')) },
      rigaDistinta: { upsert: vi.fn(registraUpsert('rigaDistinta')) },
      cliente: { upsert: vi.fn(registraUpsert('cliente')) },
      progetto: { upsert: vi.fn(registraUpsert('progetto')) },
      moduloProgetto: { upsert: vi.fn(registraUpsert('moduloProgetto')) },
      microvoceProgetto: { upsert: vi.fn(registraUpsert('microvoceProgetto')) },
      passaggioProgetto: { upsert: vi.fn(registraUpsert('passaggioProgetto')) },
      fattura: { upsert: vi.fn(registraUpsert('fattura')) },
    };
  });

  describe('Validazione Struttura', () => {
    it('rifiuta payload nulli o privi di metadati', async () => {
      const v1 = await validaStrutturaBackup(null);
      expect(v1.valido).toBe(false);
      expect(v1.errore).toContain('non valido o vuoto');

      const v2 = await validaStrutturaBackup({});
      expect(v2.valido).toBe(false);
      expect(v2.errore).toContain('privi di tenantId');

      const v3 = await validaStrutturaBackup({ metadata: {} });
      expect(v3.valido).toBe(false);

      const v4 = await validaStrutturaBackup(backupValido);
      expect(v4.valido).toBe(true);
    });
  });

  describe('Modalità Dry-Run', () => {
    it('calcola tutti i conteggi senza effettuare scritture nel database', async () => {
      const res = await eseguiRestoreBackup(backupValido, { dryRun: true }, fakePrisma);

      expect(res.ok).toBe(true);
      expect(res.dryRun).toBe(true);
      expect(res.tenantId).toBe(TENANT_ORIGINALE);
      expect(res.conteggi.tenants).toBe(1);
      expect(res.conteggi.utenti).toBe(1);
      expect(res.conteggi.clienti).toBe(1);
      expect(res.conteggi.progetti).toBe(1);
      expect(res.conteggi.moduli).toBe(1);
      expect(res.conteggi.microvoci).toBe(1);
      expect(res.conteggi.passaggi).toBe(1);
      expect(res.conteggi.fatture).toBe(1);

      // Nessuna chiamata upsert effettuata
      expect(Object.keys(chiamateUpsert)).toHaveLength(0);
      expect(fakePrisma.tenant.upsert).not.toHaveBeenCalled();
      expect(fakePrisma.cliente.upsert).not.toHaveBeenCalled();
    });
  });

  describe('Ripristino e Integrità Referenziale', () => {
    it('esegue gli upsert nell\'ordine referenziale corretto', async () => {
      const res = await eseguiRestoreBackup(backupValido, { dryRun: false }, fakePrisma);

      expect(res.ok).toBe(true);
      expect(res.dryRun).toBe(false);
      expect(res.errori).toHaveLength(0);

      // Verifichiamo che tutte le tabelle abbiano ricevuto le chiamate
      expect(fakePrisma.tenant.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.user.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.giurisdizione.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.articolo.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.passaggioTemplate.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.moduloTemplate.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.rigaDistinta.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.cliente.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.progetto.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.moduloProgetto.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.microvoceProgetto.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.passaggioProgetto.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.fattura.upsert).toHaveBeenCalledTimes(1);
    });

    it('supporta la rimappatura del tenant su un ambiente target/staging', async () => {
      const res = await eseguiRestoreBackup(
        backupValido,
        { dryRun: false, targetTenantId: TENANT_STAGING },
        fakePrisma,
      );

      expect(res.ok).toBe(true);
      expect(res.tenantId).toBe(TENANT_STAGING);

      // Verifichiamo che gli id e le foreign key tenant siano stati rimappati al target
      const userUpsert = chiamateUpsert['user']?.[0];
      expect(userUpsert.create.tenantId).toBe(TENANT_STAGING);

      const clienteUpsert = chiamateUpsert['cliente']?.[0];
      expect(clienteUpsert.create.tenantId).toBe(TENANT_STAGING);

      const progettoUpsert = chiamateUpsert['progetto']?.[0];
      expect(progettoUpsert.create.tenantId).toBe(TENANT_STAGING);
    });

    it('raccoglie gli errori e non interrompe il ripristino globale se un record fallisce', async () => {
      // Simuliamo un errore sull'articolo
      fakePrisma.articolo.upsert.mockRejectedValueOnce(new Error('Violazione unique constraint codice'));

      const res = await eseguiRestoreBackup(backupValido, { dryRun: false }, fakePrisma);

      expect(res.ok).toBe(false);
      expect(res.errori).toHaveLength(1);
      expect(res.errori[0]).toContain('Violazione unique constraint codice');

      // Le altre tabelle successive (es. cliente e progetto) devono comunque essere state ripristinate
      expect(fakePrisma.cliente.upsert).toHaveBeenCalledTimes(1);
      expect(fakePrisma.progetto.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
