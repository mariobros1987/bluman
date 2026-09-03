import { describe, it, expect } from 'vitest';

interface Task {
  n: string;
  hA: number; // Ore effettive consuntivate
  hE: number; // Ore stimate
  s: string;
  as?: string | number; // Assegnatario (User ID)
}

interface Modulo {
  n: string;
  v: Task[];
}

interface Progetto {
  id: string | number;
  nome: string;
  cl: string;
  val: number;
  pct: number;
  mods: Modulo[];
}

function calcolaPerformanceOperatore(operatorId: string | number, progetti: Progetto[]) {
  let totOreConsuntivate = 0;
  let totTasksUltimati = 0;
  let countProgettiAssegnati = 0;
  const logs: Array<{ progetto: string; cliente: string; task: string; ore: number; stato: string }> = [];

  progetti.forEach(p => {
    let haLavoratoSuProgetto = false;

    (p.mods || []).forEach(m => {
      (m.v || []).forEach(mv => {
        const isOwner = String(mv.as) === String(operatorId);
        const ore = mv.hA || 0;

        if (isOwner) {
          haLavoratoSuProgetto = true;
          totOreConsuntivate += ore;

          if (mv.s === 'done' || mv.s === 'completed') {
            totTasksUltimati++;
          }

          logs.push({
            progetto: p.nome,
            cliente: p.cl,
            task: mv.n,
            ore,
            stato: mv.s,
          });
        }
      });
    });

    if (haLavoratoSuProgetto) {
      countProgettiAssegnati++;
    }
  });

  return {
    totOreConsuntivate,
    totTasksUltimati,
    countProgettiAssegnati,
    logs,
  };
}

describe('Team Analytics & Operator Timesheet Engine', () => {
  const teamMembers = [
    { id: '11111111-1111-1111-1111-111111111111', nome: 'Joe Disabato', ruolo: 'super_admin' },
    { id: '33333333-3333-3333-3333-333333333333', nome: 'Elena Rossi', ruolo: 'collaboratore_interno' },
    { id: '44444444-4444-4444-4444-444444444444', nome: 'Francesca Disabato', ruolo: 'collaboratore_interno' },
  ];

  const mockProgetti: Progetto[] = [
    {
      id: 'prj-01',
      nome: 'Struttura Holding — Famiglia Ricci',
      cl: 'Marco Ricci',
      val: 38000,
      pct: 42,
      mods: [
        {
          n: 'Analisi Patrimoniale',
          v: [
            { n: 'Raccolta documentazione KYC', hA: 4, hE: 4, s: 'done', as: '44444444-4444-4444-4444-444444444444' }, // Francesca
            { n: 'Analisi asset patrimoniali', hA: 6, hE: 6, s: 'done', as: '33333333-3333-3333-3333-333333333333' },   // Elena
          ],
        },
      ],
    },
    {
      id: 'prj-02',
      nome: 'Belfort Industries S.A. — Licenza VASP',
      cl: 'Belfort S.A.',
      val: 45000,
      pct: 85,
      mods: [
        {
          n: 'Licenza Finanziaria MFSA',
          v: [
            { n: 'Istanza MFSA ed allegati', hA: 8.5, hE: 8.5, s: 'done', as: '44444444-4444-4444-4444-444444444444' }, // Francesca
          ],
        },
      ],
    },
  ];

  it('deve calcolare con precisione le ore totali ed il registro attività di Francesca Disabato', () => {
    const statsFrancesca = calcolaPerformanceOperatore('44444444-4444-4444-4444-444444444444', mockProgetti);

    expect(statsFrancesca.totOreConsuntivate).toBe(12.5); // 4h + 8.5h
    expect(statsFrancesca.totTasksUltimati).toBe(2);
    expect(statsFrancesca.countProgettiAssegnati).toBe(2);
    expect(statsFrancesca.logs).toHaveLength(2);
    expect(statsFrancesca.logs[0]?.task).toBe('Raccolta documentazione KYC');
    expect(statsFrancesca.logs[1]?.task).toBe('Istanza MFSA ed allegati');
  });

  it('deve calcolare separatamente le metriche dell operatore Elena Rossi', () => {
    const statsElena = calcolaPerformanceOperatore('33333333-3333-3333-3333-333333333333', mockProgetti);

    expect(statsElena.totOreConsuntivate).toBe(6);
    expect(statsElena.totTasksUltimati).toBe(1);
    expect(statsElena.countProgettiAssegnati).toBe(1);
    expect(statsElena.logs[0]?.task).toBe('Analisi asset patrimoniali');
  });

  it('deve includere tutti gli operatori censiti nel team', () => {
    expect(teamMembers).toHaveLength(3);
    const nomi = teamMembers.map(t => t.nome);
    expect(nomi).toContain('Francesca Disabato');
    expect(nomi).toContain('Joe Disabato');
    expect(nomi).toContain('Elena Rossi');
  });
});
