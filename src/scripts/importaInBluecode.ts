/**
 * Importa sul **nuovo** VPS i dati di uno studio esportati da `esportaDaBluecode.ts`.
 *
 * Gira dentro il container `api` (`docker compose run --rm -T api npx tsx …`), perché è lì
 * che c'è la connessione al database nuovo e il volume `bluman_uploads`.
 *
 * **Senza `--conferma` non scrive niente**: esegue tutto dentro una transazione e la
 * annulla. Il primo lancio è quindi una prova vera — conteggi, cancellazioni e inserimenti
 * vengono eseguiti davvero, e poi disfatti — invece di una simulazione che potrebbe
 * divergere da ciò che il commit farebbe.
 *
 * Il JSON viene riletto con `json_populate_recordset(null::<tabella>, …)`: le colonne le
 * risolve Postgres dal tipo riga della tabella, quindi non esiste un elenco di campi da
 * tenere allineato a mano. Vedi la nota in testa a `esportaDaBluecode.ts` sul perché.
 *
 * Uso:
 *   docker compose run --rm -T api npx tsx src/scripts/importaInBluecode.ts \
 *     --bundle /tmp/migrazione/bundle.json [--conferma]
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { CARTELLA_UPLOADS } from '../services/storageService.js';

dotenv.config();

/**
 * Gli studi da rimuovere prima di importare. Il primo è il tenant **demo** del seed: ha lo
 * stesso UUID dello studio vero del vecchio database, quindi va tolto perché Bluecode LTD
 * nasca con il suo id originale (decisione del titolare). Gli altri due sono il residuo del
 * test di isolamento fra tenant.
 */
const TENANT_DA_RIMUOVERE = [
  '00000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
];

/**
 * Come si contano le righe di uno studio dentro una tabella. Due tabelle non hanno
 * `tenant_id`: `tenant` **è** lo studio, e `passaggio_template` appartiene a un articolo —
 * non allo studio direttamente. Darlo per scontato farebbe fallire la verifica dei conteggi
 * con «column tenant_id does not exist», cioè proprio il controllo che serve a dire se
 * l'import è completo.
 */
function filtroConteggio(tabella: string): string {
  if (tabella === 'tenant') return 'id = $1';
  if (tabella === 'passaggio_template') {
    return `articolo_id IN (SELECT id FROM ${tab('articolo')} WHERE tenant_id = $1)`;
  }
  return 'tenant_id = $1';
}

/**
 * Nome di tabella pronto per l'SQL.
 *
 * `user` è **parola riservata** in PostgreSQL (equivale a `current_user`): senza virgolette
 * `DELETE FROM user` è un errore di sintassi. Qui sarebbe anche peggio che altrove, perché
 * `deleteTollerante` ingoia di proposito gli errori delle DELETE: la cancellazione degli
 * utenti di prova risulterebbe «0 righe» invece di fallire, e il problema si vedrebbe solo
 * alla fine, su `DELETE FROM tenant`. Le virgolette rendono la cosa vera per tutte.
 */
function tab(nome: string): string {
  if (!/^[a-z_]+$/.test(nome)) throw new Error(`Nome tabella non ammesso: ${nome}`);
  return `"${nome}"`;
}

interface Bundle {
  generatoIl: string;
  tenantId: string;
  ragioneSociale: string;
  tabelle: Record<string, Array<Record<string, unknown>>>;
  /**
   * I nomi dei file da depositare nel volume. Le righe arrivano **già** con la forma
   * `/uploads/<nome>`: la riscrittura la fa l'esportazione, perché farla qui richiederebbe di
   * portarsi dietro i valori vecchi — che per un file su Supabase sono URL firmati, e un
   * token non deve viaggiare dentro un file che finisce su disco e poi sul VPS.
   */
  fileDaDepositare: string[];
  fileMancanti: Array<{ tabella: string; id: string; colonna: string; motivo: string }>;
  /** Colonne «file» che contengono altro (slug di modello, percorsi statici): copiate verbatim. */
  riferimentiNonFile?: Array<{ tabella: string; colonna: string; valore: string }>;
  tabelleEscluse: Array<{ tabella: string; righe: number }>;
}

/**
 * Client di transazione, nella sola parte che serve qui. Tipizzato come fa
 * `conContestoInTransazione` in `src/util/prismaClient.ts`: il tipo generato da Prisma per
 * una transazione interattiva non è esportato in modo stabile, e dichiararlo strutturalmente
 * evita di dipendere dalla sua forma.
 */
type Tx = { $executeRawUnsafe: (...args: any[]) => Promise<unknown> };

