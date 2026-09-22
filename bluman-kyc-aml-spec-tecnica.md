# BluMan — Modulo KYC/AML
## Specifica tecnica per l'implementazione

**Versione:** 1.0
**Destinatario:** team di sviluppo
**Stack di riferimento:** React 19 + Vite + Fastify + Prisma (TypeScript/Node.js)

---

## 1. Obiettivo e contesto

BluMan gestisce oggi il KYC/AML in modo "passivo": i campi anagrafici (`rischioAml`, `ubo`, `dataKyc`, `fontePatrimonio`) esistono ma non guidano né vincolano alcun processo. Un incarico può essere aperto, un contratto firmato, un'operazione straordinaria avviata anche con un fascicolo KYC scaduto o mai iniziato.

Per uno studio soggetto al **D.Lgs. 231/2007** (adeguata verifica della clientela, artt. 17-25) l'adeguata verifica non è un campo opzionale ma un obbligo con sanzioni. L'obiettivo di questo modulo è trasformare il KYC/AML da campo descrittivo a **processo governato, proporzionato al rischio e il più possibile automatizzato**, per non aggravare il carico dell'operatore.

### 1.1 Riferimenti normativi

- **D.Lgs. 231/2007** e successive modifiche (adeguata verifica ordinaria/semplificata/rafforzata, conservazione decennale ex art. 31, titolare effettivo).
- **Registro dei Titolari Effettivi** presso le Camere di Commercio (operativo; fonte primaria per i dati UBO, da preferire alla ridigitazione manuale).
- **Regolamento (UE) 2024/1624 "AMLR"** e **Direttiva (UE) 2024/1640 "AMLD6"**: applicazione diretta in tutti gli Stati UE dal **10 luglio 2027**; le regole di accesso al registro titolari effettivi sono anticipate al **10 luglio 2026**. L'Italia ha già recepito l'art. 74 AMLD6 (registro UBO) con D.Lgs. 210/2025.
- **Nota di design**: il data model va costruito già oggi con la nomenclatura e le distinzioni previste dall'AMLR (livelli di adeguata verifica, PEP, beneficiario effettivo), per evitare una migrazione dati importante nel 2027.

### 1.2 Principio guida dell'implementazione

**Approccio risk-based, non uniforme.** La normativa non chiede di sottoporre ogni cliente allo stesso identico iter: chiede di calibrare la verifica al rischio. Questo è anche il principale strumento di semplificazione operativa: un motore di scoring automatico deve instradare la maggioranza dei clienti a basso rischio verso un percorso leggero, e concentrare il lavoro dell'operatore solo sui casi che lo richiedono davvero.

---

## 2. Architettura del modulo

Quattro componenti:

- **A. Modello dati** (Prisma / database)
- **B. Motore di rischio** (scoring automatico, servizio backend)
- **C. Portale Cliente** (onboarding self-service)
- **D. Dashboard Studio** (coda di lavoro, revisione, gate operativo)
- **E. Automazioni** (cron, notifiche, integrazioni esterne)

---

## 3. Modulo A — Modello dati (Prisma)

> **Nota di allineamento al repo (da recepire in fase di implementazione):** lo schema BluMan
> usa `@default(uuid())` per tutte le chiavi (non `cuid()`), e sul modello `Cliente` esistono
> già `rischioAml`, `ubo`, `fontePatrimonio`, `dataKyc` (oggi stringhe descrittive). Il nuovo
> `FascicoloKyc` è la fonte di verità del processo: quei quattro campi vanno o migrati dentro il
> fascicolo o mantenuti come proiezione di sola lettura, mai come secondo stato divergente.

### 3.1 Tabella `FascicoloKyc`

```prisma
model FascicoloKyc {
  id                String            @id @default(cuid())
  tenantId          String
  clienteId         String

  stato             StatoKyc          @default(bozza)
  livelloVerifica   LivelloVerifica   @default(ordinaria)   // determinato dal motore, non dall'operatore
  rischioCalcolato  LivelloRischio    @default(basso)
  punteggioRischio  Int               @default(0)           // score numerico, per audit e tuning del motore

  pep               Boolean           @default(false)
  paeseRischio      String?
  paeseResidenza    String?

  fonteVerificaUbo  FonteUbo          @default(autodichiarazione)
  uboVerificatoIl   DateTime?

  dataVerifica      DateTime?
  dataScadenza      DateTime?         // 12 mesi standard, 6 mesi se rafforzata
  approvatoDa       String?           // userId operatore/compliance
  approvatoIl       DateTime?
  noteCompliance    String?

  soglieOperazione  Decimal?          // valore economico dell'operazione che ha generato l'obbligo, se applicabile

  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  documenti         DocumentoKyc[]
  storico           StoricoFascicoloKyc[]
  overrideLog       OverrideKyc[]

  @@index([tenantId, clienteId])
  @@index([stato, dataScadenza])
}

enum StatoKyc {
  bozza
  in_attesa_revisione
  approvato
  respinto
  scaduto
}

enum LivelloVerifica {
  semplificata
  ordinaria
  rafforzata
}

enum LivelloRischio {
  basso
  medio
  alto
}

enum FonteUbo {
  registro_camerale      // preferita: dato recuperato via API da Registro Titolari Effettivi / visura
  autodichiarazione       // fallback: dichiarazione diretta del cliente
}
```

