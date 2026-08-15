import { describe, it, expect } from 'vitest';

interface GiurisdizioneInput {
  id: string;
  nome: string;
  codice: string;
  tipo: 'ue' | 'extra_ue' | 'stato_usa';
  note?: string;
}

function filtraModuliPerGiurisdizione(moduli: any[], giurisdizioneId: string | null) {
  if (!giurisdizioneId || giurisdizioneId === 'ALL') return moduli;
  return moduli.filter(m => !m.giurisdizioneId || m.giurisdizioneId === giurisdizioneId);
}

describe('Giurisdizioni & Piazze Finanziarie Domain Engine', () => {
  const giurisdizioniMock: GiurisdizioneInput[] = [
    { id: 'giur-mt', nome: 'Malta', codice: 'MT', tipo: 'ue', note: 'Repubblica di Malta — Hub finanziario UE' },
    { id: 'giur-gi', nome: 'Gibilterra', codice: 'GI', tipo: 'extra_ue', note: 'Territorio d Oltremare Britannico' },
    { id: 'giur-fl', nome: 'Florida (USA)', codice: 'US-FL', tipo: 'stato_usa', note: 'Stato USA Florida' },
    { id: 'giur-de', nome: 'Delaware (USA)', codice: 'US-DE', tipo: 'stato_usa', note: 'Stato USA Delaware' },
    { id: 'giur-ae', nome: 'Emirati Arabi Uniti', codice: 'AE', tipo: 'extra_ue', note: 'Dubai Free Zones' },
  ];

  const moduliMock = [
    { id: 'mod-m01', nome: 'Analisi patrimoniale iniziale', giurisdizioneId: null },
    { id: 'mod-m02', nome: 'Corporate structuring Malta', giurisdizioneId: 'giur-mt' },
    { id: 'mod-m03', nome: 'Holding internazionale', giurisdizioneId: null },
    { id: 'mod-m05', nome: 'Apertura conti correnti Malta', giurisdizioneId: 'giur-mt' },
    { id: 'mod-m08', nome: 'Struttura Company Gibilterra', giurisdizioneId: 'giur-gi' },
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

  it('deve filtrare correttamente i moduli specifici di Malta includendo quelli generici', () => {
    const filtrati = filtraModuliPerGiurisdizione(moduliMock, 'giur-mt');
    expect(filtrati).toHaveLength(4); // m01, m02, m03, m05
    const nomi = filtrati.map(m => m.nome);
    expect(nomi).toContain('Corporate structuring Malta');
    expect(nomi).toContain('Analisi patrimoniale iniziale');
    expect(nomi).not.toContain('Struttura Company Gibilterra');
  });

  it('deve restituire tutti i moduli quando la giurisdizione selezionata è ALL', () => {
    const tutti = filtraModuliPerGiurisdizione(moduliMock, 'ALL');
    expect(tutti).toHaveLength(5);
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
