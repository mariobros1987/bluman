// F1 — la redditività non inventa valore né tariffe.
// - Il valore del progetto ripiegava su 38.000 €: ora è «valore non impostato» e il margine non si calcola.
// - Il costo orario veniva da una tabella di cinque nomi con `|| 95`: ora dall'utente dello studio;
//   chi non ha un costo orario tiene le sue ore visibili, il costo è «non configurato» e il
//   margine si dichiara parziale.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { TeamMember } from '../../types';

const stato = vi.hoisted(() => ({ team: [] as TeamMember[] }));
vi.mock('../../hooks/useTeamMembers', () => ({
  useTeamMembers: () => ({ team: stato.team, loading: false, reload: vi.fn() }),
}));

import { RedditivitaTab } from './RedditivitaTab';

const ANNA = { id: 11, dbId: 'aaaaaaaa-0000-4000-8000-000000000001', n: 'Anna Neri', r: 'advisor', i: 'AN', c: '', costoOrarioCentesimi: 5000 };
const LUCA = { id: 22, dbId: 'aaaaaaaa-0000-4000-8000-000000000002', n: 'Luca Blu', r: 'collaboratore', i: 'LB', c: '', costoOrarioCentesimi: null };

function progetto(extra: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    n: 'Pratica Rossi',
    cl: 'Rossi Spa',
    val: 1000,
    mods: [
      {
        id: 1, n: 'Modulo A', cat: 'societario', st: 'in_progress', pct: 50, h: 10, a: 6, p: 1000, team: [11],
        v: [
          { n: 'Parere', s: 'done', hE: 5, hA: 4, as: 11 },
          { n: 'Atto', s: 'done', hE: 5, hA: 2, risorsaId: LUCA.dbId },
        ],
      },
    ],
    ...extra,
  } as any;
}

beforeEach(() => {
  stato.team = [ANNA, LUCA];
});

describe('F1 — RedditivitaTab', () => {
  it('progetto senza valore → «valore non impostato», margine non calcolato', () => {
    render(<RedditivitaTab project={progetto({ val: 0 })} />);
    expect(screen.getByText('valore non impostato')).toBeInTheDocument();
    expect(screen.getByText('margine non calcolato')).toBeInTheDocument();
    expect(screen.queryByText(/38\.000/)).not.toBeInTheDocument();
  });

  it('costo orario dagli utenti dello studio; chi non lo ha resta con le ore e il margine è parziale', () => {
    render(<RedditivitaTab project={progetto()} />);

    const rigaAnna = screen.getByText(/Anna Neri/).closest('tr')!;
    expect(within(rigaAnna).getByText('4.0 h')).toBeInTheDocument();
    expect(within(rigaAnna).getByText('€ 200.00')).toBeInTheDocument();

    const rigaLuca = screen.getByText(/Luca Blu/).closest('tr')!;
    expect(within(rigaLuca).getByText('2.0 h')).toBeInTheDocument();
    expect(within(rigaLuca).getByText('non configurato')).toBeInTheDocument();

    expect(screen.getByText(/Margine parziale: 2\.0 h senza costo orario/)).toBeInTheDocument();
    // Nessuno dei cinque nomi della vecchia tabella cablata.
    expect(screen.queryByText(/Disabato|Marino|Russo|Dibenedetto/)).not.toBeInTheDocument();
  });
});
