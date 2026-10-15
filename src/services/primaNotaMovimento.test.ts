// Il servizio che tiene insieme movimento e saldo: la coppia che sei percorsi su dieci scrivevano
// per metà. Qui si prova la coppia in sé — che il saldo si muova **sempre** insieme al movimento,
// sul conto che il movimento nomina, con il segno del tipo — perché è questa la garanzia che i
// percorsi ereditano passando di qui.
import { describe, it, expect, vi } from 'vitest';
import { creaMovimentoConSaldo, eliminaMovimentoEStornaSaldo } from './primaNotaMovimento.js';

/** Un finto client che registra l'ordine delle chiamate: l'ordine è parte del comportamento. */
function clientFinto() {
  const eventi: string[] = [];
  const client = {
    movimentoPrimaNota: {
      create: vi.fn(async (args: any) => {
        eventi.push(`create:${args.data.contoBancarioId ?? 'nessuno'}`);
        return { id: 'mv-1', ...args.data };
      }),
      delete: vi.fn(async (args: any) => {
        eventi.push(`delete:${args.where.id}`);
        return {};
      }),
    },
    contoBancario: {
      update: vi.fn(async (args: any) => {
        eventi.push(`saldo:${args.where.id}:${args.data.saldoAttuale.increment}`);
        return {};
      }),
    },
  };
  return { client, eventi };
}

const dati = (over: any = {}) => ({
  tenantId: 't-1',
  contoBancarioId: 'c-1',
  tipo: 'entrata' as const,
  categoria: 'incasso_fattura' as const,
  descrizione: 'Incasso rata',
  importoCentesimi: 122000,
  ...over,
});

describe('creaMovimentoConSaldo', () => {
  it('crea il movimento e muove il saldo dello stesso conto', async () => {
    const { client, eventi } = clientFinto();

    const movimento = await creaMovimentoConSaldo(client, { data: dati() });

    expect(movimento).toMatchObject({ id: 'mv-1', contoBancarioId: 'c-1' });
    expect(eventi).toEqual(['create:c-1', 'saldo:c-1:122000']);
  });

  it('un\'uscita toglie dal saldo quello che il movimento toglie dal conto', async () => {
    const { client, eventi } = clientFinto();

    await creaMovimentoConSaldo(client, { data: dati({ tipo: 'uscita', importoCentesimi: 22000 }) });

    expect(eventi).toEqual(['create:c-1', 'saldo:c-1:-22000']);
  });

  it('un movimento senza conto non muove nessun saldo', async () => {
    // Non è una dimenticanza da coprire con il conto predefinito: è la regola. Il denaro non
    // attribuito resta fuori da ogni conto invece di comparire in una banca che la riga non nomina.
    const { client, eventi } = clientFinto();

    await creaMovimentoConSaldo(client, { data: dati({ contoBancarioId: null }) });

    expect(eventi).toEqual(['create:nessuno']);
    expect(client.contoBancario.update).not.toHaveBeenCalled();
  });

  it('passa le relazioni richieste, perché la rotta risponde col movimento completo', async () => {
    const { client } = clientFinto();

    await creaMovimentoConSaldo(client, {
      data: dati(),
      include: { contoBancario: true, cliente: true, fornitore: true },
    });

    expect(client.movimentoPrimaNota.create).toHaveBeenCalledWith({
      data: dati(),
      include: { contoBancario: true, cliente: true, fornitore: true },
    });
  });
});

describe('eliminaMovimentoEStornaSaldo', () => {
  const movimento = {
    id: 'mv-1',
    contoBancarioId: 'c-1',
    tipo: 'entrata' as const,
    importoCentesimi: 122000,
  };

  it('storna il saldo e poi cancella la riga', async () => {
    // L'ordine è deliberato: se il processo muore in mezzo, resta un saldo più basso con il
    // movimento ancora in elenco, e il movimento è la verità — la lettura dei conti lo rimette a
    // posto. Nell'ordine inverso resterebbe denaro che nessuna riga giustifica.
    const { client, eventi } = clientFinto();

    await eliminaMovimentoEStornaSaldo(client, movimento);

    expect(eventi).toEqual(['saldo:c-1:-122000', 'delete:mv-1']);
  });

  it('cancellare un\'uscita restituisce al conto quello che ne era uscito', async () => {
    const { client, eventi } = clientFinto();

    await eliminaMovimentoEStornaSaldo(client, {
      ...movimento,
      tipo: 'uscita',
      importoCentesimi: 22000,
    });

    expect(eventi).toEqual(['saldo:c-1:22000', 'delete:mv-1']);
  });

  it('cancellare un movimento senza conto non tocca alcun saldo', async () => {
    const { client, eventi } = clientFinto();

    await eliminaMovimentoEStornaSaldo(client, { ...movimento, contoBancarioId: null });

    expect(eventi).toEqual(['delete:mv-1']);
  });
});
