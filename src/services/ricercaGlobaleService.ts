// ─────────────────────────────────────────────────────────────────
// RICERCA GLOBALE (BLOCCO 4)
// Ricerca trasversale sulle entità principali dello studio: clienti,
// progetti, fatture, documenti, membri del team, eventi calendario e
// contratti retainer. Server-side ILIKE (case-insensitive), con indici
// trigramma (pg_trgm) creati via migrazione per velocizzare i LIKE '%q%'.
//
// Regole rispettate:
// • Regola 1 — si usa il client condiviso `prisma` (src/util/prismaClient.js),
//   mai `new PrismaClient()`: il contesto tenant RLS è già attivo sull'hook.
// • Isolamento multi-tenant — ogni query filtra per il tenantId della
//   richiesta: la ricerca non attraversa mai i confini dello studio.
// • Niente dati finti — se una query fallisce l'errore risale al chiamante
//   (la rotta risponde 500 con il messaggio reale).
// ─────────────────────────────────────────────────────────────────

import { prisma } from '../util/prismaClient.js';

/** Singolo risultato della ricerca globale. */
export interface RisultatoRicerca {
  id: string;
  titolo: string;
  sottotitolo: string;
  link: string;
}

/** Gruppo di risultati omogenei (una entità del gestionale). */
export interface GruppoRicerca {
  tipo: string;
  etichetta: string;
  icona: string;
  risultati: RisultatoRicerca[];
}

/** Massimi risultati restituiti per ciascun tipo di entità. */
export const RISULTATI_PER_TIPO = 5;

