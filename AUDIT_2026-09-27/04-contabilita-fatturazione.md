# 04 — Contabilità & fatturazione

> Auditor senior — 27/09/2026. Area: contabilità, fatturazione & ciclo fiscale.
> Metodo: lettura del codice reale (`file:riga`), `.agents/AGENTS.md` usato solo come mappa.
> Perimetro letto: `src/routes/contabilita*.ts`, `src/routes/liquidazioneIva.ts`, `src/routes/solleciti.ts`,
> `src/services/fatturaEngine.ts`, `lipeEngine.ts`, `sdiXmlGenerator.ts`, `mappaturaFatturaSdi.ts`,
> `fatturaPassivaParser.ts`, `sollecitiEngine.ts`, `src/adapters/prisma/prismaApp.ts#emettiFattura`,
> `prisma/schema.prisma` + migrazioni della numerazione.

---

## Come funziona & logica applicata

### Modello dati e stati
La tabella `Fattura` (`prisma/schema.prisma:890`) tiene sia le fatture (`serie` `FT`, `tipoDocumento` `fattura`)
sia le note di credito (`serie` `NC`, `tipoDocumento` `nota_credito`). Stati: `bozza` → `emessa` → `incassata`,
più `annullata` (fattura stornata al 100% da una NC). Le NC nascono già `emessa`. Le righe stanno in `FatturaRiga`,
le rate in `ScadenzaIncasso`, gli incassi in `RegistrazioneIncasso`, i movimenti di cassa in `MovimentoPrimaNota`,
le fatture d'acquisto in `FatturaRicevuta`, le liquidazioni in `LiquidazioneIva`.

### Ciclo attivo
1. **Bozza** — `POST /invoices` (`contabilitaFatture.ts:53`). Calcolo fiscale con `calcolaTotaliFattura`
   (`fatturaEngine.ts:77`): imponibile per riga con sconto → cassa previdenziale proporzionale → IVA per
   gruppo (aliquota+natura) → ritenuta d'acconto → bollo virtuale €2 se operazioni esenti > €77,47
   (`fatturaEngine.ts:70-72,185`). Tutto in **centesimi interi** con `Math.round`. Numero provvisorio
   `BOZZA-<serie>-<n>`. La creazione gira in `$transaction` **Serializable** + `riprovaSuConflitto`
   (`contabilitaFatture.ts:96-178`) che ritenta anche su P2002.
2. **Emissione** — `POST /invoices/:id/emetti` (`contabilitaFatture.ts:326`). Assegna il progressivo ufficiale
   `max(numeroProgressivoSerie tra le non-bozza della serie)+1` e il numero legale `FT-<anno>/<NNN>`
   (`formattaNumeroDocumento`, `fatturaEngine.ts:351`), genera lo scadenzario (`generaPianoScadenze`,
   `fatturaEngine.ts:211`) secondo `condizionePagamento`, tutto in transazione Serializable.
3. **Immutabilità fiscale** — `assertFatturaModificabile` (`fatturaEngine.ts:340`) blocca modifica/eliminazione
   di qualunque documento non-`bozza`.
4. **Incasso** — `POST /invoices/scadenze/:id/incassi` (`contabilitaScadenzario.ts:47`): una sola transazione
   Serializable registra l'incasso, aggiorna stato rata (`parziale`/`incassato`), promuove la fattura a
   `incassata` se tutte le rate sono saldate, scrive il movimento in Prima Nota e incrementa il saldo del conto.
   Guardie robuste: no incasso su fattura `annullata`, no incasso su rata `stornata`, tetto all'over-incasso
   (`contabilitaScadenzario.ts:81,88,99`).

### Numerazione legale
Indice **UNIQUE parziale** `fattura_emesse_tenant_serie_prog_key` su `(tenant_id, serie, numero_progressivo_serie)
WHERE stato <> 'bozza'` (`prisma/migrations/20260915203000_unique_numerazione_fatture_emesse/migration.sql`).
Le bozze condividono progressivi provvisori; l'unicità vige solo sulle emesse. La concorrenza è gestita da
Serializable + retry su P2034/P2002.