**Nota di design:** non sovrascrivere mai un fascicolo esistente in caso di rinnovo. Ogni ciclo di verifica crea una nuova riga (o una nuova versione via `storico`), mantenendo la storia completa per l'audit trail decennale (art. 31 D.Lgs. 231/2007).

### 3.2 Tabella `StoricoFascicoloKyc`

Traccia ogni cambio di stato, con attore e timestamp. Append-only, mai modificabile né cancellabile lato applicativo.

```prisma
model StoricoFascicoloKyc {
  id             String    @id @default(cuid())
  fascicoloId    String
  fascicolo      FascicoloKyc @relation(fields: [fascicoloId], references: [id])
  statoPrecedente StatoKyc
  statoNuovo      StatoKyc
  attoreUserId    String
  motivazione     String?
  createdAt       DateTime @default(now())
}
```

### 3.3 Tabella `OverrideKyc`

Separata dal fascicolo. L'override deve essere **sempre motivato e sempre tracciato**: è il primo elemento che un ispettore (GdF/UIF) controlla in verifica.

```prisma
model OverrideKyc {
  id            String    @id @default(cuid())
  fascicoloId   String
  fascicolo     FascicoloKyc @relation(fields: [fascicoloId], references: [id])
  attoreUserId  String
  azioneSbloccata String  // es. "emissione_contratto", "avanzamento_progetto"
  motivazione   String    // campo obbligatorio, non nullable
  createdAt     DateTime  @default(now())
}
```

### 3.4 Tabella `DocumentoKyc`

```prisma
model DocumentoKyc {
  id            String    @id @default(cuid())
  fascicoloId   String
  fascicolo     FascicoloKyc @relation(fields: [fascicoloId], references: [id])
  tipo          TipoDocumentoKyc
  urlStorage    String    // percorso su storage cifrato
  caricatoDa    String    // userId o "cliente" via portale
  createdAt     DateTime  @default(now())
}

enum TipoDocumentoKyc {
  documento_identita
  documento_ubo
  visura_camerale
  autodichiarazione_fondi
  altro
}
```

### 3.5 Vincoli di conservazione e sicurezza dati

- Conservazione minima **10 anni** dalla cessazione del rapporto (art. 31 D.Lgs. 231/2007): nessun cron di pulizia automatica deve mai cancellare fascicoli, documenti o log entro questo periodo.
- I documenti d'identità e UBO sono dati personali particolari ai fini GDPR: storage cifrato at-rest, accesso solo a ruoli autorizzati, log di ogni lettura del documento (non solo delle modifiche).

---

## 4. Modulo B — Motore di rischio (il cuore della semplificazione)

Questo è il componente che elimina la maggior parte del lavoro manuale ripetitivo. Va eseguito automaticamente ad ogni creazione/rinnovo fascicolo, **prima** di qualunque intervento umano.

### 4.1 Logica di assegnazione livello (pseudocodice)

```
funzione calcolaLivelloVerifica(cliente, operazione):
    se cliente.tipo in [PA, societa_quotata, ente_vigilato_UE]:
        ritorna "semplificata"

    se cliente.pep == true:
        ritorna "rafforzata"

    se cliente.paeseResidenza in listaPaesiAltoRischio (GAFI/UE aggiornata):
        ritorna "rafforzata"

    se operazione.valore > sogliaConfigurata:
        ritorna "rafforzata"

    se rapporto.modalita == "senza_presenza_fisica" AND assente_SPID_CIE:
        ritorna "rafforzata"

    altrimenti:
        ritorna "ordinaria"
```

- La lista paesi ad alto rischio va mantenuta come tabella configurabile (`PaeseRischio`), aggiornabile da un amministratore senza deploy, con fonte GAFI/lista UE.
- Le soglie economiche vanno parametrizzate per tenant (non hardcoded), perché possono differire tra studi/attività.

