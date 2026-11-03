import { describe, it, expect } from 'vitest';
import { getTemplateForVoce, resolveDocumentTemplateHtml, PREBUILT_TEMPLATES } from './documentTemplates';
import { avvisoCampiMancanti } from '../api/documenti';

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

// 3.6 — un dato assente nell'anteprima è un segnaposto evidente, non un'etichetta verosimile.
describe('resolveDocumentTemplateHtml — dati mancanti', () => {
  it('cliente senza legale rappresentante né UBO → segnaposto, non «Legale Rappresentante»', () => {
    const html = resolveDocumentTemplateHtml('<p>{{cliente.referente}} / {{cliente.ubo}}</p>', {
      cliente: { nome: 'Ditta Verdi' },
      progetto: { nome: 'Pratica' },
      studio: { ragioneSociale: 'Studio' },
    });
    expect(html).toContain('[DATO MANCANTE: legale rappresentante del cliente]');
    expect(html).toContain('[DATO MANCANTE: titolare effettivo (UBO) del cliente]');
    expect(html).not.toContain('Legale Rappresentante');
    expect(html).not.toContain('Titolare Effettivo');
  });

  it('progetto senza titolo né valore → segnaposti; valore 0 resta un dato', () => {
    const senza = resolveDocumentTemplateHtml('{{progetto.titolo}} {{progetto.importo_totale}}', { cliente: { nome: 'X' }, progetto: {} });
    expect(senza).toContain('[DATO MANCANTE: titolo del progetto]');
    expect(senza).toContain('[DATO MANCANTE: valore del progetto]');
    const zero = resolveDocumentTemplateHtml('{{progetto.importo_totale}}', { cliente: { nome: 'X' }, progetto: { nome: 'P', val: 0 } });
    expect(zero).toContain('€ 0,00');
  });

  it('importo con decimali: due cifre e nessun «,00» in coda al numero già formattato (3.15)', () => {
    const html = resolveDocumentTemplateHtml('{{progetto.importo_totale}}', { cliente: { nome: 'X' }, progetto: { nome: 'P', totalePreventivo: 1234.5 } });
    expect(html).toContain('€ 1.234,50');
    expect(html).not.toContain(',5,00');
  });
});

describe('avvisoCampiMancanti', () => {
  it('elenca i campi mancanti dopo la generazione, vuoto se non manca nulla', () => {
    expect(avvisoCampiMancanti(['legale rappresentante del cliente', 'valore del progetto'])).toBe(
      ' Mancano: legale rappresentante del cliente, valore del progetto.',
    );
    expect(avvisoCampiMancanti([])).toBe('');
  });
});

// 3.18 — nella lettera d'incarico il titolo del rappresentante dello studio era scritto a mano
// («(Senior Partner Advisory)»): un ruolo inventato accanto al nome vero del lead advisor.
describe('modello lettera d\'incarico — nessun titolo scritto a mano', () => {
  it('«rappresentato da» porta solo il lead advisor dello studio', () => {
    const lettera = PREBUILT_TEMPLATES.find((t) => t.id === 'tmpl-engagement');
    expect(lettera?.contenutoHtml).toContain('rappresentato da {{studio.lead_advisor}}.');
    expect(PREBUILT_TEMPLATES.some((t) => t.contenutoHtml.includes('Senior Partner Advisory'))).toBe(false);
  });
});