### Note di credito / storni (il punto sensibile segnalato in memoria)
`POST /invoices/:id/nota-credito` (`contabilitaFatture.ts:448`) — logica **rivista il 21/09/2026** e oggi solida:
- **Totale** (nessuna riga selezionata o selezione che copre tutto): NC su tutte le righe, fattura → `annullata`,
  rate aperte → `stornata` (terminale), e se la fattura era incassata scrive un rimborso in Prima Nota
  (`contabilitaFatture.ts:603-629`).
- **Parziale** (selezione righe): totali **ricalcolati** dalle sole righe stornate, fattura resta viva, rate
  aperte ridotte in proporzione al netto stornato via `ripartisciStornoScadenze` (`fatturaEngine.ts:301`), che
  ripartisce sui residui e assegna il resto d'arrotondamento alla rata più capiente (nessun centesimo perso).
- Guardia `motivo=annullo_totale` incompatibile con parziale (`contabilitaFatture.ts:498`).
- Le guardie di incasso impediscono la «resurrezione» di una fattura annullata.

### IVA / LIPE / F24
`calcolaLiquidazioneIvaPeriodo` (`lipeEngine.ts:136`): somma IVA a debito dalle fatture attive del periodo
(per data), **esclude le bozze** e le operazioni **split payment**; le **note di credito entrano con segno
negativo** nel loro periodo di emissione (`lipeEngine.ts:158-170`). La fattura annullata **non** viene esclusa
(concorre nel suo periodo, lo storno lo fa la NC): scelta corretta per competenza. IVA a credito dagli acquisti
(`FatturaRicevuta`). Saldo, codici tributo F24 mensili 6001-6012 / trimestrali 6031-6034 (`lipeEngine.ts:99`).
Rotte in `liquidazioneIva.ts`: calcola / salva (upsert per `(tenant, periodo)`) / marca-versata (con eventuale
movimento in Prima Nota).

### SDI FatturaPA
`generaFatturaElettronicaXml` (`sdiXmlGenerator.ts:92`) produce l'XML 1.2 (TD01/TD04, ritenuta, cassa, bollo,
pagamento, fatture collegate). La mappatura DB→XML è centralizzata in `costruisciDatiFatturaSdi`
(`mappaturaFatturaSdi.ts:139`), con `DatiRiepilogo` raggruppato per (aliquota, natura) e natura N* solo su
aliquota 0. Trasmissione preparata manualmente (`contabilitaCron.ts:28` → `sdiService.ts`). Ciclo passivo:
`parseXmlFatturaPassiva` (`fatturaPassivaParser.ts:34`) con scorporo IVA da `DatiRiepilogo`.

### Prima Nota, contratti ricorrenti, solleciti
Prima Nota (`contabilitaPrimaNota.ts`): CRUD movimenti, import CSV estratto conto con matching cliente. Retainer
(`contabilitaContratti.ts`): `POST /contratti-ricorrenti/:id/genera-fattura` emette il canone in transazione
Serializable e avanza `prossimaFatturazione`. Solleciti (`solleciti.ts` + `sollecitiEngine.ts`): interessi di
mora ex D.Lgs 231/2002, saggio annuo + €40 forfettari.

---

## Rilievi d'audit

### [ALTA] Gate KYC aggirabile dalla rotta di emissione «da progetto»
La rotta `/invoices` blocca la fatturazione di un cliente con pratica KYC non approvata quando il modulo
Compliance è attivo (`contabilitaFatture.ts:70-78`, `operativitaBloccataDaKyc`). Ma l'emissione alternativa
`POST /progetti/:id/fatture` (`contabilitaRegistro.ts:35`) passa da `app.emettiFattura`
(`src/adapters/prisma/prismaApp.ts:679`) che **non** esegue alcun controllo KYC: crea direttamente la fattura in
stato `emessa`.
- **Impatto**: un operatore può emettere una fattura verso un cliente bloccato dall'AML semplicemente usando la
  scheda progetto invece del registro fatture — il presidio di compliance è bypassabile.
