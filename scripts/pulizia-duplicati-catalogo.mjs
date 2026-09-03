/**
 * §Blocco 7 (fix) — pulizia duplicati del catalogo (moduli template + articoli).
 *
 * Due righe con stesso tenant, stesso nome (case-insensitive) e stessa versione
 * sono duplicati: il seed storico e le creazioni da UI li hanno prodotti
 * (es. "Analisi patrimoniale iniziale" presente due volte). Questo script:
 *
 *   1. raggruppa ModuloTemplate e Articolo per (tenantId, nome↓, versione);
 *   2. per ogni gruppo con più righe sceglie la riga DA TENERE: prima quella con
 *      più riferimenti (righe distinta, dipendenze, moduli progetto, passaggi,
 *      microvoci), a parità la più vecchia per createdAt;
 *   3. RIASSIGNA tutti i riferimenti delle righe duplicate alla riga tenuta,
 *      poi ripiega le righe distinta diventate doppie dopo la fusione
 *      (stesso modulo + stesso articolo): la microvoce che puntava alla riga
 *      eliminata viene riagganciata alla riga superstite, così non si perde
 *      consuntivazione;
 *   4. elimina le righe duplicate.
 *
 * Dry-run di default: conta e mostra soltanto. Con --applica esegue in
 * un'unica transazione.
 *
 *   node scripts/pulizia-duplicati-catalogo.mjs            # dry-run
 *   node scripts/pulizia-duplicati-catalogo.mjs --applica  # esegue davvero
 */
import dotenv from 'dotenv';
dotenv.config();

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const APPLICA = process.argv.includes('--applica');

function chiaveDiGruppo(r) {
  return `${r.tenantId}|${(r.nome || '').toLowerCase()}|v${r.versione ?? 1}`;
}

function raggruppa(lista) {
  const gruppi = new Map();
  for (const riga of lista) {
    const k = chiaveDiGruppo(riga);
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push(riga);
  }
  return [...gruppi.values()].filter((g) => g.length > 1);
}

async function conteggiaRiferimentiModulo(id) {
  const [righe, dip, progetti] = await Promise.all([
    prisma.rigaDistinta.count({ where: { moduloTemplateId: id } }),
    prisma.moduloDipendenzaTemplate.count({
      where: { OR: [{ moduloTemplateId: id }, { dipendeDaModuloTemplateId: id }] },
    }),
    prisma.moduloProgetto.count({ where: { moduloTemplateId: id } }),
  ]);
  return righe + dip + progetti;
}

async function conteggiaRiferimentiArticolo(id) {
  const [righe, passaggi, microvoci] = await Promise.all([
    prisma.rigaDistinta.count({ where: { articoloId: id } }),
    prisma.passaggioTemplate.count({ where: { articoloId: id } }),
    prisma.microvoceProgetto.count({ where: { articoloId: id } }),
  ]);
  return righe + passaggi + microvoci;
}

function scegliDaTenere(gruppo, rifPerId) {
  const ordinati = [...gruppo].sort((a, b) => {
    const diffRif = (rifPerId.get(b.id) || 0) - (rifPerId.get(a.id) || 0);
    if (diffRif !== 0) return diffRif; // più riferimenti prima
    const diffEta = new Date(a.createdAt) - new Date(b.createdAt);
    if (diffEta !== 0) return diffEta; // più vecchia prima
    return a.id < b.id ? -1 : 1;
  });
  return { tenuta: ordinati[0], doppioni: ordinati.slice(1) };
}

// ── Analisi ──────────────────────────────────────────────────────────────
const moduli = await prisma.moduloTemplate.findMany();
const articoli = await prisma.articolo.findMany();

const gruppiModuli = raggruppa(moduli);
const gruppiArticoli = raggruppa(articoli);

if (gruppiModuli.length === 0 && gruppiArticoli.length === 0) {
  console.log('✅ Nessun duplicato trovato nel catalogo: niente da fare.');
  process.exit(0);
}

const piano = []; // { tipo, chiave, tenuta, doppioni }

for (const gruppo of gruppiModuli) {
  const rifPerId = new Map();
  for (const m of gruppo) rifPerId.set(m.id, await conteggiaRiferimentiModulo(m.id));
  const { tenuta, doppioni } = scegliDaTenere(gruppo, rifPerId);
  piano.push({ tipo: 'modulo', chiave: chiaveDiGruppo(tenuta), tenuta, doppioni, rifPerId });
}
for (const gruppo of gruppiArticoli) {
  const rifPerId = new Map();
  for (const a of gruppo) rifPerId.set(a.id, await conteggiaRiferimentiArticolo(a.id));
  const { tenuta, doppioni } = scegliDaTenere(gruppo, rifPerId);
  piano.push({ tipo: 'articolo', chiave: chiaveDiGruppo(tenuta), tenuta, doppioni, rifPerId });
}

