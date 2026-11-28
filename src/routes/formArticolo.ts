// I form dello studio e il form di un articolo (titolare, 28/11/2026: «nell'articolo deve essere
// indicato il form da compilare da parte del cliente»). Prima i form vivevano nello stato della
// pagina Libreria e la scelta sull'articolo non si salvava. Le regole stanno in
// `domain/formArticolo.ts`; cosa succede nel progetto in `services/formArticolo.ts`.
//
// Permessi: `/form-master` e `/articoli` sono Libreria nella matrice (`util/rbacModuli.ts`):
// legge chi ha la Libreria in lettura, scrive chi l'ha in scrittura.

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { invalidaCachePrefisso } from '../services/backendCache.js';
import { campiDelForm, motivoFormNonValido } from '../domain/formArticolo.js';

export async function registraRotteFormArticolo(server: FastifyInstance): Promise<void> {
  // L'elenco dei form dello studio, con quanti articoli attivi usano ciascuno.
  server.get('/form-master', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const [form, articoli] = await Promise.all([
        prisma.formMaster.findMany({ where: { tenantId }, orderBy: { nome: 'asc' } }),
        prisma.articolo.findMany({
          where: { tenantId, isAttivo: true, formMasterId: { not: null } },
          select: { formMasterId: true },
        }),
      ]);
      const usi = new Map<string, number>();
      for (const a of articoli) if (a.formMasterId) usi.set(a.formMasterId, (usi.get(a.formMasterId) ?? 0) + 1);
      return form.map((f) => ({ id: f.id, nome: f.nome, campi: campiDelForm(f.campiJson), articoli: usi.get(f.id) ?? 0 }));
    } catch (err) {
      req.log.error(err, 'Errore lettura form');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura form' });
    }
  });

  server.post<{ Body: { nome?: unknown; campi?: unknown } }>('/form-master', async (req, reply) => {
    const tenantId = req.tenantId;
    const { nome, campi } = req.body || {};
    const motivo = motivoFormNonValido(nome, campi);
    if (motivo) return reply.code(400).send({ errore: motivo });
    const nomePulito = (nome as string).trim();
    const domande = campiDelForm(campi);
    try {
      const doppione = await prisma.formMaster.findFirst({
        where: { tenantId, nome: { equals: nomePulito, mode: 'insensitive' } },
        select: { id: true },
      });
      if (doppione) return reply.code(409).send({ errore: `Esiste già un form che si chiama «${nomePulito}».` });

      const creato = await prisma.formMaster.create({ data: { tenantId, nome: nomePulito, campiJson: domande } });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FORM_CREATO',
        entita: creato.nome,
        dettagli: `Creato il form «${creato.nome}» con ${domande.length} domande: ${domande.join(', ')}`,
        ipAddress: req.ip,
      });
      return reply.code(201).send({ id: creato.id, nome: creato.nome, campi: domande, articoli: 0 });
    } catch (err) {
      req.log.error(err, 'Errore creazione form');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore creazione form' });
    }
  });

  // Un form indicato da un articolo non si elimina: prima si toglie dall'articolo. I passaggi
  // già nati nei progetti tengono le loro domande e le loro risposte, che sono copiate su di loro.
  server.delete<{ Params: { id: string } }>('/form-master/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      const form = await prisma.formMaster.findFirst({ where: { id, tenantId } });
      if (!form) return reply.code(404).send({ errore: 'Form non trovato' });
      const inUso = await prisma.articolo.findMany({
        where: { tenantId, isAttivo: true, formMasterId: id },
        select: { nome: true },
        orderBy: { nome: 'asc' },
      });
      if (inUso.length > 0) {
        return reply.code(409).send({
          errore:
            `Il form «${form.nome}» è indicato da ${inUso.length === 1 ? 'un articolo' : `${inUso.length} articoli`} ` +
            `(${inUso.slice(0, 3).map((a) => a.nome).join(', ')}${inUso.length > 3 ? '…' : ''}): toglilo da lì prima di eliminarlo.`,
          codice: 'FORM_IN_USO',
        });
      }
      await prisma.formMaster.delete({ where: { id: form.id } });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FORM_ELIMINATO',
        entita: form.nome,
        dettagli: `Eliminato il form «${form.nome}»`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err, 'Errore eliminazione form');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore eliminazione form' });
    }
  });

  // Modifica di un articolo: nome, prezzo, ore e il form che il cliente compila.
  // `formMasterId: null` toglie il form; assente lo lascia com'è.
  server.patch<{
    Params: { id: string };
    Body: { prezzoDefault?: number; oreDefault?: number; nome?: string; formMasterId?: string | null };
  }>('/articoli/:id', async (req, reply) => {
    const { id } = req.params;
    const { prezzoDefault, oreDefault, nome, formMasterId } = req.body || {};
    const tenantId = req.tenantId;
    try {
      const articolo = await prisma.articolo.findFirst({ where: { id, tenantId } });
      // §3.3 — un id sbagliato o di un altro studio è un 404, non un «salvato».
      if (!articolo) return reply.code(404).send({ errore: 'Articolo non trovato' });

      let form: { id: string; nome: string } | null = null;
      if (typeof formMasterId === 'string' && formMasterId) {
        form = await prisma.formMaster.findFirst({ where: { id: formMasterId, tenantId }, select: { id: true, nome: true } });
        if (!form) return reply.code(400).send({ errore: 'Il form scelto non esiste più: ricarica la pagina e sceglilo di nuovo.' });
      }
      const nuovoFormId = formMasterId === undefined ? undefined : (form?.id ?? null);

      const updated = await prisma.articolo.update({
        where: { id: articolo.id },
        data: {
          prezzoDefault: prezzoDefault !== undefined ? prezzoDefault : undefined,
          oreDefault: oreDefault !== undefined ? oreDefault : undefined,
          nome: nome !== undefined ? nome : undefined,
          formMasterId: nuovoFormId,
        },
      });
      const cambioForm = nuovoFormId !== undefined && nuovoFormId !== articolo.formMasterId
        ? ` Form del cliente: ${form ? `«${form.nome}»` : 'nessuno'}.`
        : '';
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'ARTICOLO_AGGIORNATO',
        entita: updated.nome,
        dettagli: `Aggiornato prezzo (€${(updated.prezzoDefault || 0) / 100}) e ore (${updated.oreDefault}h).${cambioForm}`,
        ipAddress: req.ip,
      });
      await invalidaCachePrefisso(`articoli:${tenantId}`);
      await invalidaCachePrefisso(`moduli:${tenantId}`);
      return reply.send(updated);
    } catch (err) {
      req.log.error(err, 'Errore aggiornamento articolo');
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore aggiornamento articolo' });
    }
  });
}