- **Rimedio**: spostare il gate KYC in un punto comune a entrambe le strade (dentro `emettiFattura` o in un hook
  condiviso), oppure replicare il controllo in `contabilitaRegistro.ts` prima di chiamare `app.emettiFattura`.

### [ALTA] Riepilogo IVA per SDI ricostruito da IVA per-riga: reintroduce lo scarto di arrotondamento
`calcolaRiepilogoIvaDaRighe` somma le `ivaCentesimi` **già arrotondate per riga** (`mappaturaFatturaSdi.ts:108`),
mentre `totaleIvaCentesimi` (e quindi `totaleDocumentoCentesimi` → `ImportoTotaleDocumento`) è calcolato dal
motore sull'imponibile **di gruppo** (`fatturaEngine.ts:162-176`, con commento B1 che spiega proprio perché non
si sommano i per-riga). Con più righe alla stessa aliquota, `DatiRiepilogo/Imposta` dell'XML può divergere di
±1 cent da `ImportoTotaleDocumento − ImponibileImporto`.
- **Impatto**: incoerenza Imponibile/Imposta/Totale nell'XML → scarto/rifiuto SDI (codice 00423 e simili), proprio
  la classe di errore che il motore evitava internamente ma che la mappatura SDI reintroduce.
- **Rimedio**: nel riepilogo SDI ricalcolare `Imposta` per gruppo dall'imponibile aggregato (stesso algoritmo del
  motore) invece di sommare le `ivaCentesimi` per-riga; oppure persistere `totaleIvaCentesimi` di gruppo per
  aliquota e usarlo qui.

### [MEDIA-ALTA] `PUT /invoices/:id` non è atomico: `deleteMany` + `update` fuori transazione
La modifica bozza cancella le righe con `prisma.fatturaRiga.deleteMany(...)` (`contabilitaFatture.ts:236`) e poi
esegue `prisma.fattura.update(...)` in una **chiamata separata** (`contabilitaFatture.ts:238`). Non c'è
`$transaction`, nonostante il commento a riga 235 dichiari «in transazione».
- **Impatto**: se l'`update` fallisce (validazione, conflitto, crash), le righe originali sono già perdute e la
  bozza resta senza righe. Perdita dati silenziosa.
- **Rimedio**: avvolgere `deleteMany` + `update` in un unico `prisma.$transaction`.

### [MEDIA] `saldoAttuale` del conto aggiornato in modo incoerente (due fonti di verità)
Alcune scritture aggiornano `contoBancario.saldoAttuale`, altre no:
- Incasso rata: **incrementa** (`contabilitaScadenzario.ts:156-168`). ✔
- Movimento manuale POST / DELETE Prima Nota: **aggiorna** (`contabilitaPrimaNota.ts:127-133,236-242`). ✔
- Rimborso da NC totale su fattura incassata: crea il movimento `uscita` ma **non** decrementa il saldo
  (`contabilitaFatture.ts:615-628`). ✘
- Versamento F24 IVA (marca-versata): crea il movimento ma **non** decrementa il saldo
  (`liquidazioneIva.ts:231-245`). ✘
- Import CSV estratto conto: crea i movimenti ma **non** tocca il saldo (`contabilitaPrimaNota.ts:187-200`). ✘

Inoltre la Prima Nota espone un saldo calcolato come `Σentrate − Σuscite` sui movimenti
(`contabilitaPrimaNota.ts:75`), che è un **numero diverso** da `contoBancario.saldoAttuale`.
- **Impatto**: il saldo del conto diverge progressivamente dalla realtà (sovrastimato dopo rimborsi NC, versamenti
  F24 e import); due indicatori di liquidità in disaccordo.
- **Rimedio**: decidere un'unica fonte di verità (preferibile: saldo derivato dai movimenti) o rendere coerente
  ogni scrittura di movimento con l'aggiornamento del saldo.