console.log(`\n── Piano pulizia (${APPLICA ? 'ESECUZIONE' : 'DRY-RUN'}) ─────────────────────`);
for (const p of piano) {
  console.log(`\n${p.tipo.toUpperCase()} "${p.chiave}"`);
  console.log(`  ✓ tiene  ${p.tenuta.id}  (riferimenti: ${p.rifPerId.get(p.tenuta.id)}, creato: ${p.tenuta.createdAt.toISOString()})`);
  for (const d of p.doppioni) {
    console.log(`  ✗ elimina ${d.id}  (riferimenti: ${p.rifPerId.get(d.id)}, creato: ${d.createdAt.toISOString()})`);
  }
}

if (!APPLICA) {
  console.log(`\nDry-run: ${piano.length} gruppi con duplicati. Rilancia con --applica per eseguire.`);
  process.exit(0);
}

// ── Esecuzione in transazione ────────────────────────────────────────────
const esito = await prisma.$transaction(async (tx) => {
  let righeRiassegnate = 0;
  let righePiegate = 0;
  let eliminati = 0;

  for (const p of piano) {
    const idsDoppioni = p.doppioni.map((d) => d.id);
    const keep = p.tenuta.id;

    if (p.tipo === 'modulo') {
      const r1 = await tx.rigaDistinta.updateMany({ where: { moduloTemplateId: { in: idsDoppioni } }, data: { moduloTemplateId: keep } });
      const r2 = await tx.moduloDipendenzaTemplate.updateMany({ where: { moduloTemplateId: { in: idsDoppioni } }, data: { moduloTemplateId: keep } });
      const r3 = await tx.moduloDipendenzaTemplate.updateMany({ where: { dipendeDaModuloTemplateId: { in: idsDoppioni } }, data: { dipendeDaModuloTemplateId: keep } });
      const r4 = await tx.moduloProgetto.updateMany({ where: { moduloTemplateId: { in: idsDoppioni } }, data: { moduloTemplateId: keep } });
      righeRiassegnate += r1.count + r2.count + r3.count + r4.count;
    } else {
      const r1 = await tx.rigaDistinta.updateMany({ where: { articoloId: { in: idsDoppioni } }, data: { articoloId: keep } });
      const r2 = await tx.passaggioTemplate.updateMany({ where: { articoloId: { in: idsDoppioni } }, data: { articoloId: keep } });
      const r3 = await tx.microvoceProgetto.updateMany({ where: { articoloId: { in: idsDoppioni } }, data: { articoloId: keep } });
      righeRiassegnate += r1.count + r2.count + r3.count;
    }
  }

  // Ripiega le righe distinta diventate doppie dopo le fusioni
  // (stesso modulo + stesso articolo): tiene la più vecchia per ordine/id e
  // riaggancia le microvoci che puntavano alle righe eliminate.
  const righe = await tx.rigaDistinta.findMany({ orderBy: [{ moduloTemplateId: 'asc' }, { articoloId: 'asc' }, { ordine: 'asc' }, { id: 'asc' }] });
  const perCoppia = new Map();
  for (const riga of righe) {
    const k = `${riga.moduloTemplateId}|${riga.articoloId}`;
    if (!perCoppia.has(k)) perCoppia.set(k, []);
    perCoppia.get(k).push(riga);
  }
  for (const [, gruppoRighe] of perCoppia) {
    if (gruppoRighe.length < 2) continue;
    const superstite = gruppoRighe[0]; // già ordinate: ordine crescente, poi id
    const surplus = gruppoRighe.slice(1);
    await tx.microvoceProgetto.updateMany({
      where: { rigaDistintaId: { in: surplus.map((r) => r.id) } },
      data: { rigaDistintaId: superstite.id },
    });
    const del = await tx.rigaDistinta.deleteMany({ where: { id: { in: surplus.map((r) => r.id) } } });
    righePiegate += del.count;
  }

  for (const p of piano) {
    const idsDoppioni = p.doppioni.map((d) => d.id);
    if (p.tipo === 'modulo') {
      const del = await tx.moduloTemplate.deleteMany({ where: { id: { in: idsDoppioni } } });
      eliminati += del.count;
    } else {
      const del = await tx.articolo.deleteMany({ where: { id: { in: idsDoppioni } } });
      eliminati += del.count;
    }
  }

  return { righeRiassegnate, righePiegate, eliminati };
});

console.log(`\n🎉 Pulizia completata: ${esito.eliminati} righe duplicate eliminate,`);
console.log(`   ${esito.righeRiassegnate} riferimenti riassegnati, ${esito.righePiegate} righe distinta ripiegate.`);
await prisma.$disconnect();
