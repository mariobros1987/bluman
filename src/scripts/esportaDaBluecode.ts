/**
 * Esporta da un **vecchio** database Bluecode (Supabase) i dati di **un solo studio**, per
 * portarli sul nuovo VPS con `importaInBluecode.ts`. Sola lettura: non scrive niente sul
 * vecchio database, e non tocca il nuovo.
 *
 * Perché uno script e non `pg_dump`: `pg_dump` non sa filtrare le righe per tenant, e sul
 * VPS gli altri studi del vecchio database non esistono — un dump completo violerebbe le
 * chiavi esterne o trascinerebbe dentro studi che non vogliamo. Qui si estrae esattamente
 * un tenant e tutto ciò che gli appartiene.
 *
 * Il JSON lo produce **Postgres**, non Node (`json_agg`), e l'import lo rilegge con
 * `json_populate_recordset`: le colonne non vengono mai enumerate a mano. È una scelta
 * deliberata — `prisma.x.create({ data })` non fa controllo dei campi in eccesso, perché
 * il tipo è uno `XOR<CreateInput, UncheckedCreateInput>`: un nome di campo sbagliato
 * compila pulito e fallisce solo a runtime. Due bug di questa classe sono già costati un
 * collaudo. Passando per il tipo riga della tabella, quella classe sparisce.
 *
 * Uso:
 *   npx tsx src/scripts/esportaDaBluecode.ts --tenant <uuid> [--out .tmp-migrazione]
 *
 * La stringa di connessione del vecchio database e la service key di Supabase restano su
 * questa macchina (`.env`): non vengono mai passate al VPS.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { accorciaNomeFile, leggiFileArchivio, nomeFileSicuro } from '../services/storageService.js';

// `tsx` non legge `.env` da sé.
dotenv.config();

/**
 * Le tabelle da esportare, in **ordine di dipendenza**: l'import le inserisce in questa
 * sequenza, così ogni chiave esterna trova già la sua riga. `tenant` è l'unica filtrata
 * per `id`; `passaggio_template` è l'unica senza `tenant_id` (appartiene a un articolo).
 */
interface SpecTabella {
  tabella: string;
  filtro: string;
  /** Colonne che contengono un riferimento a un file. */
  colonneFile?: string[];
  /**
   * Colonne che si azzerano **prima** di esportare, con il perché accanto.
   *
   * Serve quando una colonna valorizzata punta a una tabella che resta fuori dal piano: senza
   * azzerarla l'inserimento violerebbe la chiave esterna e l'import si annullerebbe per intero.
   * Azzerare è preferibile a copiare la tabella di destinazione solo quando il contenuto è
   * effimero — se non lo fosse, si copierebbe la tabella, non si butterebbe il valore.
   */
  colonneDaAzzerare?: Array<{ colonna: string; motivo: string }>;
}