/**
 * Esegue una DELETE che **può legittimamente fallire**, senza far fallire il resto.
 *
 * In PostgreSQL un errore dentro una transazione la abortisce: da lì in poi ogni istruzione
 * risponde «current transaction is aborted, commands ignored until end of transaction
 * block». Il ciclo di rimozione conta proprio su DELETE che falliscono — cancellare un
 * genitore prima del figlio deve fallire e riuscire al giro successivo — quindi senza un
 * punto di salvataggio il primo fallimento **atteso** avvelenerebbe la transazione e
 * l'import morirebbe al primo tentativo sbagliato, con un messaggio che non spiega niente.
 *
 * Prisma non avvolge le query in un SAVEPOINT da sé: va chiesto esplicitamente.
 */
async function deleteTollerante(tx: Tx, sql: string, ...params: unknown[]): Promise<number> {
  await tx.$executeRawUnsafe('SAVEPOINT tentativo');
  try {
    const cancellate = await tx.$executeRawUnsafe(sql, ...params);
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT tentativo');
    return Number(cancellate ?? 0);
  } catch {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT tentativo');
    return 0;
  }
}

/**
 * Esegue un INSERT che **può legittimamente fallire**, con lo stesso punto di salvataggio e la
 * stessa ragione di `deleteTollerante`.
 *
 * L'ordine delle tabelle non si conosce con certezza a priori: il passo 0 ha già trovato una
 * dipendenza che il piano non prevedeva (`modulo_template` → `giurisdizione`, e
 * `progetto` → `giurisdizione`). Invece di pretendere un ordine esatto e fermarsi alla prima
 * sorpresa, si prova e si ritenta: una tabella che dipende da una non ancora inserita fallisce
 * al primo giro e riesce al secondo. Se un giro intero non inserisce più niente, quello che
 * resta è un problema vero, e viene detto con l'errore di Postgres — non con un generico
 * «violazione di chiave esterna» che non dice quale riga né quale tabella.
 *
 * Restituisce `null` se riuscito, altrimenti il messaggio d'errore.
 */
async function insertTollerante(
  tx: Tx,
  sql: string,
  ...params: unknown[]
): Promise<string | null> {
  await tx.$executeRawUnsafe('SAVEPOINT inserimento');
  try {
    await tx.$executeRawUnsafe(sql, ...params);
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT inserimento');
    return null;
  } catch (e) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT inserimento');
    // Si preferisce `meta.message` al messaggio dell'eccezione: Prisma antepone a quello di
    // PostgreSQL una prefazione lunga («Invalid `prisma.$executeRawUnsafe()` invocation: Raw
    // query failed. Code: `23503`. Message: …») che, tagliata, mangia proprio il nome del
    // vincolo — l'unica cosa che dice *quale* chiave esterna manca. Il dettaglio di PostgreSQL
    // nomina la tabella e la colonna: è quello che serve per riparare.
    const dettaglio = (e as { meta?: { message?: string } })?.meta?.message ?? (e as Error).message;
    return String(dettaglio).replace(/\s+/g, ' ').slice(0, 300);
  }
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.ADMIN_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL },
  },
});

