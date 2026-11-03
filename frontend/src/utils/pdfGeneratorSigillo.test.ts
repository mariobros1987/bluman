// A12 — il valore stampato accanto alla firma è un HMAC-SHA256 con la chiave del server
// (`sigilloHmac` in otpService.ts), non un'impronta SHA-256 che un terzo può ricalcolare dal
// documento. L'etichetta «SHA-256:» lasciava credere il contrario.
import { describe, it, expect, vi } from 'vitest';

const catturato = vi.hoisted(() => ({ html: [] as string[] }));
vi.mock('./pdfA4', () => ({
  creaPagineA4: (html: string) => { catturato.html.push(html); return []; },
}));

import { downloadRealPdf } from './pdfGenerator';

describe('pdfGenerator — il sigillo si chiama per quello che è', () => {
  it('la riga del sigillo dice «Sigillo HMAC-SHA256», non «SHA-256»', async () => {
    vi.useFakeTimers();
    const pronto = downloadRealPdf('doc', '<p>corpo</p>', [
      { signerName: 'Anna Verdi', signerRole: 'Cliente', timestamp: '2026-11-03 10:00', ipAddress: null, sha256Digest: 'f'.repeat(64) },
    ]);
    await vi.runAllTimersAsync();
    await pronto;
    vi.useRealTimers();

    const div = document.createElement('div');
    div.innerHTML = catturato.html[0] ?? '';
    const testo = div.textContent ?? '';
    expect(testo).toContain(`Sigillo HMAC-SHA256: ${'f'.repeat(64)}`);
    expect(testo).not.toMatch(/(^|[^-])SHA-256:/);
  });
});