### 4.2 Conseguenze operative per livello

| Livello | Revisione umana | Documenti richiesti | Scadenza |
|---|---|---|---|
| Semplificata | Nessuna (auto-approvato) | Dati anagrafici + autodichiarazione | 24 mesi |
| Ordinaria | Un operatore | Documento + UBO (precompilato) + questionario breve | 12 mesi |
| Rafforzata | **Doppia approvazione** (operatore + Responsabile Compliance) | Documento + UBO + origine fondi dettagliata | 6 mesi |

### 4.3 Integrazione dati esterni (per ridurre l'input manuale)

- **API Registro Imprese / visura camerale**: dato P.IVA, recupero automatico di ragione sociale, sede legale, amministratori, titolari effettivi dal Registro dei Titolari Effettivi. Popola `FascicoloKyc.fonteVerificaUbo = registro_camerale`.
- **Screening PEP e liste sanzionatorie** (OFAC, liste UE, ONU): chiamata automatica al salvataggio dell'anagrafica, non azione manuale dell'operatore.
- **Adverse media check**: solo per fascicoli con `livelloVerifica in [ordinaria, rafforzata]`, per non appesantire inutilmente i casi semplificati.

Tutte queste integrazioni vanno progettate come servizi disaccoppiati (interfaccia comune `ProviderVerificaEsterna`) in modo da poter sostituire il fornitore (es. cambio provider di screening PEP) senza toccare la logica di dominio.

---

## 5. Modulo C — Portale Cliente

Attraversato **solo** dai fascicoli di livello ordinario o rafforzato (i semplificati sono auto-approvati e non richiedono interazione del cliente oltre ai dati base).

### 5.1 Step del wizard

1. **Dati identificativi**: precompilati da visura camerale dove disponibile; il cliente conferma o corregge.
2. **Titolare effettivo (UBO)**: precompilato dal Registro Titolari Effettivi; se il dato non è disponibile, richiesta dichiarazione diretta (fallback).
3. **Questionario antiriciclaggio breve**: origine del patrimonio, scopo dell'operazione, PEP sì/no (auto-verificabile ma da confermare).
4. **Caricamento documento di riconoscimento** (fronte/retro) + codice fiscale.
5. **Firma del modulo di adeguata verifica via OTP**, riusando l'infrastruttura FEA già presente in BluMan.

Per il livello **rafforzata**: step aggiuntivo di dichiarazione dettagliata sull'origine dei fondi, con possibilità di allegare documentazione di supporto (es. atto di provenienza, buste paga, bilanci).

### 5.2 Requisiti UX

- Ogni campo precompilato va mostrato come tale (badge "verificato da Registro Imprese"), distinguendolo visivamente da quanto dichiarato dal cliente.
- Barra di progresso persistente: il cliente deve poter interrompere e riprendere senza perdere dati.
- Notifica automatica (email/WhatsApp) di conferma ricezione al termine del wizard.

---

## 6. Modulo D — Dashboard Studio (Backend & Frontend Staff)

### 6.1 Coda di lavoro prioritizzata (non solo badge)

L'operatore non deve dover cercare i fascicoli da trattare: la dashboard presenta una coda ordinata per priorità:

1. Fascicoli scaduti o in scadenza entro 15 giorni con livello rafforzato.
2. Fascicoli in attesa di revisione (ordinaria).
3. Fascicoli in scadenza entro 30 giorni (ordinaria).
4. Fascicoli semplificati (solo in sola lettura, per verifica a campione, non richiedono azione).

### 6.2 Badge di stato cliente

- 🟢 KYC regolare (scadenza > 30 gg)
- 🟡 In scadenza (< 30 gg) o da revisionare
- 🔴 Scaduto / non eseguito / non conforme

### 6.3 Pannello di revisione

- Vista affiancata: documento caricato + dati precompilati dal Registro Imprese, per un confronto rapido (non serve leggere il documento riga per riga se i dati coincidono già).
- Un click per validare il titolare effettivo quando la fonte è `registro_camerale` (fiducia alta).
- Approvazione più articolata (con note obbligatorie) quando la fonte è `autodichiarazione` o il livello è rafforzato.

### 6.4 Approvazione massiva (bulk approve)

Per i fascicoli con `livelloVerifica = ordinaria` e `punteggioRischio` sotto una soglia configurabile, la dashboard permette selezione multipla e approvazione in un'unica azione — con log individuale per ciascun fascicolo (non un log aggregato).