const TABELLE: SpecTabella[] = [
  { tabella: 'tenant', filtro: 'id = $1', colonneFile: ['logo_url'] },
  { tabella: 'user', filtro: 'tenant_id = $1' },
  // La matrice dei permessi per utente e per modulo. **Non** è un extra: `server.ts` la legge
  // a ogni richiesta e, quando la riga manca, ricade sul default per ruolo
  // (`permessoDefaultPerRuolo`). Senza di essa un `advisor` a cui era stato tolto un modulo
  // tornerebbe ad averlo in scrittura — una escalation di privilegi, non una perdita di dati.
  { tabella: 'permesso_modulo', filtro: 'tenant_id = $1' },
  // Le giurisdizioni entrano per necessità, non per scelta: `modulo_template.giurisdizione_id`
  // le referenzia (5 moduli su 16 nel vecchio Bluecode), quindi senza di esse l'inserimento
  // dei moduli violerebbe la chiave esterna e l'import si annullerebbe per intero.
  { tabella: 'giurisdizione', filtro: 'tenant_id = $1' },
  { tabella: 'cliente', filtro: 'tenant_id = $1' },
  { tabella: 'fornitore', filtro: 'tenant_id = $1' },
  { tabella: 'articolo', filtro: 'tenant_id = $1', colonneFile: ['documento_allegato_url'] },
  {
    tabella: 'passaggio_template',
    // L'unica senza `tenant_id`: appartiene a un articolo, e va filtrata attraverso quello.
    filtro: 'articolo_id IN (SELECT id FROM "articolo" WHERE tenant_id = $1)',
  },
  { tabella: 'modulo_template', filtro: 'tenant_id = $1' },
  { tabella: 'riga_distinta', filtro: 'tenant_id = $1' },
  { tabella: 'modulo_dipendenza_template', filtro: 'tenant_id = $1' },
  { tabella: 'progetto', filtro: 'tenant_id = $1' },
  { tabella: 'modulo_progetto', filtro: 'tenant_id = $1' },
  { tabella: 'modulo_progetto_dipendenza', filtro: 'tenant_id = $1' },
  { tabella: 'microvoce_progetto', filtro: 'tenant_id = $1' },
  { tabella: 'microvoce_modulo_condiviso', filtro: 'tenant_id = $1' },
  {
    tabella: 'documento',
    filtro: 'tenant_id = $1',
    colonneFile: ['file_url', 'file_pdf_url', 'file_docx_url'],
  },
  // `passaggio_progetto.documento_allegato_url` è una colonna file che il piano non elencava:
  // 2 righe di Bluecode la usano. Trascurarla lascerebbe in tabella un URL firmato di Supabase
  // che scade da solo — il documento non si aprirebbe più, in silenzio.
  {
    tabella: 'passaggio_progetto',
    filtro: 'tenant_id = $1',
    colonneFile: ['documento_allegato_url'],
  },
  // **Nessuna** colonna file: i modelli del Document Studio conservano `contenuto_html`, non un
  // allegato. Il piano dava per scontata una `file_url` che non esiste, e l'UPDATE dell'import
  // su una colonna inesistente non è un avviso — è un errore che abortisce la transazione.
  { tabella: 'modello_documento_custom', filtro: 'tenant_id = $1' },
  { tabella: 'preventivo', filtro: 'tenant_id = $1' },

  // ── Compliance / antiriciclaggio ──────────────────────────────────────────────────────
  // Il piano iniziale le lasciava fuori (KYC si ridisegna per Malta, `FascicoloKyc` →
  // `KycCase`) ma la copia non è rieseguibile a studio già presente: rimandare avrebbe voluto
  // dire un secondo script su misura. Sono la storia di compliance dello studio — 3 fascicoli,
  // di cui 2 già approvati/chiusi — e si copiano con le altre. La concessione del modulo viaggia
  // da sé: `tenant.moduli_concessi` nel vecchio Bluecode LTD è già `["kyc"]`, quindi la chiave
  // arriva sul VPS insieme alla riga del tenant e il modulo risulta attivo senza toccare altro.
  //
  // Le tabelle che *puntano* a `fascicolo_kyc` (risk_assessment, screening_kyc, documento_kyc,
  // titolare_effettivo, anomalia_kyc, override_kyc, segnalazione_fiau, legame_controllo,
  // deposito_registro_te) sono vuote per questo studio: il passo 0 le ha contate a zero, quindi
  // non c'è niente da copiare e niente che resti orfano.
  { tabella: 'tenant_compliance_settings', filtro: 'tenant_id = $1' },
  { tabella: 'fascicolo_kyc', filtro: 'tenant_id = $1' },
  // Dipende da `fascicolo_kyc`: viene dopo, e l'import la inserisce dopo.
  { tabella: 'storico_fascicolo_kyc', filtro: 'tenant_id = $1' },
  { tabella: 'compliance_event', filtro: 'tenant_id = $1' },
  {
    tabella: 'firma_elettronica',
    filtro: 'tenant_id = $1',
    // Il PDF firmato è un file vero e sta su Supabase. La colonna si chiama `file_firmato_url`,
    // non `url`/`file_url`: uno scandaglio per nome non l'avrebbe trovata, ed è stata trovata
    // scandendo il bundle per **valore** — ogni stringa che comincia per `http`, `/uploads/` o
    // `/storage/`. Una firma che rimanda a un archivio che non esiste più è peggio di una firma
    // senza file: sembra verificabile e non lo è. `firma_grafometrica_png` invece resta nella
    // riga: è un data URL, non un riferimento a storage (scelta dichiarata nello schema).
    colonneFile: ['file_firmato_url'],
    // 10 firme su 11 puntano al codice OTP che le ha autorizzate. `codice_otp` resta fuori dal
    // piano — sono codici monouso, già scaduti, e sono un artefatto di autenticazione: copiarli
    // su un altro database non aggiunge nulla al valore probatorio, che sta nel sigillo
    // (`documento_hash`, `canale_verificato`, `ip_address`, `user_agent`). Si azzera il
    // riferimento e il sigillo resta intero; la colonna è già nullable proprio per questo.
    colonneDaAzzerare: [
      { colonna: 'codice_otp_id', motivo: 'codice monouso scaduto: la prova sta nel sigillo, non nell\'OTP' },
    ],
  },
  { tabella: 'richiesta_modifica_documento', filtro: 'tenant_id = $1' },
];

