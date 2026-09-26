/**
 * K9/§5.5 — presidio della cadenza formazione (regole pure §12). Nessun DB.
 */
import { describe, it, expect } from 'vitest';
import { prossimaFormazione, formazioneDovuta, motivoFormazione, MESI_CADENZA_FORMAZIONE_DEFAULT } from './formazioneKyc.js';

describe('K9 — formazioneKyc (regole pure §12)', () => {
  it('cadenza di default 12 mesi', () => {
    expect(MESI_CADENZA_FORMAZIONE_DEFAULT).toBe(12);
  });

  it('prossimaFormazione = ultima + cadenza; null se mai svolta', () => {
    expect(prossimaFormazione('2025-01-15T00:00:00Z')?.toISOString().slice(0, 10)).toBe('2026-01-15');
    expect(prossimaFormazione(null)).toBeNull();
  });

  it('dovuta se mai svolta o se passata la cadenza; non dovuta se recente', () => {
    const oggi = new Date('2026-06-01T00:00:00Z');
    expect(formazioneDovuta(null, oggi)).toBe(true);
    expect(formazioneDovuta('2025-01-01T00:00:00Z', oggi)).toBe(true); // >12 mesi
    expect(formazioneDovuta('2026-03-01T00:00:00Z', oggi)).toBe(false); // 3 mesi fa
  });

  it('motivoFormazione (regola 12): distingue «mai» da «cadenza superata», vuoto se non dovuta', () => {
    const oggi = new Date('2026-06-01T00:00:00Z');
    expect(motivoFormazione(null, oggi)).toContain('Nessuna formazione');
    expect(motivoFormazione('2025-01-01T00:00:00Z', oggi)).toContain('cadenza');
    expect(motivoFormazione('2026-03-01T00:00:00Z', oggi)).toBe('');
  });
});