### 6.5 Segregazione dei ruoli (four-eyes principle)

- Livello **semplificata**: nessuna revisione umana.
- Livello **ordinaria**: un operatore, diverso da chi ha eventualmente caricato il fascicolo per conto del cliente.
- Livello **rafforzata**: doppia approvazione obbligatoria — operatore + ruolo `ResponsabileCompliance`. Il sistema deve impedire che lo stesso utente ricopra entrambi i ruoli sullo stesso fascicolo.

### 6.6 KYC Gate operativo

- **Wizard nuovo progetto**: se il cliente selezionato ha `stato != approvato` o `dataScadenza < oggi`, mostrare banner bloccante (non solo avviso) prima di proseguire.
- **Firma contratti**: blocco duro sull'invio alla firma se il fascicolo non è conforme, salvo override.
- **Override**: richiede compilazione obbligatoria di `OverrideKyc.motivazione` e genera notifica automatica al Responsabile Compliance (non solo un log silenzioso).

---

## 7. Modulo E — Automazioni (cron, notifiche)

Estensione del `cronService.ts` esistente.

### 7.1 Scadenzario proattivo

- **T-30 giorni** dalla scadenza: notifica interna all'operatore assegnato + invito automatico al cliente (email/WhatsApp) con link diretto al portale.
- **T-15 giorni**: sollecito, escalation al Responsabile Compliance se nessuna azione registrata.
- **T-0 (scaduto)**: stato fascicolo passa automaticamente a `scaduto`, badge cliente diventa 🔴, gate si attiva sui nuovi progetti.

### 7.2 Rivalutazione periodica del rischio

Oltre alla scadenza documentale, prevedere un trigger di **rivalutazione del rischio** (non solo rinnovo documenti) quando cambiano condizioni rilevanti: variazione UBO rilevata dal Registro Imprese, ingresso in lista PEP, operazione che supera soglia. Questo va oltre la bozza iniziale ma è richiesto dal principio di adeguata verifica continua (art. 18 D.Lgs. 231/2007).

---

## 8. Fasi di rilascio

| Fase | Contenuto | Note per lo sviluppo |
|---|---|---|
| **Fase 1 — Motore + stati** | Modello dati (§3), motore di rischio (§4) senza integrazioni esterne (regole statiche), badge in `AnagraficaErpModal`. Nessun blocco. | Base per misurare l'impatto del motore prima di collegare API esterne. |
| **Fase 2 — Integrazioni dati** | Collegamento API Registro Imprese/visura, screening PEP/liste automatico. | Prioritaria rispetto al portale: è ciò che riduce di più il lavoro manuale. |
| **Fase 3 — Portale Cliente** | Wizard §5, firma OTP, solo per livelli ordinario/rafforzato. | Riuso infrastruttura FEA esistente. |
| **Fase 4 — Dashboard e Gate selettivo** | Coda prioritizzata, approvazione massiva, four-eyes su rafforzato, hard gate su contratti/progetti. | Il gate va attivato per ultimo, dopo aver validato che il motore di rischio non generi troppi falsi positivi. |
| **Fase 5 — Automazioni e rivalutazione continua** | Cron scadenzario, rivalutazione su variazione UBO/PEP. | Richiede che Fase 2 sia stabile (dipende dai dati esterni). |

---

## 9. Criteri di accettazione (esempi)

- Un cliente PA creato in BluMan riceve automaticamente `livelloVerifica = semplificata` e nessuna azione è richiesta all'operatore.
- Un cliente PMI italiana con P.IVA valida vede UBO precompilato dal Registro Imprese senza che il cliente debba reinserirlo manualmente.
- Un tentativo di invio alla firma di un contratto con fascicolo scaduto viene bloccato, salvo override motivato e loggato.
- Un override genera una notifica al Responsabile Compliance entro la stessa giornata lavorativa.
- Nessun fascicolo, documento o log viene eliminato prima di 10 anni dalla cessazione del rapporto, nemmeno da operazioni di pulizia dati o richieste di cancellazione GDPR (da gestire con anonimizzazione parziale, non cancellazione, ove in conflitto con l'obbligo di conservazione).

---

## 10. Punti aperti da chiarire con il team

- Provider da usare per: screening PEP/liste sanzionatorie, adverse media, API Registro Imprese/visura camerale (verificare costi e SLA).
- Soglie economiche configurabili per tenant: valore di default da proporre.
- Modalità di anonimizzazione dei dati oltre il periodo di conservazione obbligatoria (post 10 anni).