### [MEDIA] Import CSV estratto conto: importi/date/CRO inventati sulle righe non parsabili
In `POST /prima-nota/import-csv`: `const importoNum = parseFloat(rawImporto) || 100.0;`
(`contabilitaPrimaNota.ts:180`) crea un movimento da **€100** quando l'importo è vuoto/malformato; data e CRO
hanno fallback fabbricati (`contabilitaPrimaNota.ts:178,198`) e ogni positivo è categorizzato `incasso_fattura`.
- **Impatto**: righe spazzatura del CSV entrano in contabilità come movimenti reali con importo inventato →
  quadratura di cassa falsata, difficile da individuare a posteriori.
- **Rimedio**: scartare (o segnalare) le righe non parsabili invece di sostituire €100; validare importo/data e
  restituire un report righe-scartate.

### [MEDIA] LIPE ignora l'esigibilità IVA «differita»
`calcolaLiquidazioneIvaPeriodo` esclude solo lo split payment (`lipeEngine.ts:160`); le fatture con
`esigibilitaIva='differita'` (IVA per cassa / esigibilità differita) concorrono al debito IVA nel periodo di
**emissione** invece che in quello di **incasso**. Il campo `differita` esiste ed è mappato nell'XML SDI
(`mappaturaFatturaSdi.ts:80`) e nel parser passivo (`fatturaPassivaParser.ts:81`), quindi è un caso previsto.
- **Impatto**: se lo studio emette fatture a esigibilità differita, versa l'IVA prima di averla incassata
  (liquidazione anticipata, errata per competenza).
- **Rimedio**: per le fatture `differita` includere l'IVA a debito nel periodo dell'incasso (legare la quota IVA
  alle `RegistrazioneIncasso`), non alla data documento. **Da confermare col titolare se il regime è usato.**

### [MEDIA] Numerazione senza reset annuale, ma numero con anno
Il progressivo è `max(numeroProgressivoSerie)+1` per serie **senza filtro sull'anno** in tutte e tre le strade di
emissione (`contabilitaFatture.ts:346-350` fatture, `468-472` NC; `prismaApp.ts:732-736`), mentre il numero legale
mostra l'anno: `FT-<anno>/<NNN>` (`fatturaEngine.ts:351-355`). Il 1° gennaio il primo documento sarà
`FT-2027/159` (continua dal 2026), non `FT-2027/001`. L'indice UNIQUE è `(tenant, serie, prog)` senza componente
anno.
- **Impatto**: la numerazione continua è ammessa dall'AdE, ma la resa `anno/NNN` suggerisce un azzeramento annuale
  che non avviene (potenziale contestazione/confusione). Se in futuro si volesse il reset per anno, l'indice
  attuale genererebbe collisioni (2026/001 vs 2027/001).
- **Rimedio**: decidere la convenzione con il titolare; se si vuole il reset annuale, filtrare il `max` per anno e
  includere l'anno nell'indice UNIQUE.

### [BASSA-MEDIA] `emettiFattura` (via `POST /progetti/:id/fatture`) non atomico e fiscalmente povero
`emettiFattura` legge `lastFattura` e poi `create` **fuori** da `$transaction` (`prismaApp.ts:732,781`),
affidandosi all'indice UNIQUE parziale + retry P2002 (`contabilitaRegistro.ts:42-51`) — accettabile per
l'unicità, ma: ignora cassa/ritenuta/bollo (li forza a 0/false, `prismaApp.ts:764-766,799-807`), forza
`condizionePagamento='bonifico_30gg'` e una rata unica. Le fatture emesse da questa strada sono meno complete di
quelle di `/invoices` e non passano dal motore `calcolaTotaliFattura`.
- **Impatto**: incoerenza fra i due canali di emissione (oltre al bypass KYC già segnalato); una fattura con
  cassa/ritenuta emessa da qui esce sbagliata.
- **Rimedio**: far confluire anche questa strada nel motore fiscale unico e nella transazione Serializable.

### [BASSA-MEDIA] Eliminazione movimento incasso non ripristina stato rata/fattura
`DELETE /prima-nota/:id` (`contabilitaPrimaNota.ts:225`) decrementa il saldo ed elimina il movimento, ma **non**
riporta indietro lo stato della `ScadenzaIncasso`/`Fattura` collegata (che resta `incassato`/`incassata`).
- **Impatto**: dopo la cancellazione del movimento d'incasso, la fattura risulta ancora incassata pur essendo
  sparito il denaro → partita chiusa a torto.
