// Test del motore di dominio delle giurisdizioni — esercita la stessa funzione
// che serve `GET /moduli` (catalogo.ts), non una copia privata che col tempo
// racconterebbe un comportamento diverso da quello reale.
import { describe, it, expect } from 'vitest';
import type { Prisma } from '@prisma/client';
import { condizioneModuliPerGiurisdizione } from './giurisdizioni.js';

const TENANT = 'tenant-test';

interface GiurisdizioneInput {
  id: string;
  nome: string;
  codice: string;
  tipo: 'ue' | 'extra_ue' | 'stato_usa';
  note?: string;
}

interface ModuloTemplateMock {
  id: string;
  nome: string;
  tenantId: string;
  isAttivo: boolean;
  giurisdizioneId: string | null;
}

// Applica ai moduli mock la where prodotta da condizioneModuliPerGiurisdizione.
// Interpreta solo la forma semplice che quella funzione emette (campi diretti
// e OR in AND tra loro): non è una reimplementazione del filtro di dominio.
function selezionaModuli(
  moduli: ModuloTemplateMock[],
  where: Prisma.ModuloTemplateWhereInput,
): ModuloTemplateMock[] {
  const corrisponde = (m: ModuloTemplateMock, w: Prisma.ModuloTemplateWhereInput): boolean => {
    if (w.tenantId !== undefined && w.tenantId !== m.tenantId) return false;
    if (w.isAttivo !== undefined && w.isAttivo !== m.isAttivo) return false;
    const attesa = w.giurisdizioneId;
    if ((attesa === null || typeof attesa === 'string') && m.giurisdizioneId !== attesa) return false;
    if (w.OR && !w.OR.some(sub => corrisponde(m, sub))) return false;
    return true;
  };
  return moduli.filter(m => corrisponde(m, where));
}

describe('Giurisdizioni & Piazze Finanziarie Domain Engine', () => {
  const giurisdizioniMock: GiurisdizioneInput[] = [
    { id: 'giur-mt', nome: 'Malta', codice: 'MT', tipo: 'ue', note: 'Repubblica di Malta — Hub finanziario UE' },
    { id: 'giur-gi', nome: 'Gibilterra', codice: 'GI', tipo: 'extra_ue', note: 'Territorio d Oltremare Britannico' },
    { id: 'giur-fl', nome: 'Florida (USA)', codice: 'US-FL', tipo: 'stato_usa', note: 'Stato USA Florida' },
    { id: 'giur-de', nome: 'Delaware (USA)', codice: 'US-DE', tipo: 'stato_usa', note: 'Stato USA Delaware' },
    { id: 'giur-ae', nome: 'Emirati Arabi Uniti', codice: 'AE', tipo: 'extra_ue', note: 'Dubai Free Zones' },
  ];

  const moduliMock: ModuloTemplateMock[] = [
    { id: 'mod-m01', nome: 'Analisi patrimoniale iniziale', tenantId: TENANT, isAttivo: true, giurisdizioneId: null },
    { id: 'mod-m02', nome: 'Corporate structuring Malta', tenantId: TENANT, isAttivo: true, giurisdizioneId: 'giur-mt' },
    { id: 'mod-m03', nome: 'Holding internazionale', tenantId: TENANT, isAttivo: true, giurisdizioneId: null },
    { id: 'mod-m05', nome: 'Apertura conti correnti Malta', tenantId: TENANT, isAttivo: true, giurisdizioneId: 'giur-mt' },
    { id: 'mod-m08', nome: 'Struttura Company Gibilterra', tenantId: TENANT, isAttivo: true, giurisdizioneId: 'giur-gi' },
    // §30: si disattiva, non si elimina — non deve mai comparire nel catalogo
    { id: 'mod-m09', nome: 'Vecchio schema trust (disattivato)', tenantId: TENANT, isAttivo: false, giurisdizioneId: 'giur-mt' },
    // mai visibili: moduli di un altro tenant
    { id: 'mod-m10', nome: 'Modulo altro studio', tenantId: 'tenant-altro', isAttivo: true, giurisdizioneId: null },
  ];

  it('deve contenere esattamente le 5 giurisdizioni ufficiali dello studio', () => {
    expect(giurisdizioniMock).toHaveLength(5);
    const codici = giurisdizioniMock.map(g => g.codice);
    expect(codici).toContain('MT');
    expect(codici).toContain('GI');
    expect(codici).toContain('US-FL');
    expect(codici).toContain('US-DE');
    expect(codici).toContain('AE');
  });

  it('senza filtro restituisce tutti i moduli attivi del tenant', () => {
    const filtrati = selezionaModuli(moduliMock, condizioneModuliPerGiurisdizione(TENANT, undefined));
    expect(filtrati.map(m => m.id)).toEqual(['mod-m01', 'mod-m02', 'mod-m03', 'mod-m05', 'mod-m08']);
  });

  it('filtra i moduli di Malta includendo quelli generici ed escludendo le altre piazze', () => {
    const filtrati = selezionaModuli(moduliMock, condizioneModuliPerGiurisdizione(TENANT, 'giur-mt'));
    expect(filtrati).toHaveLength(4); // m01, m02, m03, m05
    const nomi = filtrati.map(m => m.nome);
    expect(nomi).toContain('Corporate structuring Malta');
    expect(nomi).toContain('Analisi patrimoniale iniziale');
    expect(nomi).not.toContain('Struttura Company Gibilterra');
  });

  it("la sentinella 'ALL' del frontend si comporta come assenza di filtro", () => {
    expect(condizioneModuliPerGiurisdizione(TENANT, 'ALL')).toEqual({ tenantId: TENANT, isAttivo: true });
    const filtrati = selezionaModuli(moduliMock, condizioneModuliPerGiurisdizione(TENANT, 'ALL'));
    expect(filtrati).toHaveLength(5);
  });

  it('non espone mai i moduli disattivati (§30) né quelli di altri tenant', () => {
    const perMalta = selezionaModuli(moduliMock, condizioneModuliPerGiurisdizione(TENANT, 'giur-mt'));
    const tutti = selezionaModuli(moduliMock, condizioneModuliPerGiurisdizione(TENANT, undefined));
    for (const filtrati of [perMalta, tutti]) {
      expect(filtrati.map(m => m.id)).not.toContain('mod-m09');
      expect(filtrati.map(m => m.id)).not.toContain('mod-m10');
    }
  });

  it('deve identificare correttamente i tipi UE, Extra-UE e Stato USA', () => {
    const malta = giurisdizioniMock.find(g => g.codice === 'MT');
    const gibilterra = giurisdizioniMock.find(g => g.codice === 'GI');
    const delaware = giurisdizioniMock.find(g => g.codice === 'US-DE');

    expect(malta?.tipo).toBe('ue');
    expect(gibilterra?.tipo).toBe('extra_ue');
    expect(delaware?.tipo).toBe('stato_usa');
  });
});
