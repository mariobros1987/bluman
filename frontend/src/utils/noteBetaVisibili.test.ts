// Chi vede il pulsante 📝 delle note e chi la raccolta: lo studio lo può spegnere dalle Impostazioni.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noteBetaVisibili, raccoltaNoteBetaVisibile } from './noteBetaVisibili';
import { getModuliDisattivati } from './tenant';

vi.mock('./tenant', () => ({ getModuliDisattivati: vi.fn(() => []) }));
const mockStandby = getModuliDisattivati as ReturnType<typeof vi.fn>;

beforeEach(() => mockStandby.mockReturnValue([]));

describe('note della beta — chi le vede', () => {
  it('il pulsante è di chi lavora nello studio, non del cliente del portale', () => {
    expect(noteBetaVisibili({ ruolo: 'advisor' })).toBe(true);
    expect(noteBetaVisibili({ ruolo: 'collaboratore_interno' })).toBe(true);
    expect(noteBetaVisibili({ ruolo: 'cliente' })).toBe(false);
    expect(noteBetaVisibili(null)).toBe(false);
  });

  it('la raccolta è di chi risponde dello studio', () => {
    expect(raccoltaNoteBetaVisibile({ ruolo: 'advisor' })).toBe(true);
    expect(raccoltaNoteBetaVisibile({ ruolo: 'super_admin' })).toBe(true);
    expect(raccoltaNoteBetaVisibile({ ruolo: 'collaboratore_interno' })).toBe(false);
  });

  it('messe in standby dalle Impostazioni, spariscono pulsante e raccolta', () => {
    mockStandby.mockReturnValue(['notebeta']);
    expect(noteBetaVisibili({ ruolo: 'advisor' })).toBe(false);
    expect(raccoltaNoteBetaVisibile({ ruolo: 'advisor' })).toBe(false);
  });
});
