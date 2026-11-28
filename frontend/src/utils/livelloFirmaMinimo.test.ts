// Titolare, 28/11/2026 — il livello del modello è il minimo. La pagina usa la regola del server.
import { describe, expect, it } from 'vitest';
import { sottoIlMinimo, spiegaMinimoFirma } from './livelloFirmaMinimo';

describe('livello di firma minimo del modello', () => {
  it('sotto il minimo solo i livelli più bassi', () => {
    expect(sottoIlMinimo('ses', 'fea')).toBe(true);
    expect(sottoIlMinimo('fea', 'fea')).toBe(false);
    expect(sottoIlMinimo('feq', 'fea')).toBe(false);
    expect(sottoIlMinimo('fea', 'feq')).toBe(true);
  });

  it('un minimo assente vale SES: niente è spento e non c’è niente da spiegare', () => {
    expect(sottoIlMinimo('ses', undefined)).toBe(false);
    expect(spiegaMinimoFirma(undefined)).toBeNull();
    expect(spiegaMinimoFirma('ses')).toBeNull();
  });

  it('la spiegazione nomina il livello del modello', () => {
    expect(spiegaMinimoFirma('feq')).toBe('Il modello richiede almeno la firma FEQ: il livello si può alzare, non abbassare.');
  });
});
