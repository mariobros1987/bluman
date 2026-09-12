import { describe, expect, it } from 'vitest';
import { escapeHtmlTesto, sanitizzaHtmlDocumento } from './htmlSanitizer.js';

describe('sanitizzaHtmlDocumento', () => {
  it('preserva impaginazione documentale e marcatori ammessi', () => {
    const html = '<div data-bluman-blocco="intestazione" style="display:flex; color:#123"><table><tr><td colspan="2">Testo</td></tr></table></div>';
    const risultato = sanitizzaHtmlDocumento(html);
    expect(risultato).toContain('data-bluman-blocco="intestazione"');
    expect(risultato).toContain('style="display: flex; color: #123"');
    expect(risultato).toContain('<table><tr><td colspan="2">Testo</td></tr></table>');
  });

  it('rimuove tag attivi con il loro contenuto e attributi evento', () => {
    const risultato = sanitizzaHtmlDocumento(
      '<p onclick="alert(1)">ok</p><script>alert(2)</script><svg onload="alert(3)"><circle/></svg><iframe srcdoc="x"></iframe>',
    );
    expect(risultato).toBe('<p>ok</p>');
  });

  it('blocca URL e CSS offuscati pericolosi', () => {
    const risultato = sanitizzaHtmlDocumento(
      '<a href="java&#x73;cript:alert(1)" style="background:url(javascript:1);color:red">x</a><img src="data:text/html;base64,PHNjcmlwdD4=">',
    );
    expect(risultato).toContain('<a style="color: red" rel="noopener noreferrer">x</a>');
    expect(risultato).toContain('<img>');
    expect(risultato).not.toMatch(/javascript|data:text/i);
  });

  it('escapa i valori testuali dinamici', () => {
    expect(escapeHtmlTesto('<img src=x onerror=1>')).toBe('&lt;img src=x onerror=1&gt;');
  });
});