- **Rimedio**: se il movimento è un `incasso_fattura` con `fatturaId`, riaprire rata/fattura (o vietare la delete
  su movimenti generati da un incasso, imponendo lo storno dal flusso incassi).

### [BASSA-MEDIA] Parser fattura passiva fragile su namespace e lotti multi-body
`parseXmlFatturaPassiva` usa regex `<Tag>...</Tag>` (`fatturaPassivaParser.ts:28-32`): non gestisce prefissi di
namespace (`<ns:Denominazione>`, comuni negli XML SDI reali) e somma **tutti** i `DatiRiepilogo` del file, mentre
estrae un solo `CedentePrestatore` (caso lotto multi-fattura). `IdCodice` viene preso dal blocco cedente ma può
provenire da `IdFiscaleIVA`.
- **Impatto**: import di fatture d'acquisto con dati parziali o errati (fornitore/imponibile/IVA), quindi IVA a
  credito LIPE sbagliata.
- **Rimedio**: parser XML vero (namespace-aware) e iterazione per `FatturaElettronicaBody`.

### [BASSA] Saggio di mora fisso e non semestrale
`SAGGIO_MORA_DEFAULT_PERCENTUALE = 12.0` costante (`sollecitiEngine.ts:61`); interessi su base 365 fissa
(`sollecitiEngine.ts` formula `C*r*t/365`). Il tasso ex art. 5 D.Lgs 231/2002 è «tasso BCE + 8 punti» e cambia
ogni semestre (decreto MEF). I €40 forfettari (`SPESE_FORFETTARIE_RECUPERO_CENT=4000`) sono corretti.
- **Impatto**: interessi di mora calcolati con un tasso potenzialmente disallineato dal saggio legale vigente.
- **Rimedio**: rendere il saggio configurabile per semestre (tabella) con default aggiornato; il parametro
  `saggioAnnuo` è già iniettabile, manca la fonte aggiornata.

### [BASSA] XML SDI con dati sede cedente segnaposto
`costruisciDatiFatturaSdi` non riempie `Provincia`/`CAP`/`Comune` del cedente dai dati studio (passa solo
`sedeLegale` come `Indirizzo`), e il generatore usa default `Via Roma 1 / 00100 / Roma / RM`
(`sdiXmlGenerator.ts:134-138`) quando mancano.
- **Impatto**: XML formalmente valido ma con sede legale fittizia se l'anagrafica studio è incompleta.
- **Rimedio**: validare l'anagrafica studio prima dell'export SDI e mappare i campi sede reali.

---

## Domande aperte / da verificare col titolare

1. **Numerazione**: si vuole numerazione **continua** (attuale, `FT-2027/159`) o **reset annuale**
   (`FT-2027/001`)? La scelta cambia sia il calcolo del progressivo sia l'indice UNIQUE.
2. **Esigibilità differita**: lo studio emette/riceve fatture a esigibilità IVA differita (IVA per cassa)? Se sì,
   la LIPE va corretta per legare l'IVA all'incasso.
3. **Fonte di verità del saldo di cassa**: `contoBancario.saldoAttuale` (running balance) o somma dei movimenti
   di Prima Nota? Oggi coesistono e divergono.
4. **Canale «fattura da progetto»** (`POST /progetti/:id/fatture`): è ancora un flusso in uso o legacy? Va
   allineato al motore fiscale e al gate KYC, oppure dismesso.
5. **Split payment**: l'esclusione dal debito IVA periodico presume clienti PA con scissione dei pagamenti;
   confermare che sia l'unico caso d'uso di `esigibilitaIva='split'`.
6. **Saggio di mora**: si concorda un valore semestrale aggiornato (BCE+8) o si mantiene un tasso convenzionale
   fisso per i solleciti?
7. **Conservazione a norma / trasmissione SDI**: la trasmissione è «preparazione + invio manuale»; confermare che
   la conservazione sostitutiva decennale è affidata al commercialista/provider esterno e non attesa dal software.
