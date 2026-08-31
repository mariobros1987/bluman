// §40 — Collocare un documento nell'archivio: collegarlo al progetto e alla micro-voce.
//
// L'archivio (§37) sapeva soltanto leggere: navigava Cliente → Progetto → Documenti e dichiarava
// «N documenti non compaiono in nessuna cartella» senza offrire alcun modo di rimediare. Un
// documento arrivato prima che il progetto avesse le micro-voci restava agganciato al solo
// fascicolo per sempre, e un documento il cui progetto era stato eliminato restava invisibile.
//
// Qui si scrive: si sposta un documento da una cartella all'altra e si aggancia (o si stacca) la
// micro-voce. La decisione di dove può andare sta in `services/collocazioneDocumento.ts`, che è
// presidiata a parte; qui si leggono le righe, si scrive e si verbalizza.
//
// Perché un file a parte e non in fondo a `routes/documenti.ts`: quel file è a ~1000 righe
// (regola 8) e ha un altro mestiere. E non in `routes/archivioDocumenti.ts`: quello è la mappa
// delle cartelle, in sola lettura e in aggregato. Questo è l'unico posto che sposta le carte.
//
// Nessuna migrazione: `progetto_id` e `microvoce_progetto_id` esistono sulla riga `documento` fin
// da §2.9. Quello che mancava era poterli cambiare, e la traccia di chi li ha cambiati.

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { decidiCollocazione, descriviSpostamento } from '../services/collocazioneDocumento.js';

/** Il nome del file come lo legge un umano: senza il prefisso `${Date.now()}_` dell'archivio. */
function nomeLeggibile(fileUrl: string): string {
  const grezzo = (fileUrl || '').split('?')[0]?.split('/').pop() ?? '';
  try {
    return decodeURIComponent(grezzo).replace(/^\d{13}_/, '') || 'documento';
  } catch {
    return grezzo.replace(/^\d{13}_/, '') || 'documento';
  }
}

export async function registraRotteCollegamentoDocumenti(server: FastifyInstance): Promise<void> {
  /**
   * GET /documenti/non-collocati
   *
   * I documenti che esistono ma non stanno in nessuna cartella. L'archivio ne dichiarava il
   * numero e si fermava lì: da qui si possono elencare e ricollocare uno per uno.
   */
  server.get('/documenti/non-collocati', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    // Come `/documenti/archivio`: il token di un cliente non entra nell'archivio dello studio,
    // altrimenti dal portale si leggerebbero le carte degli altri clienti.
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    try {
      const documenti = await prisma.documento.findMany({
        where: { tenantId, progettoId: null, microvoceProgettoId: null },
        select: {
          id: true,
          tipo: true,
          fileUrl: true,
          categoriaDoc: true,
          statoDoc: true,
          isArchiviato: true,
          createdAt: true,
          versione: true,
          caricatoDaUser: { select: { id: true, nome: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({
        ok: true,
        documenti: documenti.map((d) => ({
          id: d.id,
          tipo: d.tipo,
          nome: nomeLeggibile(d.fileUrl),
          categoriaDoc: d.categoriaDoc,
          statoDoc: d.statoDoc,
          isArchiviato: d.isArchiviato,
          versione: d.versione,
          createdAt: d.createdAt.toISOString(),
          caricatoDa: d.caricatoDaUser?.nome ?? null,
        })),
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura documenti non collocati' });
    }
  });

  /**
   * PATCH /documenti/:id/collegamento
   *
   * Sposta il documento nel progetto indicato e, dentro quello, sulla micro-voce indicata.
   * `microvoceProgettoId: null` stacca la micro-voce lasciando il documento nel fascicolo.
   *
   * Un documento firmato si può spostare: il contenuto non viene toccato, l'hash del sigillo è
   * calcolato sul file e non sulla cartella, e proprio i documenti firmati sono quelli che non si
   * possono cancellare e rifare (Punto 3 piano gap). Lo spostamento resta scritto nell'audit.
   */
  server.patch<{
    Params: { id: string };
    Body: { progettoId?: string | null; microvoceProgettoId?: string | null };
  }>('/documenti/:id/collegamento', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    if ((req as any).ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    const { id } = req.params;
    const { progettoId, microvoceProgettoId } = req.body ?? {};

    try {
      const documento = await prisma.documento.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          fileUrl: true,
          progettoId: true,
          microvoceProgettoId: true,
          progetto: { select: { nome: true } },
          microvoceProgetto: { select: { nome: true } },
        },
      });
      if (!documento) return reply.code(404).send({ errore: 'Documento non trovato.' });

      const progettoChiesto = (progettoId ?? '').trim() || null;
      const microvoceChiesta = (microvoceProgettoId ?? '').trim() || null;

      // Le due letture servono alla decisione: esiste il progetto in questo tenant, e a quale
      // progetto appartiene la micro-voce. Nessuna delle due si dà per buona dalla richiesta.
      const progetto = progettoChiesto
        ? await prisma.progetto.findFirst({ where: { id: progettoChiesto, tenantId }, select: { id: true, nome: true } })
        : null;
      const microvoce = microvoceChiesta
        ? await prisma.microvoceProgetto.findFirst({
            where: { id: microvoceChiesta, tenantId },
            select: { id: true, nome: true, moduloProgetto: { select: { progettoId: true } } },
          })
        : null;

      const esito = decidiCollocazione(
        { progettoId: progettoChiesto, microvoceProgettoId: microvoceChiesta },
        {
          progettoEsiste: Boolean(progetto),
          progettoDellaMicrovoce: microvoceChiesta
            ? microvoce?.moduloProgetto.progettoId ?? undefined
            : undefined,
        },
      );
      if (!esito.ok) return reply.code(esito.codice ?? 400).send({ errore: esito.errore });

      // Quando la richiesta indica solo la micro-voce, il progetto lo deduce la decisione: va
      // riletto il nome per l'audit, altrimenti la traccia direbbe «nessun progetto» dopo averlo
      // valorizzato.
      const nomeProgettoDopo = progetto?.nome
        ?? (esito.progettoId
          ? (await prisma.progetto.findFirst({ where: { id: esito.progettoId, tenantId }, select: { nome: true } }))?.nome ?? null
          : null);

      const aggiornato = await prisma.documento.update({
        where: { id: documento.id },
        data: { progettoId: esito.progettoId, microvoceProgettoId: esito.microvoceProgettoId },
        select: { id: true, progettoId: true, microvoceProgettoId: true },
      });

      const nome = nomeLeggibile(documento.fileUrl);
      await recordAudit({
        tenantId,
        userId: (req as any).userId,
        userEmail: (req as any).user?.email,
        ruolo: (req as any).ruolo,
        azione: 'DOCUMENTO_RICOLLEGATO',
        entita: documento.id,
        dettagli:
          `Documento «${nome}» spostato ` +
          descriviSpostamento(
            { progetto: documento.progetto?.nome, microvoce: documento.microvoceProgetto?.nome },
            { progetto: nomeProgettoDopo, microvoce: microvoce?.nome ?? null },
          ) +
          ` (progetto ${documento.progettoId ?? '—'} → ${aggiornato.progettoId ?? '—'}, micro-voce ${documento.microvoceProgettoId ?? '—'} → ${aggiornato.microvoceProgettoId ?? '—'})`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        documento: {
          id: aggiornato.id,
          progettoId: aggiornato.progettoId,
          microvoceProgettoId: aggiornato.microvoceProgettoId,
          progetto: nomeProgettoDopo,
          microvoce: microvoce?.nome ?? null,
        },
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore collegamento documento' });
    }
  });
}