/**
 * Che fare quando una chiave esterna del bundle punta a una riga che nel bundle non c'è.
 *
 * Il caso non è teorico: nel vecchio Bluecode LTD la matrice dei permessi conteneva 9 righe
 * dell'**amministratore di piattaforma** (`joe@bluecode.advisory`, `tenant_id` nullo) e 15 dei
 * 20 documenti erano stati caricati dall'altro super_admin o da un utente di un altro studio.
 * Sono riferimenti che nello studio non hanno un proprietario: filtrando per `tenant_id` le
 * righe figlie entrano nel bundle, i loro genitori no.
 *
 * Le due tabelle non si trattano allo stesso modo, ed è il motivo per cui questo elenco è
 * esplicito invece di essere una regola unica:
 *   - `scarta`  — la riga figlia **non ha significato** senza il genitore (un permesso per un
 *                 utente che non esiste non è un permesso);
 *   - `azzera`  — la riga figlia vale da sé e si perde solo l'indicazione del genitore
 *                 (un documento resta il documento di qualcuno, anche se non si sa più chi
 *                 l'ha caricato). La colonna deve essere nullable: se non lo è, è `scarta`.
 *
 * Una chiave esterna rotta **senza** una voce qui ferma l'esportazione. È voluto: l'import
 * annullerebbe la transazione intera, e scoprirlo dopo aver cancellato gli studi di prova,
 * a transazione aperta, è il modo peggiore di scoprirlo.
 */
const POLITICHE_CHIUSURA: Array<{
  tabella: string;
  colonna: string;
  trattamento: 'azzera' | 'scarta';
  motivo: string;
}> = [
  {
    tabella: 'permesso_modulo',
    colonna: 'user_id',
    trattamento: 'scarta',
    motivo:
      'i 9 permessi sono dell\'amministratore di piattaforma (tenant_id nullo), che qui non esiste: ' +
      'gli utenti dello studio non avevano righe di permesso e lavoravano sui default di ruolo',
  },
  {
    tabella: 'documento',
    colonna: 'caricato_da',
    trattamento: 'azzera',
    motivo:
      'documenti caricati dal super_admin di piattaforma o da un utente di un altro studio: ' +
      'il documento resta, si perde solo chi l\'ha caricato',
  },
];

/**
 * Nome di tabella pronto per l'SQL.
 *
 * `user` è **parola riservata** in PostgreSQL (equivale a `current_user`): senza virgolette
 * `FROM user` è un errore di sintassi, non una tabella vuota. La tabella degli utenti è
 * l'unica del piano che ne ha bisogno, ed è quella che il passo 0 ha scoperto — sarebbe
 * stata la prima a fermare l'esportazione. Le virgolette rendono la cosa vera per tutte.
 */
function tab(nome: string): string {
  if (!/^[a-z_]+$/.test(nome)) throw new Error(`Nome tabella non ammesso: ${nome}`);
  return `"${nome}"`;
}

/**
 * Chiude il bundle su sé stesso: ogni chiave esterna fra le tabelle copiate deve trovare la sua
 * riga **dentro** il bundle, o essere trattata da una politica dichiarata.
 *
 * Serve perché il filtro è per `tenant_id`, e il `tenant_id` non è la stessa cosa della
 * raggiungibilità: una riga figlia può appartenere allo studio mentre il suo genitore no. Il
 * caso trovato: 9 permessi dell'amministratore di piattaforma (`tenant_id` nullo) e 15 documenti
 * caricati da super_admin o da un utente di un altro studio.
 *
 * Si ripete finché non è stabile, perché un `scarta` può orfanare dei nipoti (chi puntava a una
 * riga appena tolta). Un ciclo che non converge è un errore, non un caso da ignorare: le chiavi
 * esterne del database sono un grafo, e un grafo di riferimenti non deve avere cicli.
 */