// ILIKE interpreta % e _ come metacaratteri: vanno disinnescati prima di
// costruire il filtro, altrimenti una query "50%" diventa un wildcard.
function escapeILIKE(testo: string): string {
  return testo.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Estrae il nome del file leggibile da un URL/percentuale di upload:
// il documento non ha un campo "nome", il titolo è l'ultimo segmento del path.
function nomeFileDaUrl(fileUrl: string): string {
  const segmenti = fileUrl.split('/');
  const ultimo = segmenti[segmenti.length - 1] || fileUrl;
  try {
    return decodeURIComponent(ultimo);
  } catch {
    return ultimo;
  }
}

function dataIt(data: Date): string {
  return data.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Esegue la ricerca globale su tutte le entità indicizzabili del tenant.
 * Le query viaggiano in parallelo: il costo totale è quello della più lenta.
 */
export async function ricercaGlobale(tenantId: string, query: string): Promise<GruppoRicerca[]> {
  const q = query.trim();
  const contiene = { contains: escapeILIKE(q), mode: 'insensitive' as const };

  const [clienti, progetti, fatture, documenti, utenti, eventi, contratti] = await Promise.all([
    // 1. CLIENTI — nome, email, partita IVA, codice fiscale
    prisma.cliente.findMany({
      where: {
        tenantId,
        OR: [
          { nome: contiene },
          { email: contiene },
          { piva: contiene },
          { codiceFiscale: contiene },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: RISULTATI_PER_TIPO,
    }),

    // 2. PROGETTI — nome, numero lettera d'incarico, nome cliente
    prisma.progetto.findMany({
      where: {
        tenantId,
        OR: [
          { nome: contiene },
          { numeroContratto: contiene },
          { cliente: { nome: contiene } },
        ],
      },
      include: { cliente: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
      take: RISULTATI_PER_TIPO,
    }),

    // 3. FATTURE — numero documento ("FT-2026/001") e serie
    prisma.fattura.findMany({
      where: {
        tenantId,
        OR: [
          { numero: contiene },
          { serie: contiene },
        ],
      },
      include: { progetto: { select: { nome: true, cliente: { select: { nome: true } } } } },
      orderBy: { data: 'desc' },
      take: RISULTATI_PER_TIPO,
    }),

    // 4. DOCUMENTI — nome file (via fileUrl) e categoria
    prisma.documento.findMany({
      where: {
        tenantId,
        OR: [
          { fileUrl: contiene },
          { categoriaDoc: contiene },
        ],
      },
      include: { progetto: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
      take: RISULTATI_PER_TIPO,
    }),

    // 5. TEAM STUDIO — nome, email, specializzazione
    prisma.user.findMany({
      where: {
        tenantId,
        OR: [
          { nome: contiene },
          { email: contiene },
          { specializzazione: contiene },
        ],
      },
      orderBy: { nome: 'asc' },
      take: RISULTATI_PER_TIPO,
    }),

    // 6. CALENDARIO — titolo evento
    prisma.eventoCalendario.findMany({
      where: { tenantId, titolo: contiene },
      include: { progetto: { select: { nome: true } } },
      orderBy: { dataInizio: 'desc' },
      take: RISULTATI_PER_TIPO,
    }),

    // 7. CONTRATTI RETAINER — titolo e note
    prisma.contrattoRicorrente.findMany({
      where: {
        tenantId,
        OR: [
          { titolo: contiene },
          { note: contiene },
        ],
      },
      include: { cliente: { select: { nome: true } } },
      orderBy: { createdAt: 'desc' },
      take: RISULTATI_PER_TIPO,
    }),
  ]);

  const gruppi: GruppoRicerca[] = [];

  if (clienti.length > 0) {
    gruppi.push({
      tipo: 'clienti',
      etichetta: 'Clienti',
      icona: '👥',
      risultati: clienti.map((c) => ({
        id: c.id,
        titolo: c.nome,
        sottotitolo: [c.piva, c.email].filter(Boolean).join(' · '),
        link: `/clients?client=${encodeURIComponent(c.id)}`,
      })),
    });
  }

  if (progetti.length > 0) {
    gruppi.push({
      tipo: 'progetti',
      etichetta: 'Progetti',
      icona: '📁',
      risultati: progetti.map((p) => ({
        id: p.id,
        titolo: p.nome,
        sottotitolo: [p.cliente.nome, p.numeroContratto].filter(Boolean).join(' · '),
        link: `/projects/${p.id}`,
      })),
    });
  }

  if (fatture.length > 0) {
    gruppi.push({
      tipo: 'fatture',
      etichetta: 'Fatture',
      icona: '💶',
      risultati: fatture.map((f) => ({
        id: f.id,
        titolo: f.numero || `${f.serie}-${f.numeroProgressivoSerie}`,
        sottotitolo: [f.progetto?.cliente?.nome, f.progetto?.nome].filter(Boolean).join(' · '),
        link: '/invoices',
      })),
    });
  }

  if (documenti.length > 0) {
    gruppi.push({
      tipo: 'documenti',
      etichetta: 'Documenti',
      icona: '📝',
      risultati: documenti.map((d) => ({
        id: d.id,
        titolo: nomeFileDaUrl(d.fileUrl),
        sottotitolo: d.progetto?.nome || 'Documento studio',
        link: '/documents',
      })),
    });
  }

  if (utenti.length > 0) {
    gruppi.push({
      tipo: 'utenti',
      etichetta: 'Team Studio',
      icona: '👤',
      risultati: utenti.map((u) => ({
        id: u.id,
        titolo: u.nome,
        sottotitolo: [u.ruolo, u.email].filter(Boolean).join(' · '),
        link: '/settings',
      })),
    });
  }

  if (eventi.length > 0) {
    gruppi.push({
      tipo: 'eventi',
      etichetta: 'Calendario',
      icona: '📅',
      risultati: eventi.map((e) => ({
        id: e.id,
        titolo: e.titolo,
        sottotitolo: [dataIt(e.dataInizio), e.progetto?.nome].filter(Boolean).join(' · '),
        link: '/calendar',
      })),
    });
  }

  if (contratti.length > 0) {
    gruppi.push({
      tipo: 'contratti',
      etichetta: 'Contratti Retainer',
      icona: '🔄',
      risultati: contratti.map((c) => ({
        id: c.id,
        titolo: c.titolo,
        sottotitolo: c.cliente.nome,
        link: '/retainers',
      })),
    });
  }

  return gruppi;
}
