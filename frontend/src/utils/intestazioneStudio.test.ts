import { describe, it, expect } from 'vitest';
import { intestazioneStudioHtml, piedeStudioHtml } from './intestazioneStudio';

/**
 * 3.18 — L'intestazione e il piè di pagina finiscono nel PDF, nel .doc e nel documento salvato.
 * Senza ragione sociale stampavano «Studio Professionale» (e «STUDIO PROFESSIONALE» al posto del
 * logo): un nome mai scelto, su un atto che il cliente riceve. Ora il segnaposto di 3.13.
 */
const MANCANTE = '[DATO MANCANTE: ragione sociale dello studio]';
const studio = { ragioneSociale: '', sedeLegale: '', piva: '', telefono: '', logo: '' };

describe('intestazioneStudioHtml — ragione sociale mancante', () => {
  it('al posto del logo e nei recapiti compare il segnaposto, non un nome', () => {
    const html = intestazioneStudioHtml(studio);
    expect(html).not.toMatch(/studio professionale/i);
    expect(html).toContain(`🏛 ${MANCANTE}</div>`);
    expect(html).toContain(`<strong style="color: #1e1b4b;">${MANCANTE}</strong>`);
  });

  it('con la ragione sociale stampa quella', () => {
    const html = intestazioneStudioHtml({ ...studio, ragioneSociale: 'Studio Rossi' });
    expect(html).toContain('STUDIO ROSSI');
    expect(html).toContain('<strong style="color: #1e1b4b;">Studio Rossi</strong>');
  });
});

describe('piedeStudioHtml — ragione sociale mancante', () => {
  it('stampa il segnaposto, non «Studio Professionale»', () => {
    const html = piedeStudioHtml({ ragioneSociale: '  ', pratica: 'Pratica X', livelloFirma: 'ses' });
    expect(html).not.toMatch(/studio professionale/i);
    expect(html).toContain(`${MANCANTE} • Pratica: Pratica X`);
  });
});
