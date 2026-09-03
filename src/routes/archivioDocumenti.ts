// Rotta dell'archivio documentale dello studio (§37): l'albero Cliente → Progetto
// con i conteggi delle carte che stanno a database.
//
// Perché un file a parte e non in fondo a `routes/documenti.ts`: quel file è già a
// ~1000 righe (regola 8) e fa un altro mestiere — scrive documenti, versioni,
// richieste di modifica. Qui si legge soltanto, e si legge in aggregato.
//
// Cosa NON fa: non restituisce i documenti. Le carte di un progetto si leggono con
// `GET /documenti?progettoId=…`, che già rinnova la firma HMAC degli URL /uploads/ e
// allega lo stato di firma. Duplicare quella logica per la vista ad albero vorrebbe
// dire avere due verità sullo stesso documento. L'archivio è la mappa delle cartelle;
// il contenuto della cartella lo serve l'endpoint che esisteva già.
//
// Nessuna migrazione: ogni numero qui viene da righe che il database ha già.

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';

/** I contatori di una cartella (cliente o progetto). Zero è un valore, non un'assenza. */
interface ContatoriCartella {
  documenti: number;
  firmati: number;
  daFirmare: number;
  archiviati: number;
  ultimoCaricamento: string | null;
}

function contatoriVuoti(): ContatoriCartella {
  return { documenti: 0, firmati: 0, daFirmare: 0, archiviati: 0, ultimoCaricamento: null };
}

function sommaIn(acc: ContatoriCartella, altro: ContatoriCartella): void {
  acc.documenti += altro.documenti;
  acc.firmati += altro.firmati;
  acc.daFirmare += altro.daFirmare;
  acc.archiviati += altro.archiviati;
  if (altro.ultimoCaricamento && (!acc.ultimoCaricamento || altro.ultimoCaricamento > acc.ultimoCaricamento)) {
    acc.ultimoCaricamento = altro.ultimoCaricamento;
  }
}

export async function registraRotteArchivioDocumenti(server: FastifyInstance): Promise<void> {
  server.get('/documenti/archivio', async (req, reply) => {
    const tenantId = req.tenantId;

    // L'archivio attraversa TUTTI i clienti del tenant: il token di un cliente non ci
    // entra, altrimenti dal portale si leggerebbero i nomi degli altri clienti dello
    // studio. RLS isola il tenant, non i clienti fra loro: la separazione la fa qui.
    if (req.ruolo === 'cliente') return reply.code(403).send({ errore: 'Non autorizzato.' });

    try {
      const clienti = await prisma.cliente.findMany({
        where: { tenantId },
        select: {
          id: true,
          nome: true,
          tipo: true,
          progetti: {
            select: { id: true, nome: true, stato: true, numeroContratto: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { nome: 'asc' },
      });

      // Select minima e volutamente senza `fileUrl`: qui non si scarica niente, si conta.
      // Una riga per documento è il prezzo dei conteggi per cartella (un groupBy per
      // progetto non basterebbe: i documenti agganciati alla sola micro-voce vanno
      // risaliti al progetto, e «firmato» dipende dalla tabella delle firme).
      const documenti = await prisma.documento.findMany({
        where: { tenantId },
        select: {
          id: true,
          progettoId: true,
          microvoceProgettoId: true,
          tipo: true,
          statoDoc: true,
          isArchiviato: true,
          createdAt: true,
        },
      });

      // I documenti caricati prima che il progetto avesse le micro-voci hanno solo
      // `progettoId`; quelli caricati su una micro-voce possono avere solo quello
      // (§2.9: almeno uno dei due è valorizzato). Il secondo caso si risale.
      const microvociDaRisolvere = [
        ...new Set(documenti.filter((d) => !d.progettoId && d.microvoceProgettoId).map((d) => d.microvoceProgettoId!)),
      ];
      const progettoPerMicrovoce = new Map<string, string>();
      if (microvociDaRisolvere.length > 0) {
        const microvoci = await prisma.microvoceProgetto.findMany({
          where: { tenantId, id: { in: microvociDaRisolvere } },
          select: { id: true, moduloProgetto: { select: { progettoId: true } } },
        });
        for (const m of microvoci) progettoPerMicrovoce.set(m.id, m.moduloProgetto.progettoId);
      }

      // «Firmato» con lo stesso criterio di `GET /documenti`: il sigillo a database,
      // oppure il tipo `firmato` (la copia ricomposta di §36, che nasce già sottoscritta).
      const firme = await prisma.firmaElettronica.findMany({
        where: { tenantId, ambito: 'documento_vault', riferimentoId: { in: documenti.map((d) => d.id) } },
        select: { riferimentoId: true },
      });
      const documentiFirmati = new Set(firme.map((f) => f.riferimentoId).filter((id): id is string => Boolean(id)));

      const perProgetto = new Map<string, ContatoriCartella>();
      let nonCollocati = 0;
      for (const d of documenti) {
        const progettoId = d.progettoId ?? (d.microvoceProgettoId ? progettoPerMicrovoce.get(d.microvoceProgettoId) : undefined);
        if (!progettoId) {
          // Il progetto è stato eliminato (FK onDelete: SetNull) e la micro-voce con lui:
          // il documento esiste ancora ed è giusto dirlo, invece di far tornare i conti.
          nonCollocati += 1;
          continue;
        }
        let c = perProgetto.get(progettoId);
        if (!c) {
          c = contatoriVuoti();
          perProgetto.set(progettoId, c);
        }
        const firmato = documentiFirmati.has(d.id) || d.tipo === 'firmato';
        if (d.isArchiviato) {
          c.archiviati += 1;
        } else {
          c.documenti += 1;
          if (firmato) c.firmati += 1;
          else if (d.statoDoc === 'pubblicato') c.daFirmare += 1;
          const iso = d.createdAt.toISOString();
          if (!c.ultimoCaricamento || iso > c.ultimoCaricamento) c.ultimoCaricamento = iso;
        }
      }

      const totali = contatoriVuoti();
      const alberoClienti = clienti.map((cliente) => {
        const contatoriCliente = contatoriVuoti();
        const progetti = cliente.progetti.map((p) => {
          const c = perProgetto.get(p.id) ?? contatoriVuoti();
          sommaIn(contatoriCliente, c);
          return {
            id: p.id,
            nome: p.nome,
            stato: p.stato,
            numeroContratto: p.numeroContratto,
            createdAt: p.createdAt.toISOString(),
            ...c,
          };
        });
        sommaIn(totali, contatoriCliente);
        return {
          id: cliente.id,
          nome: cliente.nome,
          tipo: cliente.tipo,
          progetti,
          ...contatoriCliente,
        };
      });

      return reply.send({
        ok: true,
        clienti: alberoClienti,
        totali: {
          clienti: alberoClienti.length,
          progetti: alberoClienti.reduce((n, c) => n + c.progetti.length, 0),
          documenti: totali.documenti,
          firmati: totali.firmati,
          daFirmare: totali.daFirmare,
          archiviati: totali.archiviati,
          // Documenti che esistono ma non hanno più una cartella in cui stare: la vista
          // li dichiara invece di nasconderli (regola 7 — non si inventa e non si tace).
          nonCollocati,
        },
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore lettura archivio documenti' });
    }
  });
}
