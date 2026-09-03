/**
 * Fotografia di quello che c'è davvero a database, tabella per tabella.
 *
 * Serve prima di qualunque pulizia: «resettare» senza sapere cosa si cancella è il modo più
 * rapido di perdere l'unica copia di un dato. Stampa solo conteggi, nomi e identificativi:
 *nessuna credenziale, nessun hash di password.
 *
 *   node scripts/stato-database.mjs
 *
 * `new PrismaClient()` qui è consentito: è uno script, non codice che serve una richiesta HTTP
 * (regola 1 di AGENTS.md), e deve leggere tutti i tenant senza contesto RLS.
 */
import dotenv from 'dotenv';
dotenv.config();

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const TABELLE = [
  'tenant', 'user', 'cliente', 'progetto', 'preventivo', 'engagementLetter',
  'moduloProgetto', 'microvoceProgetto', 'passaggioProgetto', 'documento',
  'firmaElettronica', 'codiceOtp', 'magicLink', 'fattura', 'fatturaRiga',
  'comunicazioneProgetto', 'eventoCalendario', 'contrattoRicorrente', 'contoBancario',
  'auditLog', 'notifica', 'accessoRisorsa', 'permessoModulo',
  'moduloTemplate', 'articolo', 'rigaDistinta', 'passaggioTemplate', 'giurisdizione',
  'modelloDocumentoCustom', 'modelloDocumentoInBianco', 'formMaster', 'checklistVoce',
];

try {
  console.log('\n── Conteggi ────────────────────────────────');
  for (const t of TABELLE) {
    if (typeof prisma[t]?.count !== 'function') {
      console.log(`${t.padEnd(24)} —  (non presente nello schema)`);
      continue;
    }
    try {
      console.log(`${t.padEnd(24)} ${await prisma[t].count()}`);
    } catch (e) {
      console.log(`${t.padEnd(24)} errore: ${e.message.split('\n')[0]}`);
    }
  }

  console.log('\n── Tenant ──────────────────────────────────');
  for (const t of await prisma.tenant.findMany({ select: { id: true, ragioneSociale: true, stato: true } })) {
    console.log(`${t.id}  ${(t.ragioneSociale ?? '—').padEnd(28)} [${t.stato ?? '—'}]`);
  }

  console.log('\n── Utenti (nessuna password) ───────────────');
  for (const u of await prisma.user.findMany({ select: { email: true, ruolo: true, tenantId: true } })) {
    console.log(`${(u.email ?? '—').padEnd(38)} ${String(u.ruolo).padEnd(14)} ${u.tenantId}`);
  }

  console.log('\n── Clienti ─────────────────────────────────');
  for (const c of await prisma.cliente.findMany({ select: { id: true, nome: true, email: true, cellulare: true, tenantId: true } })) {
    console.log(`${c.id}  ${(c.nome ?? '—').padEnd(28)} ${(c.email ?? 'nessuna email').padEnd(34)} ${c.cellulare ?? 'nessun cellulare'}`);
  }

  console.log('\n── Progetti, con moduli e micro-voci ───────');
  const progetti = await prisma.progetto.findMany({
    select: {
      id: true, nome: true, stato: true, valoreTotale: true, createdAt: true,
      cliente: { select: { nome: true } },
      moduli: { select: { nome: true, stato: true, orePreventivate: true, oreConsuntivate: true, _count: { select: { microvoci: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  for (const p of progetti) {
    console.log(`\n${p.id}  ${p.nome}  [${p.stato}]  cliente: ${p.cliente?.nome ?? '—'}  valore: ${(p.valoreTotale ?? 0) / 100} €`);
    if (p.moduli.length === 0) console.log('    ⚠ nessun modulo istanziato');
    for (const m of p.moduli) {
      console.log(`    ${m.nome} [${m.stato}] ore ${m.oreConsuntivate}/${m.orePreventivate} · micro-voci: ${m._count.microvoci}`);
    }
  }

  console.log('\n── Preventivi ──────────────────────────────');
  for (const pv of await prisma.preventivo.findMany({ select: { id: true, stato: true, progettoId: true, valoreTotale: true, createdAt: true }, orderBy: { createdAt: 'desc' } })) {
    console.log(`${pv.id}  [${String(pv.stato).padEnd(10)}] progetto ${pv.progettoId}  ${(pv.valoreTotale ?? 0) / 100} €  ${pv.createdAt.toISOString().slice(0, 16)}`);
  }

  console.log('\n── Documenti ───────────────────────────────');
  for (const d of await prisma.documento.findMany({ select: { id: true, tipo: true, fileUrl: true, statoScansione: true } })) {
    console.log(`${d.id}  ${String(d.tipo).padEnd(16)} [${d.statoScansione}]  ${String(d.fileUrl).slice(0, 70)}`);
  }

  console.log('\n── Firme elettroniche ──────────────────────');
  for (const f of await prisma.firmaElettronica.findMany({ select: { signatureId: true, tipoFirma: true, ambito: true, riferimentoId: true, documentoTitolo: true, firmatoAt: true } })) {
    console.log(`${f.signatureId}  ${String(f.tipoFirma).padEnd(20)} ${String(f.ambito).padEnd(18)} rif ${f.riferimentoId ?? '—'}  ${f.documentoTitolo}`);
  }
  console.log('');
} finally {
  await prisma.$disconnect();
}
