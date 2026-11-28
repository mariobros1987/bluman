// Le frasi con cui la posta spiega un'attribuzione (regola 12): una per criterio, e nessuna che menta.
import { describe, it, expect } from 'vitest';
import { spiegaAttribuzione } from './postaTesti';

describe('spiegaAttribuzione', () => {
  it('dice con quale criterio il messaggio è finito sotto il cliente', () => {
    expect(spiegaAttribuzione({ clienteId: 'c', attribuzione: 'automatica', criterio: 'alias' })).toContain('indirizzo di inoltro');
    expect(spiegaAttribuzione({ clienteId: 'c', attribuzione: 'automatica', criterio: 'casella' })).toContain('casella collegata');
    expect(spiegaAttribuzione({ clienteId: 'c', attribuzione: 'automatica', criterio: 'destinatario' })).toContain('fra i destinatari');
    expect(spiegaAttribuzione({ clienteId: 'c', attribuzione: 'automatica', criterio: 'mittente' })).toContain('lo ha scritto');
    expect(spiegaAttribuzione({ clienteId: 'c', attribuzione: 'manuale', criterio: null })).toContain('a mano');
  });

  it('senza cliente riconosciuto dice perché è da smistare', () => {
    expect(spiegaAttribuzione({ clienteId: null, attribuzione: 'da_smistare', criterio: null })).toContain('Nessun cliente riconosciuto');
  });

  it('un cliente tolto dall’anagrafica non lascia scritto «attribuito»', () => {
    const frase = spiegaAttribuzione({ clienteId: null, attribuzione: 'automatica', criterio: 'casella' });
    expect(frase).toContain('non è più in anagrafica');
    expect(frase).not.toContain('Attribuito in automatico');
  });
});
