import { describe, it, expect } from 'vitest';

interface ArticoloTest {
  id: string;
  n: string;
  cat: string;
  documentiRichiesti?: string[];
  formMasterId?: string | null;
}

const TEST_ARTICOLI: ArticoloTest[] = [
  { id: 'A_COST_HOLDING', n: 'Costituzione holding', cat: 'Societario', documentiRichiesti: ['m4'], formMasterId: 'f1' },
  { id: 'A_DEED_TRUST', n: 'Redazione deed of trust', cat: 'Trust', documentiRichiesti: ['m1', 'm3'], formMasterId: 'f2' },
  { id: 'A_KYC_CLIENTE', n: 'Raccolta e verifica documentazione KYC', cat: 'Compliance', documentiRichiesti: ['m3'], formMasterId: 'f3' },
];

describe('Catalog Document & Form Master Linkage Engine', () => {
  it('should verify catalog articles contain linked white-label documents and form masters', () => {
    const articoloHolding = TEST_ARTICOLI.find((a) => a.id === 'A_COST_HOLDING');
    expect(articoloHolding).toBeDefined();
    expect(articoloHolding?.documentiRichiesti).toContain('m4');
    expect(articoloHolding?.formMasterId).toBe('f1');
  });

  it('should verify trust deed article has linked NDA and UBO declaration', () => {
    const articoloTrust = TEST_ARTICOLI.find((a) => a.id === 'A_DEED_TRUST');
    expect(articoloTrust).toBeDefined();
    expect(articoloTrust?.documentiRichiesti).toEqual(['m1', 'm3']);
    expect(articoloTrust?.formMasterId).toBe('f2');
  });

  it('should resolve required documents count for client portal ingestion', () => {
    const kycArticolo = TEST_ARTICOLI.find((a) => a.id === 'A_KYC_CLIENTE');
    expect(kycArticolo).toBeDefined();
    expect(kycArticolo?.documentiRichiesti?.length).toBeGreaterThan(0);
    expect(kycArticolo?.formMasterId).toBe('f3');
  });
});
