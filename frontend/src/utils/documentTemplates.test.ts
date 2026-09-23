import { describe, it, expect } from 'vitest';
import { getTemplateForVoce } from './documentTemplates';

// Aggancio dei modelli Malta «trasferimento residenza / guest» (modulo mod-r01) alle micro-voci.
// La proprietà che conta: queste tre voci risolvono ai modelli dedicati e NON cadono sulle regole
// generiche (contratto / compliance) che le catturerebbero con un modello sbagliato.
describe('getTemplateForVoce — modelli Malta guest', () => {
  it('«Accordo di ospitalità (posto letto)» → hospitality agreement IT', () => {
    expect(getTemplateForVoce('Accordo di ospitalità (posto letto)', 'Legale').id).toBe('tmpl-hospitality-agreement-it');
  });
  it('«Contratto di servizi al guest» → service agreement IT (non il generico «contratto»)', () => {
    expect(getTemplateForVoce('Contratto di servizi al guest', 'Legale').id).toBe('tmpl-service-agreement-it');
  });
  it('«Informativa privacy GDPR e consensi» → informativa GDPR IT (non la checklist KYC)', () => {
    const t = getTemplateForVoce('Informativa privacy GDPR e consensi', 'Compliance');
    expect(t.id).toBe('tmpl-gdpr-informativa-it');
    expect(t.id).not.toBe('tmpl-compliance');
  });
  it('le voci non-Malta continuano a usare le regole esistenti', () => {
    expect(getTemplateForVoce('Lettera di incarico', '').id).toBe('tmpl-engagement');
    expect(getTemplateForVoce('Accordo di riservatezza NDA', '').id).toBe('tmpl-nda');
  });
});
