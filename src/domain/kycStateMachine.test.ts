/**
 * KYC K1 — presidio della macchina a stati (spec v0.2 §8). Difende le proprietà che contano:
 * si sale lungo il ciclo, `chiuso` è terminale, `sospeso` è sempre raggiungibile da uno stato
 * attivo, non si transita verso sé stessi, e il rischio alto esige l'MLRO per approvare.
 */
import { describe, it, expect } from 'vitest';
import {
  TRANSIZIONI_KYC,
  transizioneAmmessa,
  statoTerminale,
  richiedeApprovazioneMlro,
  type StatoKycV02,
} from './kycStateMachine.js';

describe('transizioneAmmessa', () => {
  it('segue il percorso nominale bozza→…→approvato', () => {
    expect(transizioneAmmessa('bozza', 'in_raccolta')).toBe(true);
    expect(transizioneAmmessa('in_raccolta', 'in_verifica')).toBe(true);
    expect(transizioneAmmessa('in_verifica', 'in_attesa_approvazione')).toBe(true);
    expect(transizioneAmmessa('in_attesa_approvazione', 'approvato')).toBe(true);
    expect(transizioneAmmessa('in_attesa_approvazione', 'respinto')).toBe(true);
  });
  it('rifiuta i salti non ammessi', () => {
    expect(transizioneAmmessa('bozza', 'approvato')).toBe(false);
    expect(transizioneAmmessa('in_raccolta', 'approvato')).toBe(false);
    expect(transizioneAmmessa('approvato', 'bozza')).toBe(false);
  });
  it('non ammette la transizione verso sé stessi', () => {
    (Object.keys(TRANSIZIONI_KYC) as StatoKycV02[]).forEach((s) => {
      expect(transizioneAmmessa(s, s)).toBe(false);
    });
  });
  it('sospeso è raggiungibile da ogni stato attivo (§8.6) e si riprende', () => {
    for (const s of ['in_raccolta', 'in_verifica', 'in_attesa_approvazione', 'approvato', 'in_revisione'] as StatoKycV02[]) {
      expect(transizioneAmmessa(s, 'sospeso')).toBe(true);
    }
    expect(transizioneAmmessa('sospeso', 'in_raccolta')).toBe(true);
    expect(transizioneAmmessa('sospeso', 'in_verifica')).toBe(true);
  });
  it('approvato si riapre in revisione periodica (§5.2)', () => {
    expect(transizioneAmmessa('approvato', 'in_revisione')).toBe(true);
    expect(transizioneAmmessa('in_revisione', 'approvato')).toBe(true);
  });
});

describe('statoTerminale', () => {
  it('chiuso è terminale, gli altri no', () => {
    expect(statoTerminale('chiuso')).toBe(true);
    expect(transizioneAmmessa('chiuso', 'in_raccolta')).toBe(false);
    expect(statoTerminale('approvato')).toBe(false);
    expect(statoTerminale('bozza')).toBe(false);
  });
});

describe('richiedeApprovazioneMlro (§8.3)', () => {
  it('approvare un rischio alto esige l’MLRO', () => {
    expect(richiedeApprovazioneMlro('approvato', 'alto')).toBe(true);
  });
  it('rischio medio/basso o transizioni diverse non lo esigono', () => {
    expect(richiedeApprovazioneMlro('approvato', 'medio')).toBe(false);
    expect(richiedeApprovazioneMlro('approvato', 'basso')).toBe(false);
    expect(richiedeApprovazioneMlro('respinto', 'alto')).toBe(false);
  });
});
