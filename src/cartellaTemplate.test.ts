/**
 * §41 — presidio della cartella modelli dello studio.
 *
 * Due rischi, entrambi già avvenuti in questo programma, e per questo presidiati qui.
 *
 * Il primo è l'attestazione inventata. Uno stato di revisione dice «questa carta l'ha riletta
 * qualcuno»: se un'approvazione resta appesa a un testo modificato dopo, l'elenco mostra una
 * garanzia che nessuno ha dato — ed è peggio di nessuna garanzia, perché ferma i controlli.
 * Lo stesso vale per il modello di serie, che non ha una riga in questo studio e quindi non può
 * avere uno stato: «bozza» al suo posto sarebbe un giudizio attribuito allo studio.
 *
 * Il secondo è la libreria che sta nel browser. Prima di §41 l'elenco dei modelli si costruiva
 * da tre chiavi di `localStorage`: un modello creato dal titolare non compariva su nessun altro
 * computer, l'archiviazione valeva per un solo browser, e svuotare la cache faceva sparire la
 * libreria dello studio (regole 3 e 7). Con quell'elenco veniva inventato anche l'id
 * (`tmpl-custom-<timestamp>`), che il server scartava: archiviare o eliminare «quel» modello
 * lato server non poteva funzionare per costruzione.
 *
 * `vitest.config.ts` esclude `frontend/**` dai test: quei file non si eseguono qui, ma si
 * leggono. Gli asserti strutturali passano da `soloCodice`, così i commenti che raccontano il
 * difetto — e che nominano le chiavi rimosse — non fanno fallire il presidio che li protegge.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { soloCodice } from './util/soloCodice.js';
import {
  STATI_REVISIONE,
  statoRevisioneValido,
  etichettaStato,
  decidiRevisione,
  effettoModifica,
  descriviRevisione,
  descriviDecadenza,
} from './services/revisioneModello.js';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const leggi = (percorso: string) => soloCodice(readFileSync(join(RADICE, percorso), 'utf8'));

describe('§41 — lo stato di revisione ammette solo valori che esistono', () => {
  it('gli stati sono tre, e nient\'altro passa', () => {
    expect([...STATI_REVISIONE]).toEqual(['bozza', 'in_revisione', 'approvato']);
    expect(statoRevisioneValido('approvato')).toBe(true);
    expect(statoRevisioneValido('APPROVATO')).toBe(false);
    expect(statoRevisioneValido('validato')).toBe(false);
    expect(statoRevisioneValido(null)).toBe(false);
    expect(statoRevisioneValido(undefined)).toBe(false);
    expect(statoRevisioneValido(1)).toBe(false);
  });

  it('un valore non valido è 400 e nomina i valori ammessi, senza stato da scrivere', () => {
    // Il campo è una stringa a database: senza questo controllo un `stato: 'validato'` finirebbe
    // sulla riga, e l'interfaccia mostrerebbe «Stato non disponibile» su un modello che qualcuno
    // credeva di aver approvato.
    const esito = decidiRevisione('bozza', 'validato');
    expect(esito.ok).toBe(false);
    expect(esito.codice).toBe(400);
    expect(esito.errore).toContain('bozza, in_revisione, approvato');
    expect(esito.stato).toBeUndefined();
  });

  it('riscrivere lo stesso stato è un rifiuto, non un salvataggio a vuoto', () => {
    // Ripassare «approvato» su un modello già approvato sovrascriverebbe data e nome di chi
    // aveva deciso davvero, e scriverebbe nel registro un cambio mai avvenuto.
    const esito = decidiRevisione('approvato', 'approvato');
    expect(esito.ok).toBe(false);
    expect(esito.codice).toBe(400);
    expect(esito.errore).toContain('Approvato');
    expect(esito.stato).toBeUndefined();
  });

  it('tutti i passaggi fra stati diversi sono ammessi, compreso il ritorno in bozza', () => {
    // Un testo approvato può diventare obsoleto per una circolare: negare il ritorno in bozza
    // costringerebbe a duplicare il modello per correggerlo, e lo storico si spezzerebbe in due.
    for (const da of STATI_REVISIONE) {
      for (const a of STATI_REVISIONE) {
        if (da === a) continue;
        expect(decidiRevisione(da, a)).toEqual({ ok: true, stato: a });
      }
    }
  });
});

describe('§41 — un\'approvazione vale sul testo approvato', () => {
  it('se il testo di un modello approvato cambia, l\'approvazione decade e la versione sale', () => {
    expect(effettoModifica({ statoAttuale: 'approvato', versioneAttuale: 2, contenutoCambiato: true })).toEqual({
      stato: 'bozza',
      versione: 3,
      approvazioneDecaduta: true,
    });
  });

  it('un salvataggio che non cambia il testo non tocca né stato né versione', () => {
    // Correggere la descrizione o il livello di firma non rimette in discussione il testo: far
    // decadere l'approvazione qui vorrebbe dire farla decadere per un refuso in una nota.
    expect(effettoModifica({ statoAttuale: 'approvato', versioneAttuale: 4, contenutoCambiato: false })).toEqual({
      stato: 'approvato',
      versione: 4,
      approvazioneDecaduta: false,
    });
  });

  it('un modello in revisione che cambia resta in revisione: non c\'è nulla che decada', () => {
    expect(effettoModifica({ statoAttuale: 'in_revisione', versioneAttuale: 1, contenutoCambiato: true })).toEqual({
      stato: 'in_revisione',
      versione: 1,
      approvazioneDecaduta: false,
    });
  });

  it('la versione conta le approvazioni superate, non i salvataggi', () => {
    // Tre modifiche a un modello in bozza lasciano la versione a 1: «v1» significa «mai
    // approvato», non «salvato una volta».
    let stato = 'bozza';
    let versione = 1;
    for (let i = 0; i < 3; i++) {
      const effetto = effettoModifica({ statoAttuale: stato, versioneAttuale: versione, contenutoCambiato: true });
      stato = effetto.stato;
      versione = effetto.versione;
    }
    expect({ stato, versione }).toEqual({ stato: 'bozza', versione: 1 });
  });

  it('uno stato o una versione fuori posto ripiegano su bozza v1, non su un errore', () => {
    // La colonna è una stringa con default: una riga scritta da una migrazione futura o da una
    // correzione a mano può portare qualunque cosa. Ripiegare su «bozza» è l'unica lettura che
    // non attribuisce allo studio un giudizio che non ha dato.
    expect(effettoModifica({ statoAttuale: 'validato', versioneAttuale: 0, contenutoCambiato: true })).toEqual({
      stato: 'bozza',
      versione: 1,
      approvazioneDecaduta: false,
    });
    expect(effettoModifica({ statoAttuale: '', versioneAttuale: Number.NaN, contenutoCambiato: false }).versione).toBe(1);
  });
});

describe('§41 — il registro dice cosa è cambiato e perché', () => {
  it('la frase nomina lo stato di partenza, quello di arrivo e il motivo scritto', () => {
    const frase = descriviRevisione({ titolo: 'Lettera d\'Incarico', da: 'bozza', a: 'approvato', note: '  riletta col titolare  ' });
    expect(frase).toContain('«Lettera d\'Incarico»');
    expect(frase).toContain('da Bozza a Approvato');
    expect(frase).toContain('motivo: «riletta col titolare»');
  });

  it('senza motivo non si inventa un motivo', () => {
    const frase = descriviRevisione({ titolo: 'NDA', da: 'approvato', a: 'in_revisione', note: '   ' });
    expect(frase).not.toContain('motivo');
    expect(frase).toContain('da Approvato a In revisione');
  });

  it('la decadenza si spiega da sé nel registro, con la versione nuova', () => {
    const frase = descriviDecadenza('Statuto Holding', 3);
    expect(frase).toContain('«Statuto Holding»');
    expect(frase).toContain('modificato dopo l\'approvazione');
    expect(frase).toContain('versione 3');
  });

  it('gli stati hanno un nome leggibile: in elenco non compare `in_revisione`', () => {
    expect(etichettaStato('in_revisione')).toBe('In revisione');
    expect(etichettaStato('approvato')).toBe('Approvato');
    expect(etichettaStato('bozza')).toBe('Bozza');
  });
});

describe('§41 — le rotte dei modelli restano dentro il proprio studio', () => {
  const codice = leggi('src/routes/modelliDocumento.ts');

  it('nessuna scrittura parte dall\'id della richiesta: prima si rilegge la riga col tenant', () => {
    // RLS isola gli studi fra loro (regola 1), ma il `where` col tenant serve comunque: un id
    // di un altro studio senza di esso produrrebbe un errore Prisma invece di un 404 chiaro, e
    // la difesa applicativa non deve dipendere da quale ruolo di database si è connesso.
    expect(codice).not.toMatch(/where:\s*\{\s*id\s*\}/);
    const scrittureMediate = codice.match(/modelloDocumentoCustom\.(?:update|delete)\(\{\s*where:\s*\{\s*id:\s*attuale\.id\s*\}/g) ?? [];
    // PUT, PATCH revisione, PATCH archiviazione, DELETE: quattro scritture, quattro riletture.
    expect(scrittureMediate).toHaveLength(4);
    const letture = codice.match(/modelloDocumentoCustom\.find(?:First|Many)\(\{\s*\n?\s*where:\s*\{\s*(?:id,\s*)?tenantId/g) ?? [];
    // GET elenco, PUT, revisione, archiviazione, adotta, ricorsa P2002, DELETE: sette letture.
    expect(letture).toHaveLength(7);
  });

  it('ogni riga nuova nasce col tenant scritto sopra', () => {
    const create = codice.match(/modelloDocumentoCustom\.create\(\{\s*\n?\s*data:\s*\{\s*\n?\s*tenantId,/g) ?? [];
    expect(create).toHaveLength(2); // creazione da zero e adozione di un modello di serie
  });

  it('il token di un cliente non apre la cartella dei modelli dello studio', () => {
    // Sono le carte interne dello studio, non i documenti del cliente: RLS isola i tenant, non
    // i clienti dai modelli. Sette rotte, sette sbarramenti.
    expect(codice.match(/ruolo === 'cliente'/g) ?? []).toHaveLength(7);
  });

  it('ogni gesto lascia traccia con il nome vero di chi lo ha fatto', () => {
    // `recordAudit` senza `userNome` attribuisce l'operazione a «Sistema / Operatore»: un
    // registro che non sa chi ha approvato una carta non è una traccia. Il nome non sta nel
    // token, quindi si rilegge dall'utenza.
    expect(codice.match(/recordAudit\(\{/g) ?? []).toHaveLength(6);
    expect(codice.match(/userNome:/g) ?? []).toHaveLength(6);
    expect(codice).toContain('async function nomeOperatore(');
    expect(codice).toMatch(/prisma\.user\.findFirst\(\{ where: \{ id: userId \}, select: \{ nome: true \} \}\)/);
  });

  it('un guasto di lettura non diventa «lo studio non ha modelli»', () => {
    // Era la forma precedente: `catch` che risponde `[]`. Il vuoto e il silenzio sono due cose
    // diverse e vanno dette diverse (regola 7).
    expect(codice).not.toMatch(/send\(\[\]\)/);
    expect(codice).toContain("Errore lettura modelli documento");
  });

  it('lo stato di revisione lo decide il servizio presidiato, non la rotta', () => {
    expect(codice).toContain('decidiRevisione(');
    expect(codice).toContain('effettoModifica(');
    // Nessun elenco di stati duplicato nella rotta: sarebbero due posti da cambiare insieme.
    expect(codice).not.toMatch(/\['bozza',\s*'in_revisione'/);
  });

  it('quando l\'approvazione decade, il nome di chi l\'aveva data non resta sulla riga', () => {
    // Lasciarlo lo farebbe sembrare l'autore di un'approvazione su un testo che non ha visto.
    expect(codice).toMatch(/revisionatoDaUserId:\s*null,\s*\n\s*revisionatoDaNome:\s*null,\s*\n\s*revisionatoAt:\s*null,\s*\n\s*noteRevisione:\s*null,/);
    expect(codice).toContain("azione: 'MODELLO_DOCUMENTO_APPROVAZIONE_DECADUTA'");
  });

  it('l\'adozione di un modello di serie non produce due copie', () => {
    // Il vincolo unico (tenant_id, riferimento_serie) regge la corsa fra due operatori; la
    // rotta rilegge la riga vincente invece di restituire un errore incomprensibile.
    expect(codice).toContain("codice === 'P2002'");
    expect(codice).toContain('giaAdottato: true');
  });

  it('le rotte sono registrate nel server e non sono più in `documenti.ts`', () => {
    const server = leggi('src/server.ts');
    expect(server).toContain('registraRotteModelliDocumento(server)');
    // Regola 8: lo spostamento è avvenuto, non è una copia in due posti.
    expect(leggi('src/routes/documenti.ts')).not.toContain('/documenti-template');
  });
});

describe('§41 — la migrazione aggiunge senza toccare i dati esistenti', () => {
  const sql = readFileSync(
    join(RADICE, 'prisma/migrations/20260831120000_revisione_modelli_documento/migration.sql'),
    'utf8',
  );

  it('solo ADD COLUMN: nessuna colonna cancellata e nessun backfill', () => {
    // Regola 2. Un `DROP` o un `UPDATE` qui riscriverebbe righe reali dello studio durante il
    // deploy, che si applica da solo all'avvio del container.
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)/i);
    expect(sql).not.toMatch(/\bUPDATE\s+"/i);
    expect(sql).toMatch(/ALTER TABLE "modello_documento_custom"/);
  });

  it('i modelli che esistevano restano in bozza v1: nessuno li ha riletti', () => {
    expect(sql).toMatch(/"stato_revisione"[\s\S]{0,80}DEFAULT\s+'bozza'/i);
    expect(sql).toMatch(/"versione"[\s\S]{0,60}DEFAULT\s+1/i);
  });

  it('il vincolo che rende idempotente l\'adozione c\'è', () => {
    expect(sql).toMatch(/UNIQUE INDEX[\s\S]{0,120}"tenant_id",\s*"riferimento_serie"/i);
  });
});

describe('§41 — il frontend non tiene più la libreria nel browser', () => {
  const modelli = leggi('frontend/src/utils/documentTemplates.ts');
  const hook = leggi('frontend/src/hooks/useCartellaTemplate.ts');
  const badge = leggi('frontend/src/components/ui/BadgeRevisione.tsx');
  const libreria = leggi('frontend/src/components/editor/LibreriaTemplate.tsx');
  const cartella = leggi('frontend/src/pages/CartellaModelliPage.tsx');

  it('le due chiavi che governavano archiviazione ed eliminazione non sono più lette', () => {
    // Restano nominate nei commenti che spiegano il difetto: `soloCodice` le esclude, ed è il
    // motivo per cui questo presidio non vieta di raccontare cosa è stato corretto.
    expect(modelli).not.toContain('bluman_archived_template_ids');
    expect(modelli).not.toContain('bluman_deleted_template_ids');
  });

  it('l\'elenco parte dai modelli letti dal server, non da `localStorage`', () => {
    expect(modelli).toContain('export function impostaModelliStudio(');
    expect(modelli).toMatch(/const studio = modelliStudio \?\? \[\];/);
    // L'unica lettura di localStorage che resta sui modelli serve a mostrare i residui da
    // recuperare: sono modelli di questo computer, e la cartella lo dichiara.
    expect(modelli).toContain('soloLocale: true');
  });

  it('un modello di serie non riceve uno stato che nessuno gli ha dato', () => {
    expect(modelli).toMatch(/diSerie: true,\s*\n\s*statoRevisione: null,/);
    expect(badge).toContain("modello.diSerie ? 'serie'");
    expect(badge).toContain('Stato non disponibile');
    // La targhetta non deve poter dire «Bozza» di una carta di serie.
    expect(badge).not.toMatch(/statoRevisione \|\| 'bozza'/);
  });

  it('nessun id di modello viene più inventato dal browser', () => {
    // Era `tmpl-custom-${Date.now()}`: la POST non lo mandava, il database ne generava un altro,
    // e da quel momento archiviare o eliminare «quel» modello lato server non poteva funzionare.
    expect(modelli).not.toContain('tmpl-custom');
    expect(modelli).toMatch(/id: '',/);
    for (const percorso of [
      'frontend/src/pages/DocumentEditorPage.tsx',
      'frontend/src/components/library/ArticoliCatalogView.tsx',
      'frontend/src/components/library/NuovoArticoloModal.tsx',
      'frontend/src/components/library/LibreriaDocumentiEForm.tsx',
    ]) {
      expect(leggi(percorso), percorso).not.toContain('tmpl-custom');
    }
  });

  it('le vecchie funzioni che salvavano nel browser non esistono più', () => {
    expect(modelli).not.toContain('export function saveCustomTemplate');
    expect(modelli).not.toContain('export function importTemplatesFromJson');
    expect(modelli).toContain('export function leggiModelliDaJson(');
  });

  it('il hook è l\'unico posto che scrive, e non tocca `localStorage`', () => {
    expect(hook).not.toContain('localStorage');
    // Prima il server, poi l'elenco: la copia di lavoro si aggiorna con la riga che il server
    // ha risposto (`daApi(riga)`), mai con quella costruita in pagina.
    expect(hook.match(/registraModelloStudio\(modello\)/g) ?? []).toHaveLength(5);
    expect(hook).not.toMatch(/registraModelloStudio\((?!modello\))/);
  });

  it('un gesto che non riesce non dice «salvato»', () => {
    // Regola 7. Ogni gesto ha il suo `catch` che riferisce cosa è andato storto e lascia
    // l'elenco com'era: lettura, creazione, modifica, revisione, adozione, archiviazione,
    // eliminazione (rifiuto sulle carte di serie e guasto di rete) e importazione.
    expect(hook.match(/return \{\s*\n?\s*ok: false,/g) ?? []).toHaveLength(9);
    expect(hook).toContain('NON salvato');
    expect(hook).toContain('NON riuscita');
    // L'importazione conta i modelli ARRIVATI a database, non quelli che erano nel file.
    expect(hook).toMatch(/if \(esito\.ok && esito\.modello\) \{\s*\n\s*salvati\+\+;/);
  });

  it('la libreria di Document Studio mostra lo stato invece della vecchia targhetta morta', () => {
    // `id.startsWith('tmpl-custom')` non poteva più essere vero con gli id di database: la
    // targhetta «Custom» era codice morto che occupava il posto dell'informazione utile.
    expect(libreria).not.toContain("startsWith('tmpl-custom')");
    expect(libreria).not.toContain('Custom');
    expect(libreria).toContain('<BadgeRevisione modello={t} compatto />');
    // «Elimina» solo dove c'è una riga da eliminare: sulle carte di serie il server rifiuta.
    expect(libreria).toMatch(/\{!t\.diSerie && !soloLocale && \(/);
  });

  it('la cartella dichiara quando l\'elenco potrebbe essere incompleto', () => {
    for (const [nome, sorgente] of [['cartella', cartella], ['libreria', libreria]] as const) {
      expect(sorgente, nome).toContain('erroreLettura');
      expect(sorgente, nome).toContain('Elenco possibilmente incompleto');
    }
    // I residui di questo browser si portano a database su richiesta, e finché non lo si fa
    // restano segnalati: sparire in silenzio sarebbe una perdita di dati non dichiarata.
    expect(cartella).toContain('recuperaModelliLocali');
  });

  it('Document Studio pesca dalla cartella, e la cartella lo apre sul modello scelto', () => {
    const editor = leggi('frontend/src/pages/DocumentEditorPage.tsx');
    expect(editor).toContain('useCartellaTemplate()');
    expect(cartella).toMatch(/navigate\(`\/documents\?tmplId=\$\{esito\.modello\.id\}`\)/);
    // Il modello chiesto nell'indirizzo si applica dopo la lettura dell'elenco: al primo
    // disegno la cartella non è ancora arrivata, e senza questo l'editor mostrerebbe il testo
    // di un modello mentre la libreria evidenzia un altro.
    expect(editor).toContain('modelloDaUrlApplicato');
    expect(editor).toMatch(/if \(!cartella\.letto\) return;/);
  });
});
