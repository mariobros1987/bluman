// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte del blocco «PRIMA NOTA INTEGRATA A DATABASE (ZERO LOCALSTORAGE)». Il
// parametro `app` resta in firma per uniformità con gli altri moduli rotte,
// anche se questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { CreaMovimentoPrimaNotaSchema } from '../schemas/contabilita.schema.js';
import { campoOrdinamento, creaMetaPaginazione, leggiPaginazione } from '../util/paginazione.js';

/**
 * L'importo di una riga di estratto conto, oppure `null` se quella riga non ne porta uno.
 *
 * Sostituisce `parseFloat(rawImporto) || 100.0`, che sbagliava in **due** modi opposti ed
 * entrambi silenziosi: un campo vuoto o illeggibile diventava un movimento da 100 €, e un
 * importo legittimo di `0` — che è falsy — diventava anche lui 100 €. Il primo è il difetto che
 * si nota; il secondo è quello che non si sarebbe mai notato.
 *
 * `parseFloat` non basta nemmeno corretto: su `12abc` restituisce `12`, cioè ricava un numero da
 * un campo che numero non è. Un importo si accetta solo se **tutto** il campo è un numero.
 *
 * Le due forme che convivono negli estratti conto sono `-1.234,56` (italiana) e `-1234.56`
 * (inglese), e si distinguono dal separatore decimale: è quello che compare per ultimo. Il caso
 * senza virgola e con più punti — `1.234.567` — sono migliaia, non decimali: leggerlo come
 * `1.234` sarebbe un movimento sbagliato di un fattore un milione, che è esattamente quello che
 * faceva il ripiego precedente.
 */
export function leggiImporto(grezzo: string | undefined): number | null {
  if (grezzo === undefined) return null;
  // Il simbolo di valuta e lo spazio unificatore (U+00A0) escono dagli home banking: `€ 1.234,56`
  // è un importo come gli altri.
  let p = grezzo.replace(/[€$\s ]/g, '').trim();
  if (!p) return null;

  const ultimaVirgola = p.lastIndexOf(',');
  const ultimoPunto = p.lastIndexOf('.');

  if (ultimaVirgola > -1 && ultimaVirgola > ultimoPunto) {
    // Forma italiana: i punti sono migliaia, la virgola è il decimale.
    p = p.replace(/\./g, '').replace(/,/g, '.');
  } else if (ultimaVirgola > -1) {
    // Virgola non decimale (`1,234.56`) o più virgole (`1,2,3`): la seconda viene rifiutata qui
    // sotto dalla forma, che è il comportamento giusto — un campo con due decimali non è un importo.
    p = p.replace(/,/g, '');
  } else if ((p.match(/\./g) ?? []).length > 1) {
    p = p.replace(/\./g, '');
  }

  return /^[+-]?\d+(?:\.\d+)?$/.test(p) ? Number(p) : null;
}

/**
 * La data di una riga, oppure `null` se non se ne riconosce la forma.
 *
 * `Date.parse` da solo non è innocuo: su `15/10/2026` — la forma di **tutti** gli estratti conto
 * italiani — restituisce `NaN`, quindi il ripiego `: new Date()` datava ogni riga *oggi*. Un
 * movimento di settembre che entra in Prima Nota con la data di oggi non è un difetto di
 * presentazione: sbaglia l'ordine cronologico e il periodo della liquidazione IVA, e non lo dice
 * a nessuno.
 *
 * Si riconoscono due forme: ISO (`2026-10-15`, con l'ora eventualmente attaccata) e italiana
 * (`15/10/2026`, `15-10-2026`, `15.10.2026`). Una data che non si riconosce **non** diventa oggi:
 * scarta la riga, come un importo illeggibile.
 */