async function chiudiChiusura(
  vecchio: PrismaClient,
  tabelle: Record<string, unknown[]>,
  log: (messaggio: string) => void,
): Promise<void> {
  const incluse = TABELLE.map((s) => s.tabella);
  // I nomi sono quelli della costante `TABELLE`, non dati esterni; la verifica ripete comunque
  // il controllo di `tab()` per non fidarsi di una convenzione.
  for (const nome of incluse) {
    if (!/^[a-z_]+$/.test(nome)) throw new Error(`Nome tabella non ammesso: ${nome}`);
  }
  const elenco = incluse.map((t) => `'${t}'`).join(', ');
  const chiavi = await vecchio.$queryRawUnsafe<
    Array<{ da: string; colonna: string; verso: string }>
  >(
    `SELECT tc.table_name AS da, kcu.column_name AS colonna, ccu.table_name AS verso
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND tc.table_name IN (${elenco})
      ORDER BY 1, 2`,
  );

  // Le colonne già azzerate per dichiarazione non hanno niente da verificare: sono tutte NULL.
  const giaAzzerate = new Set(
    TABELLE.flatMap((s) => (s.colonneDaAzzerare ?? []).map((c) => `${s.tabella}.${c.colonna}`)),
  );

  for (let giro = 1; giro <= 5; giro++) {
    let cambiato = false;
    const irrisolte: string[] = [];
    for (const { da, colonna, verso } of chiavi) {
      if (!incluse.includes(da) || giaAzzerate.has(`${da}.${colonna}`)) continue;
      const righe = tabelle[da] as Array<Record<string, unknown>> | undefined;
      if (!righe || righe.length === 0) continue;
      // `null` quando la tabella di destinazione non è copiata affatto: allora *ogni* valore
      // non nullo è orfano, non solo quelli che non trovano una riga.
      const padri = incluse.includes(verso)
        ? new Set(
            ((tabelle[verso] ?? []) as Array<Record<string, unknown>>).map((r) => String(r.id)),
          )
        : null;
      const rotte = righe.filter(
        (r) => r[colonna] != null && (padri === null || !padri.has(String(r[colonna]))),
      );
      if (rotte.length === 0) continue;

      const politica = POLITICHE_CHIUSURA.find((p) => p.tabella === da && p.colonna === colonna);
      if (!politica) {
        irrisolte.push(`${da}.${colonna} → ${verso}: ${rotte.length} righe senza genitore nel bundle`);
        continue;
      }
      if (politica.trattamento === 'azzera') {
        for (const r of rotte) r[colonna] = null;
      } else {
        // Si scartano per identità di riga: filtrare per valore toglierebbe anche righe che
        // quel valore ce l'hanno per un motivo diverso (e non è il caso di indovinare).
        const scartare = new Set<Record<string, unknown>>(rotte);
        tabelle[da] = righe.filter((r) => !scartare.has(r));
      }
      cambiato = true;
      log(
        `  ${da}.${colonna}: ${rotte.length} riferimenti senza genitore → ${politica.trattamento}` +
          `\n      ${politica.motivo}`,
      );
    }

    if (irrisolte.length > 0) {
      throw new Error(
        'Chiavi esterne rotte senza una politica dichiarata in POLITICHE_CHIUSURA:' +
          irrisolte.map((i) => `\n     ${i}`).join('') +
          '\n   L\'import annullerebbe la transazione per intero: si dichiara qui come trattarle.',
      );
    }
    if (!cambiato) return;
  }
  throw new Error('La chiusura delle chiavi esterne non converge dopo 5 giri: c\'è un ciclo.');
}

/** Nome dell'oggetto dentro un riferimento a file, quando è riconoscibile. */
function nomeFileDaRiferimento(valore: string): string | null {
  if (valore.startsWith('/uploads/')) {
    return valore.split('?')[0]!.slice('/uploads/'.length) || null;
  }
  const daSupabase = /\/storage\/v1\/object\/(?:public\/|sign\/)?bluman-documents\/([^?/]+)/.exec(valore);
  return daSupabase?.[1] ?? null;
}

/**
 * Il nome che il file avrà sul VPS: `<tenantId>_<timestamp>_<nome>`.
 *
 * Il prefisso del tenant non è decorativo. `GET /uploads/:filename` non ha una tabella di
 * registro: l'unica chiave che ha per negare a uno studio il file di un altro è il nome
 * (`tenantDaNomeFile`). I nomi sul vecchio database non lo dichiarano, quindi senza
 * prefisso ogni file copiato resterebbe leggibile da qualunque utente autenticato di
 * qualunque studio. Ricostruire la forma canonica `<tenant>_<timestamp>_<nome>` è ciò che
 * rende i file copiati indistinguibili da quelli caricati dal VPS.
 */
