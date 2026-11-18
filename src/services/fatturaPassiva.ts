// Due regole del ciclo passivo che le rotte non devono riscrivere ognuna a modo suo:
// una fattura d'acquisto non si registra due volte, e il suo saldo è un'operazione sola.
import { creaMovimentoConSaldo } from './primaNotaMovimento.js';

export class FatturaPassivaGiaSaldata extends Error {
  constructor() {
    super('Fattura passiva già saldata');
  }
}

/**
 * La fattura già registrata con lo stesso fornitore, lo stesso numero e lo stesso anno, o null.
 * L'anno conta perché molti fornitori ripartono da 1 a gennaio: «12» del 2026 e «12» del 2027
 * sono due documenti. Maiuscole e spazi ai bordi no: «ft-12 » e «FT-12» sono lo stesso.
 */
export async function cercaDoppioneFatturaPassiva(
  client: any,
  dati: { tenantId: string; fornitoreId: string; numero: string; data: Date },
): Promise<{ id: string; numero: string; data: Date } | null> {
  const anno = dati.data.getUTCFullYear();
  return client.fatturaRicevuta.findFirst({
    where: {
      tenantId: dati.tenantId,
      fornitoreId: dati.fornitoreId,
      numero: { equals: dati.numero.trim(), mode: 'insensitive' },
      data: { gte: new Date(Date.UTC(anno, 0, 1)), lt: new Date(Date.UTC(anno + 1, 0, 1)) },
    },
    select: { id: true, numero: true, data: true },
  });
}

export function messaggioDoppione(numero: string, ragioneSociale: string, data: Date): string {
  return `La fattura n. ${numero} di ${ragioneSociale} è già registrata (data ${data.toISOString().slice(0, 10)}): non viene registrata una seconda volta.`;
}

/**
 * Salda la fattura e scrive l'uscita in Prima Nota. Va chiamata DENTRO una transazione: se il
 * movimento non si scrive, la fattura non resta «saldata» senza uscita. Il passaggio a saldata è
 * condizionato a `pagata: false`, così di due richieste contemporanee ne passa una sola.
 */
export async function saldaFatturaPassiva(
  tx: any,
  dati: {
    tenantId: string;
    fattura: { id: string; numero: string; fornitoreId: string; totaleCentesimi: number; fornitore: { ragioneSociale: string } };
    dataPagamento: Date;
    contoBancarioId?: string | null;
    metodoPagamento?: any;
    riferimentoTransazione?: string | null;
    note?: string | null;
  },
): Promise<{ id: string }> {
  const esito = await tx.fatturaRicevuta.updateMany({
    where: { id: dati.fattura.id, tenantId: dati.tenantId, pagata: false },
    data: { pagata: true, dataPagamento: dati.dataPagamento },
  });
  if (esito.count !== 1) throw new FatturaPassivaGiaSaldata();
  return creaMovimentoConSaldo(tx, {
    data: {
      tenantId: dati.tenantId,
      fatturaRicevutaId: dati.fattura.id,
      fornitoreId: dati.fattura.fornitoreId,
      contoBancarioId: dati.contoBancarioId || null,
      data: dati.dataPagamento,
      tipo: 'uscita',
      categoria: 'pagamento_fornitore',
      descrizione: `Saldo fattura passiva n. ${dati.fattura.numero} (${dati.fattura.fornitore.ragioneSociale})`,
      importoCentesimi: dati.fattura.totaleCentesimi,
      metodoPagamento: dati.metodoPagamento,
      riferimentoTransazione: dati.riferimentoTransazione,
      note: dati.note,
    },
  });
}
