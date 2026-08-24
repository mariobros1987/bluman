/**
 * Azzera i dati operativi di prova, tenendo in piedi quello che serve per lavorare.
 *
 * A database si è accumulato il residuo di settimane di tentativi: 11 progetti di cui 7 senza
 * un solo modulo, 7 preventivi rimasti in bozza perché l'accettazione non arrivava mai al
 * server, clienti duplicati («Giuseppe Verdi» due volte, «Holding Beta S.r.l.» due volte),
 * progetti gemelli con id `prj-01` e `proj-01`. Su questa base non si può collaudare niente:
 * qualunque esito è ambiguo, perché non si sa se guarda il dato nuovo o un avanzo.
 *
 * COSA CANCELLA — tutto il lavoro registrato:
 *   progetti, moduli e micro-voci istanziati, passaggi, checklist, documenti, preventivi e
 *   lettere d'incarico, firme elettroniche, codici OTP, magic link, fatture con incassi e
 *   scadenze, comunicazioni, eventi di calendario, contratti ricorrenti, notifiche, accessi
 *   alle risorse, e le anagrafiche clienti.
 *
 * COSA NON TOCCA — l'impianto:
 *   i tenant e gli utenti (le credenziali di accesso restano valide), il catalogo dei moduli
 *   con articoli, distinte e passaggi di modello, le giurisdizioni, i modelli di documento e i
 *   form master. Senza il catalogo il wizard di creazione progetto non avrebbe niente da
 *   offrire, e senza gli utenti nessuno potrebbe rientrare.
 *
 * Il registro di audit resta: è la traccia di chi ha fatto cosa, e cancellarla per fare
 * pulizia è esattamente ciò che un registro di audit deve impedire. Con `--anche-audit` la si
 * cancella comunque, se serve un collaudo che parta davvero da zero righe.
 *
 *   node scripts/reset-dati-prova.mjs              # elenca e non tocca niente
 *   node scripts/reset-dati-prova.mjs --esegui     # cancella davvero
 *
 * `new PrismaClient()` qui è consentito: è uno script, non codice che serve una richiesta HTTP
 * (regola 1 di AGENTS.md), e deve agire su tutti i tenant senza contesto RLS.
 */
import dotenv from 'dotenv';
dotenv.config();

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const esegui = process.argv.includes('--esegui');
const ancheAudit = process.argv.includes('--anche-audit');

// L'ordine è quello delle dipendenze: prima i figli, poi i padri. Invertirlo fa fallire il
// vincolo di chiave esterna a metà lavoro, lasciando il database in uno stato peggiore di
// quello di partenza.
const DA_CANCELLARE = [
  'registrazioneIncasso',
  'scadenzaIncasso',
  'fatturaRiga',
  'fattura',
  'firmaElettronica',
  'codiceOtp',
  'magicLink',
  'checklistVoce',
  'documento',
  'passaggioProgetto',
  'accessoRisorsa',
  'moduloProgettoDipendenza',
  'microvoceProgetto',
  'moduloProgetto',
  'engagementLetter',
  'preventivo',
  'comunicazioneProgetto',
  'eventoCalendario',
  'contrattoRicorrente',
  'notifica',
  'progetto',
  'cliente',
];

const DA_TENERE = [
  'tenant', 'user', 'moduloTemplate', 'articolo', 'rigaDistinta', 'passaggioTemplate',
  'moduloDipendenzaTemplate', 'giurisdizione', 'modelloDocumentoCustom',
  'modelloDocumentoInBianco', 'formMaster', 'contoBancario', 'permessoModulo',
];

if (ancheAudit) DA_CANCELLARE.push('auditLog');
else DA_TENERE.push('auditLog');

try {
  console.log(esegui ? '\n⚠  MODALITÀ ESECUZIONE: le righe verranno cancellate.\n' : '\n○ Prova a vuoto: nessuna riga verrà toccata. Aggiungi --esegui per cancellare davvero.\n');

  console.log('── Verrà cancellato ────────────────────────');
  let totale = 0;
  for (const t of DA_CANCELLARE) {
    if (typeof prisma[t]?.count !== 'function') {
      console.log(`${t.padEnd(26)} —  (non presente nello schema, salto)`);
      continue;
    }
    const n = await prisma[t].count();
    totale += n;
    console.log(`${t.padEnd(26)} ${n}`);
  }
  console.log(`${'TOTALE righe'.padEnd(26)} ${totale}`);

  console.log('\n── Resta intatto ───────────────────────────');
  for (const t of DA_TENERE) {
    if (typeof prisma[t]?.count !== 'function') continue;
    console.log(`${t.padEnd(26)} ${await prisma[t].count()}`);
  }

  if (!esegui) {
    console.log('\nNiente è stato modificato.\n');
  } else {
    console.log('\n── Cancellazione ───────────────────────────');
    for (const t of DA_CANCELLARE) {
      if (typeof prisma[t]?.deleteMany !== 'function') continue;
      try {
        const { count } = await prisma[t].deleteMany({});
        console.log(`${t.padEnd(26)} cancellate ${count}`);
      } catch (e) {
        // Si prosegue: un vincolo che blocca una tabella non deve fermare le altre, e il
        // messaggio dice esattamente quale relazione va sciolta prima.
        console.log(`${t.padEnd(26)} ✗ ${e.message.split('\n').filter(Boolean).slice(-1)[0]?.trim()}`);
      }
    }
    console.log('\nFatto. Ricontrolla con: node scripts/stato-database.mjs\n');
  }
} finally {
  await prisma.$disconnect();
}