function nomeFileNuovo(tenantId: string, nomeOriginale: string): string {
  // Forma già canonica `<uuid>_<timestamp>_<nome>` oppure storica `<timestamp>_<nome>`.
  const conPrefisso = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(\d{10,})_(.+)$/.exec(
    nomeOriginale,
  );
  const storico = /^(\d{10,})_(.+)$/.exec(nomeOriginale);

  // `accorciaNomeFile` chiude il nome nel tetto che la rotta di lettura accetta: il prefisso
  // del tenant aggiunge 51 caratteri, quindi un nome d'origine lungo produrrebbe un file
  // depositato e irraggiungibile. Vale per tutte e tre le forme, non solo per l'ultima.
  if (conPrefisso) return accorciaNomeFile(`${tenantId}_${conPrefisso[2]}_${nomeFileSicuro(conPrefisso[3]!)}`);
  if (storico) return accorciaNomeFile(`${tenantId}_${storico[1]}_${nomeFileSicuro(storico[2]!)}`);
  // Forma non riconosciuta: si tiene il nome originale, sanificato. `nomeFileValido` lo
  // accetterebbe comunque, ma sanificare qui evita di costruire un nome che poi la rotta
  // rifiuterebbe con 400 — un file depositato e irraggiungibile.
  return accorciaNomeFile(`${tenantId}_${Date.now()}_${nomeFileSicuro(nomeOriginale)}`);
}

/**
 * Il riferimento da dare in pasto a `leggiFileArchivio`.
 *
 * Gli URL salvati in tabella sono **firmati e scaduti**. `leggiFileArchivio` li scarica così
 * come sono, e Supabase risponde 400: a contare è il token in query, non la service key. Il
 * file però c'è. Riscrivendo il riferimento nella forma **senza token** dello stesso bucket,
 * la service key lo legge via API autenticata — e il passo 0 ha già dimostrato che è così per
 * due documenti che altrimenti risultavano irrecuperabili (HTTP 400 con il token, 200 senza).
 */
function riferimentoLeggibile(riferimento: string): string {
  if (riferimento.startsWith('/uploads/')) return riferimento;
  const nome = nomeFileDaRiferimento(riferimento);
  const base = process.env.SUPABASE_URL;
  if (!nome || !base) return riferimento;
  return `${base.replace(/\/$/, '')}/storage/v1/object/bluman-documents/${nome}`;
}

interface FileDaCopiare {
  tabella: string;
  id: string;
  colonna: string;
  // Niente `riferimento`: per un file su Supabase sarebbe un URL firmato. Resta in memoria
  // solo il nome dell'oggetto, che è già nel nome del file scaricato.
  nomeVecchio: string;
  nomeNuovo: string;
  byte: number;
}

interface FileMancante {
  tabella: string;
  id: string;
  colonna: string;
  // Nessun `riferimento`: per un URL firmato quel campo conterrebbe il token, e questo
  // oggetto finisce nel bundle — che viene scritto su disco e copiato sul VPS. Un token di
  // Supabase non deve viaggiare. Il motivo dice già cosa è successo.
  motivo: string;
}

/**
 * Solo host e nome del database — **mai** utente o password.
 *
 * Serve a rendere evidente *quale* database si sta leggendo. Su questa macchina
 * `ADMIN_DATABASE_URL` punta al **vecchio** Bluecode, non al VPS: il nome della variabile
 * suggerisce il contrario, e se un giorno venisse ripuntata al VPS l'esportazione leggerebbe
 * il database sbagliato senza dire niente. Una riga di conferma toglie di mezzo il dubbio.
 */
function descriviDb(url: string, nome: string): string {
  try {
    const u = new URL(url);
    return `${nome} su ${u.hostname}`;
  } catch {
    return nome;
  }
}

