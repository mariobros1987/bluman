/**
 * Presidio del gate operativo KYC (K4, §8.1). Due condizioni con pesi diversi — il profilo
 * regolatorio dello studio è un **avviso**, la pratica del cliente è un **blocco** — e uno sblocco
 * motivato recente che vale solo per la seconda. Store finto, nessun DB.
 *
 * Il presidio esiste perché fino al 16/10/2026 la prima condizione **non era applicata**: la
 * «modalità bozza» era solo un'etichetta in Impostazioni, e le tre chiamanti del gate scrivevano
 * `.catch(() => ({ bloccato: false }))`. Uno studio senza profilo regolatorio poteva quindi approvare
 * fascicoli e fatturare; e un guasto di lettura apriva la stessa porta, in silenzio.
 *
 * Dal 17/10/2026 la prima condizione produce un avviso e non un blocco, per decisione del titolare:
 * applicarla come blocco fermava l'intera operatività di uno studio che non aveva ancora scelto il
 * profilo. Il blocco sulla pratica del cliente resta, e resta fail-closed.
 */
import { describe, it, expect } from 'vitest';
import {
  operativitaBloccataDaKyc,
  messaggioBloccoKyc,
  GIORNI_VALIDITA_OVERRIDE,
  type KycGateStore,
} from './kycGate.js';

const PROFILO = 'CSP_MFSA';

function store(
  fascicolo: { id: string; stato: string } | null,
  override: { createdAt: Date } | null = null,
  opts: {
    profilo?: string | null;
    rigaAssente?: boolean;
    letturaFallisce?: boolean;
    letturaProfiloFallisce?: boolean;
  } = {},
): KycGateStore {
  return {
    tenantComplianceSettings: {
      findUnique: async () => {
        if (opts.letturaFallisce || opts.letturaProfiloFallisce) throw new Error('lettura rifiutata');
        if (opts.rigaAssente) return null;
        return { regulatoryProfile: opts.profilo === undefined ? PROFILO : opts.profilo };
      },
    },
    fascicoloKyc: {
      findFirst: async () => {
        if (opts.letturaFallisce) throw new Error('lettura rifiutata');
        return fascicolo;
      },
    },
    overrideKyc: { findFirst: async () => override },
  };
}

describe('operativitaBloccataDaKyc — prima lo studio, poi il cliente', () => {
  it('nessun fascicolo → non blocca', async () => {
    expect(await operativitaBloccataDaKyc(store(null), 't', 'c')).toMatchObject({ bloccato: false });
  });
  it('pratica approvata → non blocca', async () => {
    expect(await operativitaBloccataDaKyc(store({ id: 'f', stato: 'approvato' }), 't', 'c')).toMatchObject({
      bloccato: false,
    });
  });
  it('pratica non approvata senza override → blocca, e dice perché', async () => {
    const r = await operativitaBloccataDaKyc(store({ id: 'f', stato: 'in_verifica' }), 't', 'c');
    expect(r).toMatchObject({
      bloccato: true,
      stato: 'in_verifica',
      sbloccatoDaOverride: false,
      motivo: 'kyc_non_approvato',
    });
  });
  it('override recente sblocca la pratica non approvata', async () => {
    const r = await operativitaBloccataDaKyc(store({ id: 'f', stato: 'sospeso' }, { createdAt: new Date() }), 't', 'c');
    expect(r).toMatchObject({ bloccato: false, sbloccatoDaOverride: true, motivo: null });
  });
  it('override scaduto (oltre la finestra) torna a bloccare', async () => {
    const vecchio = new Date(Date.now() - (GIORNI_VALIDITA_OVERRIDE + 1) * 86_400_000);
    const r = await operativitaBloccataDaKyc(store({ id: 'f', stato: 'sospeso' }, { createdAt: vecchio }), 't', 'c');
    expect(r).toMatchObject({ bloccato: true });
  });
});

describe('operativitaBloccataDaKyc — il profilo dello studio è un avviso, non un blocco', () => {
  it('senza profilo regolatorio non blocca, ma lo segnala', async () => {
    // Decisione del titolare (17/10/2026): uno studio che non ha ancora scelto il profilo non
    // resta fermo. L'audit lo chiamava «modalità bozza»; ora è un avviso visibile, non uno stop.
    const r = await operativitaBloccataDaKyc(store(null, null, { profilo: null }), 't', 'c');
    expect(r).toMatchObject({
      bloccato: false,
      motivo: null,
      avviso: 'profilo_regolatorio_mancante',
      stato: null,
    });
  });

  it('nemmeno una riga di impostazioni vale come profilo dichiarato', async () => {
    // «Non ho trovato le impostazioni» non è «lo studio ha dichiarato il profilo»: è la forma di
    // assenza di risposta che questo progetto non legge mai come assenza di impedimento. Qui però
    // l'impedimento prodotto è un avviso, non un blocco.
    const r = await operativitaBloccataDaKyc(store(null, null, { rigaAssente: true }), 't', 'c');
    expect(r).toMatchObject({ bloccato: false, avviso: 'profilo_regolatorio_mancante' });
  });

  it('con il profilo dichiarato non c\'è nessun avviso', async () => {
    const r = await operativitaBloccataDaKyc(store(null), 't', 'c');
    expect(r).toMatchObject({ bloccato: false, avviso: null });
  });

  it('senza profilo la pratica non approvata blocca lo stesso: è il cliente, non lo studio', async () => {
    const r = await operativitaBloccataDaKyc(store({ id: 'f', stato: 'in_verifica' }, null, { profilo: null }), 't', 'c');
    expect(r).toMatchObject({
      bloccato: true,
      motivo: 'kyc_non_approvato',
      stato: 'in_verifica',
      avviso: 'profilo_regolatorio_mancante',
    });
  });

  it('se la lettura del profilo fallisce avvisa, ma non blocca per questo', async () => {
    const r = await operativitaBloccataDaKyc(store(null, null, { letturaProfiloFallisce: true }), 't', 'c');
    expect(r).toMatchObject({ bloccato: false, motivo: null, avviso: 'profilo_non_verificabile' });
  });

  it('se non si riesce a leggere la pratica blocca invece di aprire', async () => {
    // Le tre chiamanti avevano `.catch(() => ({ bloccato: false }))`: un guasto del database
    // avrebbe emesso fatture per clienti mai verificati, senza un errore da nessuna parte.
    const r = await operativitaBloccataDaKyc(store(null, null, { letturaFallisce: true }), 't', 'c');
    expect(r).toMatchObject({ bloccato: true, motivo: 'verifica_impossibile', sbloccatoDaOverride: false });
  });
});

describe('messaggioBloccoKyc', () => {
  const esito = (over: Record<string, unknown>) =>
    ({ bloccato: true, stato: null, sbloccatoDaOverride: false, motivo: null, avviso: null, ...over }) as any;

  it('un guasto di lettura non si traveste da pratica non approvata', async () => {
    const m = messaggioBloccoKyc(esito({ motivo: 'verifica_impossibile' }), 'La fatturazione');
    expect(m).toContain('Riprova');
    expect(m).not.toContain('non approvata');
  });

  it('la pratica non approvata nomina lo stato e le due vie d\'uscita', async () => {
    const m = messaggioBloccoKyc(esito({ motivo: 'kyc_non_approvato', stato: 'in_verifica' }), 'La fatturazione');
    expect(m).toContain('in_verifica');
    expect(m).toContain('sblocco motivato');
  });
});