async function main() {
  const argomenti = process.argv.slice(2);
  const conferma = argomenti.includes('--conferma');
  const indiceBundle = argomenti.indexOf('--bundle');
  const percorsoBundle = indiceBundle >= 0 ? argomenti[indiceBundle + 1]! : '/tmp/migrazione/bundle.json';

  // ── Guardiano: prima di scrivere, accerta di poter vedere ─────────────────────────
  // Con un ruolo sotto RLS le policy filtrano, e ogni conteggio di verifica uscirebbe «0»
  // senza errore — un falso negativo che sembra un successo. È la lezione di
  // `verificaAccessi.ts`, applicata a uno script che questa volta SCRIVE.
  const [ruolo] = await prisma.$queryRaw<
    Array<{ utente: string; superuser: boolean; bypassrls: boolean }>
  >`SELECT current_user AS utente, rolsuper AS superuser, rolbypassrls AS bypassrls
      FROM pg_roles
     WHERE rolname = current_user`;

  if (!ruolo || (!ruolo.superuser && !ruolo.bypassrls)) {
    console.error(`\n❌ Ruolo connesso: «${ruolo?.utente ?? 'sconosciuto'}».`);
    console.error('   Non scavalca la RLS: gli inserimenti sarebbero respinti dalle policy');
    console.error('   e i conteggi di verifica mentirebbero. Nessun import.');
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(percorsoBundle)) {
    console.error(`❌ Bundle non trovato: ${percorsoBundle}`);
    process.exitCode = 1;
    return;
  }
  const bundle = JSON.parse(fs.readFileSync(percorsoBundle, 'utf8')) as Bundle;
  const cartellaFile = path.join(path.dirname(percorsoBundle), 'file');

  const ordine = Object.keys(bundle.tabelle);
  console.log(`\n=== Import di «${bundle.ragioneSociale}» (${bundle.tenantId}) ===`);
  console.log(`    bundle generato il ${bundle.generatoIl}`);
  console.log(`    ruolo connesso: ${ruolo.utente} (superuser=${ruolo.superuser})`);
  if (!conferma) {
    console.log('\n  ⚠  Modalità PROVA: tutto viene eseguito e poi annullato.');
    console.log('     Per scrivere davvero, ripeti con --conferma.\n');
  }

  const esistente = await prisma.tenant.findUnique({ where: { id: bundle.tenantId } });
  if (esistente) {
    const attesoDemo = TENANT_DA_RIMUOVERE.includes(bundle.tenantId);
    console.log(`  Lo studio ${bundle.tenantId} esiste già: «${esistente.ragioneSociale}» (piano=${esistente.piano}).`);
    if (!attesoDemo) {
      console.error('❌ Non è uno degli studi di prova che questo script sa rimuovere.');
      console.error('   L\'import si ferma: sostituire uno studio con dati veri è una decisione, non un default.');
      process.exitCode = 1;
      await prisma.$disconnect();
      return;
    }
    console.log('  È il tenant demo del seed: verrà rimosso e ricreato con i dati veri.');
  }

  // Quali studi di prova esistono davvero: si rimuovono solo quelli. Il residuo del test di
  // isolamento è indipendente dal tenant demo, quindi non si può legare la rimozione alla
  // sola esistenza di quest'ultimo.
  const presentiDaRimuovere: string[] = [];
  for (const id of TENANT_DA_RIMUOVERE) {
    if (await prisma.tenant.findUnique({ where: { id } })) presentiDaRimuovere.push(id);
  }
  // Array costruito con un segnaposto per elemento invece di passare un array JS: Prisma
  // serializza un array come letterale testuale, non come array tipizzato, e il confronto
  // fallirebbe in modo poco leggibile. Con `ARRAY[$1,$2,…]::text[]` i tipi sono espliciti.
  //
  // `text[]` e non `uuid[]`: Prisma mappa gli `String @id @default(uuid())` su **TEXT**, non
  // sul tipo `uuid` di PostgreSQL. Con `::uuid[]` il confronto `text = uuid` non ha operatore
  // e la rimozione degli studi di prova fallirebbe al primo tentativo — dentro
  // `deleteTollerante`, che è fatto apposta per ingoiare gli errori: risulterebbe «0 righe
  // cancellate» e l'import si fermerebbe molto più tardi, su un errore che non spiega niente.
  const segnaposti = presentiDaRimuovere.map((_, i) => `$${i + 1}`).join(', ');

  // Tabelle con `tenant_id`: servono per la rimozione e per la verifica finale. Si
  // scoprono dallo schema invece di elencarle, così una tabella dimenticata si vede.
  const tabelleTenant = (
    await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
        ORDER BY c.table_name`,
    )
  )
    .map((r) => r.table_name)
    .filter((t) => /^[a-z_]+$/.test(t));
  console.log(`  tabelle con tenant_id nello schema: ${tabelleTenant.length}`);

  let esito: string | null = null;

  try {
    await prisma.$transaction(
      async (tx) => {
        // ── 1. Rimozione degli studi di prova ──────────────────────────────────────
        // Senza sapere l'ordine delle dipendenze: si prova a cancellare da tutte le
        // tabelle e si ripete finché un giro non cancella più niente. Le chiavi esterne
        // RESTANO attive, ed è voluto — sono loro a garantire che non si creino orfani.
        // Cancellare per primo un genitore fallisce e si ritenta al giro dopo, quando il
        // figlio è già andato; se un giro non fa progressi, quello che resta è un ciclo o
        // una tabella fuori elenco, e lo si dice invece di forzare.
        if (presentiDaRimuovere.length > 0) {
          console.log(`\n  ── rimozione degli studi di prova (${presentiDaRimuovere.length}) ──`);
          const insiemi = `ARRAY[${segnaposti}]::text[]`;
          for (let giro = 1; giro <= 20; giro++) {
            let cancellate = 0;
            for (const tabella of tabelleTenant) {
              cancellate += await deleteTollerante(
                tx,
                `DELETE FROM ${tab(tabella)} WHERE tenant_id = ANY(${insiemi})`,
                ...presentiDaRimuovere,
              );
            }
            // `passaggio_template` non ha tenant_id: appartiene a un articolo.
            cancellate += await deleteTollerante(
              tx,
              `DELETE FROM ${tab('passaggio_template')}
                WHERE articolo_id IN (SELECT id FROM ${tab('articolo')} WHERE tenant_id = ANY(${insiemi}))`,
              ...presentiDaRimuovere,
            );
            console.log(`     giro ${giro}: ${cancellate} righe`);
            if (cancellate === 0) break;
          }
          const rimosse = await tx.$executeRawUnsafe(
            `DELETE FROM tenant WHERE id = ANY(${insiemi})`,
            ...presentiDaRimuovere,
          );
          console.log(`     studi rimossi: ${rimosse}`);
        }

        // ── 1b. Collisioni di email con gli utenti già presenti ────────────────────
        // `user.email` è unico (`user_email_key`). Sul VPS esiste già il super_admin con
        // l'email del titolare, e nel vecchio Bluecode LTD quella stessa email è di un utente
        // `advisor`: inserirlo in blocco violerebbe l'indice unico e abortirebbe l'import
        // intero. Si salta la riga — resta l'utente che c'è già — e lo si dice.
        //
        // Il passo 0 ha verificato che nessuna riga copiata referenzia quell'utente
        // (`documento.caricato_da`, `microvoce_progetto.risorsa_id` e `permesso_modulo.user_id`
        // sono tutte a zero per lui), quindi saltarlo non lascia orfani. Se un giorno non
        // fosse più vero, l'inserimento fallirebbe sulla chiave esterna invece di riuscire in
        // silenzio — ed è la differenza che rende accettabile saltare una riga.
        //
        // Lo stesso vale per le sue righe nella matrice dei permessi: un permesso che punta a
        // un utente inesistente non significa niente, e violerebbe la chiave esterna.
        const tabelle: Record<string, Array<Record<string, unknown>>> = { ...bundle.tabelle };
        const emailPresenti = new Set(
          (
            await tx.$queryRawUnsafe<Array<{ email: string }>>(`SELECT email FROM ${tab('user')}`)
          ).map((r) => r.email),
        );
        const utentiVecchi = tabelle.user ?? [];
        const utentiSaltati = utentiVecchi.filter((u) => emailPresenti.has(String(u.email)));
        if (utentiSaltati.length > 0) {
          const idSaltati = new Set(utentiSaltati.map((u) => String(u.id)));
          tabelle.user = utentiVecchi.filter((u) => !emailPresenti.has(String(u.email)));
          tabelle.permesso_modulo = (tabelle.permesso_modulo ?? []).filter(
            (p) => !idSaltati.has(String(p.user_id)),
          );
          console.log(`\n  utenti saltati (email già presente sul VPS): ${utentiSaltati.length}`);
          for (const u of utentiSaltati) {
            console.log(`     ${String(u.email)} — resta l'utente già presente`);
          }
        }

        // ── 2. Inserimento ─────────────────────────────────────────────────────────
        // Le righe si preparano prima, poi si inseriscono a tentativi: l'ordine del bundle
        // resta l'ordine preferito, non un requisito. Vedi `insertTollerante`.
        console.log('\n  ── inserimento ──');
        const daInserire = new Map<string, Array<Record<string, unknown>>>();
        for (const tabella of ordine) {
          let righe = tabelle[tabella] ?? [];
          if (righe.length === 0) {
            console.log(`     ${tabella.padEnd(30)} ${String(0).padStart(6)}`);
            continue;
          }
          // `documento` ha una chiave esterna verso sé stessa (`documento_padre_id`): le
          // righe con un padre vanno dopo il padre, e dentro un solo INSERT l'ordine è quello
          // dell'array. Prima i master, poi le versioni corrette.
          if (tabella === 'documento') {
            const padri = righe.filter((r) => r.documento_padre_id == null);
            const figli = righe.filter((r) => r.documento_padre_id != null);
            righe = [...padri, ...figli];
          }
          daInserire.set(tabella, righe);
        }

        for (let giro = 1; giro <= 20 && daInserire.size > 0; giro++) {
          const ultimoErrore = new Map<string, string>();
          let inserite = 0;
          for (const [tabella, righe] of daInserire) {
            const errore = await insertTollerante(
              tx,
              `INSERT INTO ${tab(tabella)} SELECT * FROM json_populate_recordset(NULL::${tab(tabella)}, $1::json)`,
              JSON.stringify(righe),
            );
            if (errore === null) {
              const nota = giro > 1 ? `   (riuscita al giro ${giro})` : '';
              console.log(`     ${tabella.padEnd(30)} ${String(righe.length).padStart(6)}${nota}`);
              daInserire.delete(tabella); // sicuro: Map tollera la cancellazione durante l'iterazione
              inserite++;
            } else {
              ultimoErrore.set(tabella, errore);
            }
          }
          if (inserite === 0) {
            const dettaglio = [...ultimoErrore].map(([t, m]) => `\n       ${t}: ${m}`).join('');
            throw new Error(
              `nessuna tabella inseribile: resta ${[...daInserire.keys()].join(', ')}.${dettaglio}`,
            );
          }
        }

        // I riferimenti ai file arrivano già riscritti dall'esportazione (`/uploads/<nome>`,
        // senza query string): la firma la rinnova `rifirmaUrlUpload` alla lettura, quindi in
        // tabella non resta un token che scade mentre dorme. Qui non c'è niente da riscrivere,
        // ed è di proposito: un solo posto che conosce quella regola.

        // ── 3. Verifica dentro la transazione ──────────────────────────────────────
        // Un conteggio per tabella contro il bundle. Se non combacia, si annulla tutto:
        // un import parziale è peggio di un import mancato, perché sembra riuscito.
        console.log('\n  ── verifica dei conteggi ──');
        let incoerenze = 0;
        for (const tabella of ordine) {
          const attese = (tabelle[tabella] ?? []).length;
          const filtro = filtroConteggio(tabella);
          const [esitoConteggio] = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*) AS n FROM ${tab(tabella)} WHERE ${filtro}`,
            bundle.tenantId,
          );
          const trovate = Number(esitoConteggio?.n ?? 0);
          const ok = trovate === attese;
          if (!ok) incoerenze++;
          console.log(`     ${ok ? 'ok ' : 'DIV'} ${tabella.padEnd(30)} ${String(trovate).padStart(6)} / ${attese}`);
        }
        if (incoerenze > 0) throw new Error(`${incoerenze} tabelle non corrispondono al bundle`);

        if (!conferma) {
          esito = 'prova';
          throw new Error('__PROVA__');
        }
      },
      { timeout: 120_000 },
    );
    esito = esito ?? 'committato';
  } catch (err) {
    if (err instanceof Error && err.message === '__PROVA__') {
      esito = 'prova';
    } else {
      console.error(`\n❌ Import annullato: ${err instanceof Error ? err.message : err}`);
      console.error('   Niente è stato scritto: la transazione è stata annullata per intero.');
      process.exitCode = 1;
      await prisma.$disconnect();
      return;
    }
  }

  // ── 4. I file, solo dopo il commit ───────────────────────────────────────────────
  // Restano fuori dalla transazione di proposito: il filesystem non partecipa al commit, e
  // scrivere i file prima di sapere se le righe sono state salvate lascerebbe sul volume
  // dei file che nessuna riga nomina.
  if (esito === 'committato') {
    console.log('\n  ── deposito dei file in ' + CARTELLA_UPLOADS + ' ──');
    fs.mkdirSync(CARTELLA_UPLOADS, { recursive: true });
    // L'elenco lo detta l'esportazione: sono i file che almeno una riga nomina. Un file
    // scaricato che nessuna riga nomina non va depositato; un file nominato che non è nel
    // bundle va detto a voce alta, perché quella riga resterà con un riferimento morto.
    const daDepositare = bundle.fileDaDepositare;
    let depositati = 0;
    for (const nomeNuovo of daDepositare) {
      const origine = path.join(cartellaFile, nomeNuovo);
      if (!fs.existsSync(origine)) {
        console.error(`     MANCA nel bundle: ${nomeNuovo}`);
        continue;
      }
      fs.copyFileSync(origine, path.join(CARTELLA_UPLOADS, nomeNuovo));
      depositati++;
    }
    console.log(`     file depositati: ${depositati} / ${daDepositare.length}`);
  }

  console.log('\n  ───────────────────────────────────────────');
  console.log(`  esito: ${esito === 'committato' ? '✅ SCRITTO' : '🔎 PROVA (nessuna scrittura)'}`);
  if (bundle.fileMancanti.length > 0) {
    console.log(`  file non recuperabili: ${bundle.fileMancanti.length} (le righe sono state copiate)`);
    for (const f of bundle.fileMancanti) console.log(`      ${f.tabella}/${f.id.slice(0, 8)} ${f.colonna}: ${f.motivo}`);
  }
  if (bundle.tabelleEscluse.length > 0) {
    console.log('  tabelle del vecchio studio NON copiate (fuori perimetro):');
    for (const e of bundle.tabelleEscluse) console.log(`      ${e.tabella.padEnd(30)} ${String(e.righe).padStart(6)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Import fallito:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exit(1);
});