async function main() {
  const argomenti = process.argv.slice(2);
  const indiceTenant = argomenti.indexOf('--tenant');
  const tenantId = indiceTenant >= 0 ? argomenti[indiceTenant + 1] : undefined;
  const indiceOut = argomenti.indexOf('--out');
  const cartellaOut = indiceOut >= 0 ? argomenti[indiceOut + 1]! : '.tmp-migrazione';

  if (!tenantId) {
    console.error('Uso: npx tsx src/scripts/esportaDaBluecode.ts --tenant <uuid> [--out <cartella>]');
    console.error('Senza --tenant non si esporta niente: quale studio copiare è una decisione, non un default.');
    process.exitCode = 1;
    return;
  }

  const url = process.env.VECCHIO_DATABASE_URL || process.env.ADMIN_DATABASE_URL;
  if (!url) {
    console.error('❌ Manca VECCHIO_DATABASE_URL (o ADMIN_DATABASE_URL) in .env.');
    process.exitCode = 1;
    return;
  }

  // `prismaAmministrativo()` non serve qui: quel client è legato al database NUOVO. Questo
  // script deve parlare col vecchio, quindi il client si costruisce a mano. È uno degli usi
  // ammessi dalla regola 1 (script di manutenzione), non una scorciatoia dentro una rotta.
  const vecchio = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Prima di esportare, accerta di poter vedere tutto. Con un ruolo che non scavalca la
    // RLS le policy filtrano e l'esportazione riuscirebbe **vuota senza errori** — la
    // stessa lezione di `verificaAccessi.ts`. Un bundle vuoto è peggio di un guasto.
    const [ruolo] = await vecchio.$queryRaw<
      Array<{ utente: string; superuser: boolean; bypassrls: boolean }>
    >`SELECT current_user AS utente, rolsuper AS superuser, rolbypassrls AS bypassrls
        FROM pg_roles
       WHERE rolname = current_user`;

    if (!ruolo || (!ruolo.superuser && !ruolo.bypassrls)) {
      console.error(`\n❌ Ruolo connesso: «${ruolo?.utente ?? 'sconosciuto'}».`);
      console.error('   Non scavalca la RLS, quindi le policy filtrano: esporterebbe zero righe');
      console.error('   senza dire niente. Nessuna esportazione.');
      process.exitCode = 1;
      return;
    }

    const [dbLetto] = await vecchio.$queryRaw<Array<{ nome: string }>>`
      SELECT current_database() AS nome`;

    // Nessun cast a `uuid`: Prisma mappa gli `String @id @default(uuid())` su **TEXT**, non sul
    // tipo `uuid` di PostgreSQL. Un `::uuid` qui non aiuta, rompe: `text = uuid` non ha
    // operatore e l'esportazione muore prima di leggere una sola riga.
    const [tenant] = await vecchio.$queryRaw<Array<{ ragione_sociale: string }>>`
      SELECT ragione_sociale FROM tenant WHERE id = ${tenantId}`;
    if (!tenant) {
      console.error(`❌ Nessuno studio con id ${tenantId} nel vecchio database.`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n=== Esportazione dello studio «${tenant.ragione_sociale}» (${tenantId}) ===`);
    console.log(`    database letto: ${descriviDb(url, dbLetto?.nome ?? '?')}\n`);

    // Le colonne dichiarate nelle specifiche (`colonneFile`, `colonneDaAzzerare`) si verificano
    // contro lo schema **prima** di usarle. Il piano dava per scontata una
    // `modello_documento_custom.file_url` che non esiste: una colonna inventata non è un
    // avviso, è un errore che abortisce l'import a transazione aperta. Meglio saperlo qui, dove
    // costa un messaggio invece di un collaudo.
    const colonneReali = new Set(
      (
        await vecchio.$queryRaw<Array<{ table_name: string; column_name: string }>>`
          SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public'`
      ).map((c) => `${c.table_name}.${c.column_name}`),
    );
    for (const spec of TABELLE) {
      const dichiarate = [
        ...(spec.colonneFile ?? []),
        ...(spec.colonneDaAzzerare ?? []).map((c) => c.colonna),
      ];
      for (const colonna of dichiarate) {
        if (!colonneReali.has(`${spec.tabella}.${colonna}`)) {
          throw new Error(
            `La specifica di «${spec.tabella}» dichiara la colonna «${colonna}», che nello schema non esiste.`,
          );
        }
      }
    }

    const tabelle: Record<string, unknown[]> = {};
    for (const spec of TABELLE) {
      // `json_agg` converte i tipi secondo il tipo riga della tabella: timestamp, uuid,
      // array e json escono nella forma che `json_populate_recordset` sa rileggere. Farlo
      // in Node significherebbe reimplementare quella conversione, e sbagliarla.
      const [esito] = await vecchio.$queryRawUnsafe<Array<{ righe: string }>>(
        `SELECT COALESCE(json_agg(t)::text, '[]') AS righe
           FROM (SELECT * FROM ${tab(spec.tabella)} WHERE ${spec.filtro}) t`,
        tenantId,
      );
      tabelle[spec.tabella] = JSON.parse(esito?.righe ?? '[]') as unknown[];
      console.log(`  ${spec.tabella.padEnd(30)} ${String(tabelle[spec.tabella]!.length).padStart(6)}`);
    }

    // L'azzeramento si fa **qui**, sulle righe già in memoria e non con un UPDATE sul vecchio
    // database: quello è in sola lettura, e resta tale. Azzerare dopo la lettura ottiene lo
    // stesso bundle senza toccare una riga di là.
    for (const spec of TABELLE) {
      for (const { colonna, motivo } of spec.colonneDaAzzerare ?? []) {
        let azzerate = 0;
        for (const riga of tabelle[spec.tabella]! as Array<Record<string, unknown>>) {
          if (riga[colonna] == null) continue;
          riga[colonna] = null;
          azzerate++;
        }
        if (azzerate > 0) {
          console.log(`  ${spec.tabella}.${colonna}: ${azzerate} riferimenti tolti — ${motivo}`);
        }
      }
    }

    // ── Chiusura: nessuna riga copiata può puntare a una riga non copiata ──────────────
    // È il controllo che la prova dell'import ha reso necessario: senza, la transazione si
    // annulla a metà e il messaggio parla di una chiave esterna, non di *quale* riga manca.
    console.log('\n  ── chiusura delle chiavi esterne ──');
    await chiudiChiusura(vecchio, tabelle, (m) => console.log(m));

    // ── File ────────────────────────────────────────────────────────────────────────
    // I file non si «copiano» dal database: stanno su Supabase Storage. Vanno scaricati
    // adesso, mentre le credenziali del vecchio archivio sono disponibili, e depositati
    // sul VPS, dove lo storage è solo locale (il compose di produzione non passa
    // SUPABASE_URL: `uploadDocumento` scrive sempre in `/app/uploads`).
    fs.mkdirSync(path.join(cartellaOut, 'file'), { recursive: true });

    const fileDaCopiare: FileDaCopiare[] = [];
    const fileMancanti: FileMancante[] = [];
    const riferimentiNonFile: Array<{ tabella: string; colonna: string; valore: string }> = [];
    // Solo per non scaricare due volte lo stesso oggetto. **Non** finisce nel bundle: è
    // indicizzata sull'URL vecchio, che per Supabase porta la firma.
    const mappaFile: Record<string, string> = {};
    // I nomi dei file da depositare nel volume sul VPS, senza duplicati.
    const fileDaDepositare = new Set<string>();

    for (const spec of TABELLE) {
      for (const colonna of spec.colonneFile ?? []) {
        for (const riga of tabelle[spec.tabella]! as Array<Record<string, unknown>>) {
          const valore = riga[colonna];
          if (typeof valore !== 'string' || valore.trim() === '') continue;
          const riferimento = valore.trim();
          const nomeVecchio = nomeFileDaRiferimento(riferimento);
          if (!nomeVecchio) {
            // Non tutti i valori di una colonna «file» sono file. In
            // `passaggio_progetto.documento_allegato_url` ci sono **slug di modello**
            // (`tmpl-cdd-persona-fisica`), in `tenant.logo_url` il percorso di un'immagine
            // statica dell'applicazione (`/logo.png`). Si copiano insieme alla loro riga: non
            // c'è niente da scaricare, e chiamarli «file mancanti» sarebbe un allarme falso.
            if (riferimento.startsWith('http') || riferimento.startsWith('/uploads/')) {
              fileMancanti.push({
                tabella: spec.tabella,
                id: String(riga.id),
                colonna,
                motivo: 'forma non riconosciuta',
              });
            } else {
              riferimentiNonFile.push({
                tabella: spec.tabella,
                colonna,
                // Solo valori che non possono contenere una firma: niente `?`, e corti.
                valore:
                  riferimento.length <= 80 && !riferimento.includes('?')
                    ? riferimento
                    : '(valore non mostrato)',
              });
            }
            continue;
          }

          // Il nome nuovo dipende solo da (tenant, nome dell'oggetto): due URL firmati
          // diversi dello stesso oggetto danno lo stesso nome, quindi lo stesso file si
          // scarica una volta sola e le righe che lo nominano sono tutte riscritte uguale.
          const nomeNuovo = mappaFile[nomeVecchio] ?? nomeFileNuovo(tenantId, nomeVecchio);
          if (!mappaFile[nomeVecchio]) {
            const contenuto = await leggiFileArchivio(riferimentoLeggibile(riferimento));
            if (!contenuto) {
              // Il caso atteso: i documenti caricati quando Supabase Storage falliva finivano
              // sul disco del container Railway (`/uploads/<nome>`), che è effimero. La riga
              // esiste, il file no. Si copia comunque la riga (decisione del titolare) e si
              // tiene l'elenco dei file mancanti.
              fileMancanti.push({
                tabella: spec.tabella,
                id: String(riga.id),
                colonna,
                motivo: riferimento.startsWith('/uploads/')
                  ? 'file sul disco locale del vecchio container (non su Supabase)'
                  : 'non raggiungibile su Supabase Storage',
              });
              continue;
            }
            fs.writeFileSync(path.join(cartellaOut, 'file', nomeNuovo), contenuto);
            mappaFile[nomeVecchio] = nomeNuovo;
            fileDaCopiare.push({
              tabella: spec.tabella,
              id: String(riga.id),
              colonna,
              nomeVecchio,
              nomeNuovo,
              byte: contenuto.length,
            });
            console.log(`  file  ${nomeVecchio} → ${nomeNuovo}  (${contenuto.length} byte)`);
          }
          // **La riga viene riscritta adesso**, non dall'import. Se il valore originale
          // restasse nel bundle, per un file su Supabase sarebbe un URL firmato: un token
          // scritto su disco e poi copiato sul VPS. Riscrivendo qui, il bundle contiene già la
          // forma definitiva `/uploads/<nome>` — la stessa che produce `uploadDocumento` sul
          // VPS, e che `rifirmaUrlUpload` rifirma alla lettura.
          riga[colonna] = `/uploads/${nomeNuovo}`;
          fileDaDepositare.add(nomeNuovo);
        }
      }
    }

    // ── Cosa resta fuori ────────────────────────────────────────────────────────────
    // L'elenco non è decorativo: se una tabella con `tenant_id` non è fra quelle copiate,
    // il suo contenuto non arriverà sul VPS. Dirlo qui, con i conteggi, è ciò che distingue
    // una copia parziale **voluta** da una copia che ha dimenticato qualcosa.
    const escluse = await vecchio.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
        ORDER BY c.table_name`,
    );
    const incluse = new Set(TABELLE.map((s) => s.tabella));
    const riepilogoEscluse: Array<{ tabella: string; righe: number }> = [];
    for (const { table_name } of escluse) {
      if (incluse.has(table_name) || !/^[a-z_]+$/.test(table_name)) continue;
      const [conteggio] = await vecchio.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM ${tab(table_name)} WHERE tenant_id = $1`,
        tenantId,
      );
      const n = Number(conteggio?.n ?? 0);
      if (n > 0) riepilogoEscluse.push({ tabella: table_name, righe: n });
    }

    const bundle = {
      generatoIl: new Date().toISOString(),
      tenantId,
      ragioneSociale: tenant.ragione_sociale,
      tabelle,
      // Le righe portano già la forma definitiva `/uploads/<nome>`; qui c'è solo l'elenco dei
      // file da depositare nel volume. **Nessun URL firmato entra nel bundle**, che viene
      // scritto su disco e poi copiato sul VPS.
      fileDaDepositare: [...fileDaDepositare],
      fileMancanti,
      riferimentiNonFile,
      tabelleEscluse: riepilogoEscluse,
    };
    const percorsoBundle = path.join(cartellaOut, 'bundle.json');
    fs.writeFileSync(percorsoBundle, JSON.stringify(bundle, null, 2));

    console.log(
      `\n  file copiati   : ${fileDaDepositare.size} distinti (${fileDaCopiare.reduce((s, f) => s + f.byte, 0)} byte)`,
    );
    console.log(`  file mancanti  : ${fileMancanti.length}`);
    console.log(`  bundle         : ${percorsoBundle}`);
    if (riepilogoEscluse.length > 0) {
      console.log('\n  ⚠ Tabelle con dati di questo studio NON incluse nella copia:');
      for (const e of riepilogoEscluse) console.log(`      ${e.tabella.padEnd(30)} ${String(e.righe).padStart(6)}`);
      console.log('    Se qualcuna serve, va aggiunta a TABELLE in questo script e si riesporta.');
    }
    if (riferimentiNonFile.length > 0) {
      const perColonna = new Map<string, number>();
      for (const r of riferimentiNonFile) {
        const k = `${r.tabella}.${r.colonna}`;
        perColonna.set(k, (perColonna.get(k) ?? 0) + 1);
      }
      console.log('\n  Colonne «file» che non contengono file (valori copiati così come sono):');
      for (const [k, n] of perColonna) {
        const esempio = riferimentiNonFile.find((r) => `${r.tabella}.${r.colonna}` === k)?.valore;
        console.log(`      ${k.padEnd(44)} ${String(n).padStart(3)}  es. «${esempio}»`);
      }
    }
    if (fileMancanti.length > 0) {
      console.log('\n  File non recuperabili (le righe di database si copiano comunque):');
      for (const f of fileMancanti) console.log(`      ${f.tabella}/${f.id.slice(0, 8)} ${f.colonna}: ${f.motivo}`);
    }
  } finally {
    await vecchio.$disconnect();
  }
}

main().catch((err) => {
  console.error('Esportazione fallita:', err instanceof Error ? err.message : err);
  process.exit(1);
});
