/**
 * Riallinea le colonne `cliente.email` e `cliente.cellulare` con i recapiti che si trovano solo
 * dentro `referentiJson`.
 *
 * Perché serve: fino a poco fa le rotte `/clienti` scrivevano l'email in colonna ma non il
 * cellulare, e le anagrafiche create dal seed o dalle versioni precedenti hanno entrambi i
 * recapiti soltanto nel JSON. Il portale legge le colonne, quindi dichiarava «Nessuna email in
 * anagrafica» e teneva WhatsApp indisponibile per clienti che il recapito ce l'avevano scritto
 * nella scheda. Le rotte ora scrivono le colonne; questo script sistema le righe già esistenti.
 *
 * Non sovrascrive niente: agisce solo dove la colonna è vuota. Con `--dry-run` elenca le
 * modifiche senza applicarle.
 *
 *   node scripts/backfill-recapiti-clienti.mjs --dry-run
 *   node scripts/backfill-recapiti-clienti.mjs
 *
 * `new PrismaClient()` qui è consentito: è uno script, non codice che serve una richiesta HTTP
 * (regola 1 di AGENTS.md), e deve poter leggere tutti i tenant senza contesto RLS.
 */
import dotenv from 'dotenv';
dotenv.config();

const { PrismaClient } = await import('@prisma/client');

const soloProva = process.argv.includes('--dry-run');

const valore = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
};

const db = new PrismaClient();

try {
  const clienti = await db.cliente.findMany({
    select: { id: true, nome: true, email: true, cellulare: true, referentiJson: true },
  });

  let aggiornati = 0;
  for (const c of clienti) {
    const ref = c.referentiJson && typeof c.referentiJson === 'object' && !Array.isArray(c.referentiJson) ? c.referentiJson : {};

    const email = valore(c.email) ? null : (valore(ref.email) ?? valore(ref.emailPrincipale));
    // `telefono` resta fuori: può essere un fisso, e un fisso non riceve messaggi WhatsApp.
    const cellulare = valore(c.cellulare) ? null : (valore(ref.cellulare) ?? valore(ref.whatsapp));

    if (!email && !cellulare) continue;

    const dati = {};
    if (email) dati.email = email.toLowerCase();
    if (cellulare) dati.cellulare = cellulare;

    console.log(`${soloProva ? '[prova]' : '[scritto]'} ${c.nome}: ${Object.entries(dati).map(([k, v]) => `${k} = ${v}`).join(', ')}`);
    if (!soloProva) await db.cliente.update({ where: { id: c.id }, data: dati });
    aggiornati += 1;
  }

  console.log(`\nClienti esaminati: ${clienti.length} — da riallineare: ${aggiornati}${soloProva ? ' (nessuna modifica applicata)' : ''}`);
} finally {
  await db.$disconnect();
}