export function leggiData(grezzo: string | undefined): Date | null {
  if (!grezzo) return null;
  // L'ora si toglie: in Prima Nota conta il giorno, e gli export bancari la attaccano al campo.
  const s = grezzo.trim().replace(/[T ]\d{1,2}:\d{2}(?::\d{2})?.*$/, '');

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return dataEsatta(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const italiana = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (italiana) return dataEsatta(Number(italiana[3]), Number(italiana[2]), Number(italiana[1]));

  return null;
}

/**
 * Una data che esiste davvero, o `null`.
 *
 * `new Date(Date.UTC(2026, 1, 31))` non fallisce: rotola al 3 marzo. Una data così in un estratto
 * conto vuol dire che si è letto il campo sbagliato, e accettarla inventerebbe un movimento in un
 * giorno plausibile ma falso — la stessa classe di guasto dell'importo. Si accetta solo se i tre
 * numeri tornano indietro identici.
 */
function dataEsatta(anno: number, mese: number, giorno: number): Date | null {
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  const torna =
    d.getUTCFullYear() === anno && d.getUTCMonth() === mese - 1 && d.getUTCDate() === giorno;
  return torna ? d : null;
}

export async function registraRotteContabilitaPrimaNota(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── PRIMA NOTA INTEGRATA A DATABASE (ZERO LOCALSTORAGE) ───────────
  server.get('/prima-nota', async (req, reply) => {
    const tenantId = req.tenantId;
    const paginazione = leggiPaginazione(req.query);
    if (paginazione.paginata && 'errore' in paginazione) {
      return reply.code(400).send({ errore: paginazione.errore });
    }

    try {
      const include = {
        contoBancario: true,
        fattura: { include: { cliente: true, progetto: true } },
        cliente: true,
        fornitore: true,
      };
      if (!paginazione.paginata) {
        const movimenti = await prisma.movimentoPrimaNota.findMany({
          where: { tenantId },
          include,
          orderBy: { data: 'desc' },
        });
        return reply.send(movimenti);
      }

      const { page, limit, search, sortBy, sortOrder, tipo, metodo, skip } = paginazione.parametri;
      const campo = campoOrdinamento(sortBy, ['data', 'importoCentesimi', 'descrizione', 'createdAt'] as const, 'data');
      if (!campo) return reply.code(400).send({ errore: 'Campo di ordinamento Prima Nota non valido' });
      const tipiConsentiti = ['entrata', 'uscita'] as const;
      const metodiConsentiti = ['bonifico', 'carta', 'assegno', 'contanti', 'stripe'] as const;
      if (tipo && !tipiConsentiti.includes(tipo as typeof tipiConsentiti[number])) {
        return reply.code(400).send({ errore: 'Tipo movimento non valido' });
      }
      if (metodo && !metodiConsentiti.includes(metodo as typeof metodiConsentiti[number])) {
        return reply.code(400).send({ errore: 'Metodo di pagamento non valido' });
      }
      const where = {
        tenantId,
        ...(tipo ? { tipo: tipo as typeof tipiConsentiti[number] } : {}),
        ...(metodo ? { metodoPagamento: metodo as typeof metodiConsentiti[number] } : {}),
        ...(search ? {
          OR: [
            { descrizione: { contains: search, mode: 'insensitive' as const } },
            { riferimentoTransazione: { contains: search, mode: 'insensitive' as const } },
            { cliente: { nome: { contains: search, mode: 'insensitive' as const } } },
          ],
        } : {}),
      };
      const [movimenti, totale, entrate, uscite] = await Promise.all([
        prisma.movimentoPrimaNota.findMany({ where, include, skip, take: limit, orderBy: { [campo]: sortOrder } }),
        prisma.movimentoPrimaNota.count({ where }),
        prisma.movimentoPrimaNota.aggregate({ where: { ...where, tipo: 'entrata' }, _sum: { importoCentesimi: true } }),
        prisma.movimentoPrimaNota.aggregate({ where: { ...where, tipo: 'uscita' }, _sum: { importoCentesimi: true } }),
      ]);
      const totaleEntrateCentesimi = entrate._sum.importoCentesimi ?? 0;
      const totaleUsciteCentesimi = uscite._sum.importoCentesimi ?? 0;
      return reply.send({
        data: movimenti,
        meta: creaMetaPaginazione(page, limit, totale),
        riepilogo: {
          totaleEntrateCentesimi,
          totaleUsciteCentesimi,
          saldoCentesimi: totaleEntrateCentesimi - totaleUsciteCentesimi,
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura Prima Nota' });
    }
  });

  server.post<{
    Body: {
      contoBancarioId?: string;
      clienteId?: string;
      fornitoreId?: string;
      fatturaId?: string;
      tipo: 'entrata' | 'uscita';
      categoria?: 'incasso_fattura' | 'pagamento_fornitore' | 'imposta_tasse' | 'stipendi_compensi' | 'spese_generali' | 'giroconto' | 'altro';
      descrizione: string;
      importoCentesimi: number;
      metodoPagamento?: 'bonifico' | 'carta' | 'assegno' | 'contanti' | 'stripe';
      riferimentoTransazione?: string;
      note?: string;
      data?: string;
    };
  }>('/prima-nota', async (req, reply) => {
    const tenantId = req.tenantId;
    const parseResult = CreaMovimentoPrimaNotaSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Descrizione e importo maggiori di 0 sono obbligatori' });
    }
    const body = parseResult.data;

    try {
      const movimento = await prisma.movimentoPrimaNota.create({
        data: {
          tenantId,
          contoBancarioId: body.contoBancarioId || null,
          clienteId: body.clienteId || null,
          fornitoreId: body.fornitoreId || null,
          fatturaId: body.fatturaId || null,
          tipo: body.tipo,
          categoria: body.categoria || 'altro',
          descrizione: body.descrizione,
          importoCentesimi: body.importoCentesimi,
          metodoPagamento: body.metodoPagamento || 'bonifico',
          riferimentoTransazione: body.riferimentoTransazione || null,
          note: body.note || null,
          data: body.data ? new Date(body.data) : new Date(),
        },
        include: { contoBancario: true, cliente: true, fornitore: true },
      });

      // Aggiorna saldo conto bancario
      if (body.contoBancarioId) {
        const delta = body.tipo === 'entrata' ? body.importoCentesimi : -body.importoCentesimi;
        await prisma.contoBancario.update({
          where: { id: body.contoBancarioId },
          data: { saldoAttuale: { increment: delta } },
        });
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'MOVIMENTO_PRIMANOTA_CREATO',
        entita: body.descrizione,
        dettagli: `Registrato movimento ${body.tipo.toUpperCase()} di €${(body.importoCentesimi / 100).toFixed(2)} in Prima Nota`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(movimento);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore creazione movimento in Prima Nota' });
    }
  });

  server.post<{
    Body: {
      csvContent: string;
      contoBancarioId?: string;
    };
  }>('/prima-nota/import-csv', async (req, reply) => {
    const tenantId = req.tenantId;
    const { csvContent, contoBancarioId } = req.body;

    if (!csvContent || !csvContent.trim()) {
      return reply.code(400).send({ errore: 'Contenuto CSV obbligatorio' });
    }

    try {
      const clienti = await prisma.cliente.findMany({ where: { tenantId } });
      const righe = csvContent.trim().split('\n');
      const inseriti = [];

      // Le righe che **non** sono diventate un movimento, con il perché. Non è reportistica: senza
      // questo elenco una riga scartata e una riga mai letta sono la stessa cosa per chi guarda lo
      // schermo, e chi importa 40 movimenti su 45 conclude di averli importati tutti. Il numero di
      // riga è del file incollato — l'unico riferimento che chi ha il CSV davanti può usare.
      const scartate: { riga: number; motivo: string; contenuto: string }[] = [];

      for (let i = 0; i < righe.length; i++) {
        const r = righe[i];
        if (!r || !r.trim()) continue; // una riga vuota non è un errore: è la fine del file
        const numeroRiga = i + 1;

        const parts = r.includes(';') ? r.split(';') : r.split(',');
        if (parts.length < 2) {
          scartate.push({ riga: numeroRiga, motivo: 'meno di due colonne', contenuto: r.trim() });
          continue;
        }

        // Un importo che non si legge **scarta la riga**. Prima diventava un movimento da 100 €:
        // un numero inventato dentro la contabilità, indistinguibile da uno vero.
        const importoNum = leggiImporto(parts[2]);
        if (importoNum === null) {
          scartate.push({
            riga: numeroRiga,
            motivo: `importo mancante o non numerico («${parts[2]?.trim() ?? ''}»)`,
            contenuto: r.trim(),
          });
          continue;
        }

        const rawData = parts[0]?.trim();
        const data = leggiData(rawData);
        if (!data) {
          scartate.push({
            riga: numeroRiga,
            motivo: `data non riconosciuta («${rawData ?? ''}»)`,
            contenuto: r.trim(),
          });
          continue;
        }

        const rawDesc = parts[1]?.trim() || `Transazione Bancaria #${numeroRiga}`;
        const rawCro = parts[3]?.trim() || `TRN-${Date.now()}-${numeroRiga}`;

        const tipo: 'entrata' | 'uscita' = importoNum >= 0 ? 'entrata' : 'uscita';
        const importoCentesimi = Math.round(Math.abs(importoNum) * 100);

        // Matching automatico cliente
        const matchedClient = clienti.find((c) => rawDesc.toLowerCase().includes(c.nome.toLowerCase()));

        const m = await prisma.movimentoPrimaNota.create({
          data: {
            tenantId,
            contoBancarioId: contoBancarioId || null,
            clienteId: matchedClient?.id || null,
            tipo,
            categoria: tipo === 'entrata' ? 'incasso_fattura' : 'spese_generali',
            descrizione: rawDesc,
            importoCentesimi,
            metodoPagamento: 'bonifico',
            riferimentoTransazione: rawCro,
            data,
          },
        });
        inseriti.push(m);
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'PRIMANOTA_CSV_IMPORTATO',
        entita: `${inseriti.length} movimenti`,
        dettagli:
          `Importati e riconciliati ${inseriti.length} movimenti bancari da CSV a database` +
          (scartate.length > 0 ? `; ${scartate.length} righe scartate alle righe ${scartate.map(s => s.riga).join(', ')}` : ''),
        ipAddress: req.ip,
      });

      // «Importati con successo» a fronte di righe scartate è la rassicurazione falsa che questo
      // import esiste per non dare. Le due cose si dicono sempre insieme, anche quando la seconda
      // è zero — così il messaggio cambia forma solo quando c'è davvero qualcosa da guardare.
      const message =
        scartate.length === 0
          ? `${inseriti.length} movimenti importati e riconciliati con successo in Prima Nota!`
          : `${inseriti.length} movimenti importati. ${scartate.length} righe scartate, non registrate: il dettaglio è nell'elenco.`;

      return reply.send({
        ok: true,
        importati: inseriti.length,
        scartate,
        movimenti: inseriti,
        message,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore durante l\'importazione del CSV' });
    }
  });

  server.delete<{ Params: { id: string } }>('/prima-nota/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    try {
      const movimento = await prisma.movimentoPrimaNota.findFirst({
        where: { id, tenantId },
      });
      if (!movimento) return reply.code(404).send({ errore: 'Movimento non trovato' });

      // Storno saldo conto bancario
      if (movimento.contoBancarioId) {
        const delta = movimento.tipo === 'entrata' ? -movimento.importoCentesimi : movimento.importoCentesimi;
        await prisma.contoBancario.update({
          where: { id: movimento.contoBancarioId },
          data: { saldoAttuale: { increment: delta } },
        });
      }

      await prisma.movimentoPrimaNota.delete({ where: { id } });

      return reply.send({ ok: true, message: 'Movimento eliminato con successo' });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore eliminazione movimento' });
    }
  });
}
