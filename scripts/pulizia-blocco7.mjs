/**
 * §Blocco 7 — pulizia dati concordata (7.1 doppioni, 7.4 rinomina tenant).
 *
 * Dry-run di default: CONTA solo cosa sarebbe toccato, senza scrivere nulla.
 * Con --applica esegue davvero, in un'unica transazione. Ogni utente da
 * eliminare è protetto da un doppio guard (id + email): se il database non
 * corrisponde alle attese lo script si ferma senza toccare nulla.
 *
 * 7.1 — i doppioni seed francesca@ / lorenzo@ vengono eliminati; eventuali righe
 *       che li referenziano (documenti caricati, eventi, accessi, notifiche,
 *       microvoci assegnate) vengono RIASSIGNATE all'utente canonico omonimo
 *       creato il 17/08, così non si perde storia. I permessi modulo (cascade)
 *       vengono rimessi esplicitamente per non duplicare righe.
 * 7.4 — i due tenant "Studio Professionale" (entrambi vuoti) vengono rinominati
 *       per non confonderli: "(test 19/08 · A)" e "(test 19/08 · B)".
 *
 *   node scripts/pulizia-blocco7.mjs            # dry-run (solo conteggi)
 *   node scripts/pulizia-blocco7.mjs --applica  # esegue in transazione
 */
import dotenv from 'dotenv';
dotenv.config();

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const APPLICA = process.argv.includes('--applica');

// ── 7.1 doppioni da eliminare → utente canonico a cui riassignare ──
const COPPIE = [
  {
    label: 'Francesca Disabato',
    doppione: { id: '44444444-4444-4444-4444-444444444444', email: 'francesca@bluecode.advisory' },
    canonico: { id: '2f8b3a3d-d00b-4ee2-a950-329b1eed937d', email: 'francesca.disabato@bluecode.advisory' },
  },
  {
    label: 'Avv. Lorenzo Marino',
    doppione: { id: '55555555-5555-5555-5555-555555555555', email: 'lorenzo@bluecode.advisory' },
    canonico: { id: '7b5dae2d-5516-4a17-9613-b52b0c956605', email: 'lorenzo.marino@bluecode.advisory' },
  },
];

// ── 7.4 tenant da rinominare ──
const TENANT_RINOMINA = [
  { id: 'aaaaaaaa-0000-4000-8000-00000000000a', vecchio: 'Studio Professionale', nuovo: 'Studio Professionale (test 19/08 · A)' },
  { id: 'bbbbbbbb-0000-4000-8000-00000000000b', vecchio: 'Studio Professionale', nuovo: 'Studio Professionale (test 19/08 · B)' },
];

/** Passo di riassignazione: in dry-run solo count, in applica updateMany. */
function passiRiassignazione(doppioneId, canonicoId) {
  return [
    ['microvoci assegnate', 'microvoceProgetto', { risorsaId: doppioneId }, { risorsaId: canonicoId }],
    ['eventi calendario', 'eventoCalendario', { userId: doppioneId }, { userId: canonicoId }],
    ['accessi risorsa (utente)', 'accessoRisorsa', { userId: doppioneId }, { userId: canonicoId }],
    ['accessi risorsa (invitante)', 'accessoRisorsa', { invitatoDa: doppioneId }, { invitatoDa: canonicoId }],
    ['notifiche ricevute', 'notifica', { destinatarioId: doppioneId }, { destinatarioId: canonicoId }],
    ['documenti caricati', 'documento', { caricatoDa: doppioneId }, { caricatoDa: canonicoId }],
  ];
}

try {
  console.log(APPLICA ? '▶ MODALITÀ APPLICA — le modifiche saranno salvate in transazione\n' : '▶ DRY-RUN — nessuna scrittura (aggiungi --applica per eseguire)\n');

  // Verifica guard: tutti gli id devono corrispondere alle email attese
  for (const { label, doppione, canonico } of COPPIE) {
    const d = await prisma.user.findUnique({ where: { id: doppione.id } });
    const c = await prisma.user.findUnique({ where: { id: canonico.id } });
    if (!d || !c || d.email !== doppione.email || c.email !== canonico.email) {
      console.error(`⛔ Guard fallito per ${label}: atteso doppione=${doppione.email} (${doppione.id}) / canonico=${canonico.email} (${canonico.id}), trovato doppione=${d?.email ?? '—'} / canonico=${c?.email ?? '—'}. Nessuna azione.`);
      process.exit(1);
    }
  }
  for (const t of TENANT_RINOMINA) {
    const tr = await prisma.tenant.findUnique({ where: { id: t.id } });
    if (!tr || tr.ragioneSociale !== t.vecchio) {
      console.error(`⛔ Guard fallito per tenant ${t.id}: atteso "${t.vecchio}", trovato "${tr?.ragioneSociale ?? '—'}". Nessuna azione.`);
      process.exit(1);
    }
  }
  console.log('✓ Tutti i guard corrispondono alle attese\n');

  if (!APPLICA) {
    // ── DRY-RUN: solo conteggi, nessuna scrittura ──
    for (const { label, doppione, canonico } of COPPIE) {
      console.log(`── 7.1 ${label}: eliminerei ${doppione.email} → riassignerei a ${canonico.email}`);
      for (const [nome, model, where] of passiRiassignazione(doppione.id, canonico.id)) {
        const n = await prisma[model].count({ where });
        console.log(`   ${nome}: ${n}`);
      }
      const permessi = await prisma.permessoModulo.count({ where: { userId: doppione.id } });
      console.log(`   permessi modulo (sarebbero rimossi): ${permessi}`);
      console.log('');
    }
    for (const t of TENANT_RINOMINA) {
      console.log(`── 7.4 tenant ${t.id}: "${t.vecchio}" → "${t.nuovo}"`);
    }
    console.log('\nDry-run conclusa. Rilanciare con --applica per eseguire.');
  } else {
    // ── APPLICA: tutto in un'unica transazione ──
    await prisma.$transaction(async (tx) => {
      for (const { label, doppione, canonico } of COPPIE) {
        console.log(`── 7.1 ${label}: elimino ${doppione.email} → riassigno a ${canonico.email}`);
        for (const [nome, model, where, data] of passiRiassignazione(doppione.id, canonico.id)) {
          const r = await tx[model].updateMany({ where, data });
          console.log(`   ${nome}: ${r.count}`);
        }
        const perm = await tx.permessoModulo.deleteMany({ where: { userId: doppione.id } });
        console.log(`   permessi modulo rimossi: ${perm.count}`);
        await tx.user.delete({ where: { id: doppione.id } });
        console.log(`   ✓ utente ${doppione.email} eliminato\n`);
      }
      for (const t of TENANT_RINOMINA) {
        await tx.tenant.update({ where: { id: t.id }, data: { ragioneSociale: t.nuovo } });
        console.log(`── 7.4 ✓ tenant ${t.id}: "${t.vecchio}" → "${t.nuovo}"`);
      }
    });
    console.log('\n✓ Pulizia applicata.');
  }
} finally {
  await prisma.$disconnect();
}
