# Specifica Funzionale e Tecnica
## Piattaforma di Gestione Tariffario, Moduli Dinamici, Portale Cliente e Firma Documenti

---

## 1. Obiettivo del sistema

Realizzare una piattaforma che colleghi:
- un **tariffario** (articoli/servizi con prezzo e descrizione),
- ogni articolo scomposto in **microvoci** operative con un proprio percorso di acquisizione dati,
- un **portale cliente** dove seguire lo stato della pratica, visionare e firmare i documenti prodotti,
- un **motore di firma multicanale** (OTP email/WhatsApp/Telegram, oppure firma autografa/digitale esterna),
- uno **storico immutabile** di ogni transazione, con persistenza totale su database (nessun dato transiente fuori DB).

---

## 2. Entità principali

| Entità | Descrizione |
|---|---|
| **Articolo** | Voce di tariffario: codice, descrizione, prezzo (fisso/variabile), categoria, IVA |
| **Microvoce** | Sotto-lavorazione collegata a un Articolo. Definisce: descrizione del lavoro, tipo di acquisizione dati richiesta, form associato, eventuale automazione |
| **Modulo/Form dinamico** | Struttura a campi (testo, file, checkbox, firma) associata a una Microvoce, versionata |
| **Pratica** | Fascicolo che aggrega una o più Microvoci scelte per un cliente. È il contenitore dello stato di avanzamento |
| **Documento** | Output generato (da template + dati raccolti), versionato, con stato proprio (bozza/pubblicato/in revisione/firmato) |
| **Richiesta di modifica** | Feedback del cliente su un Documento pubblicato, con testo libero e riferimento alla versione |
| **Firma** | Evento di sottoscrizione: canale, provider, timestamp, hash del documento, esito |
| **Storico/Audit log** | Registrazione append-only di ogni evento di sistema (chi, cosa, quando, da dove) |
| **Utente Operatore** | Backoffice, gestisce tariffario, microvoci, pratiche, pubblica documenti |
| **Utente Cliente** | Accede al portale, compila form, visiona/scarica/firma documenti, chiede modifiche |

---

## 3. Flusso di processo end-to-end

```
1. OPERATORE seleziona Articolo dal tariffario
   └─ Sistema mostra le Microvoci collegate (ciascuna con il proprio form)

2. ACQUISIZIONE DATI
   a) Operatore compila direttamente il form della Microvoce, oppure
   b) Sistema genera un LINK UNIVOCO (token) da inviare al cliente
      (email / WhatsApp / Telegram) per compilazione autonoma

3. CLIENTE compila il form via link
   └─ Dati salvati su DB, stato Pratica → "dati acquisiti"
   └─ Evento registrato in Storico

4. OPERATORE valida i dati e genera il Documento (da template)
   └─ Stato Documento: "bozza"

5. OPERATORE pubblica il Documento sul portale cliente
   └─ Stato Documento: "in revisione cliente"
   └─ Notifica al cliente (email/WhatsApp/Telegram)

6. CLIENTE visiona il Documento (anteprima PDF) e sceglie:

   RAMO A - Richiede modifiche
      └─ Inserisce commento/richiesta
      └─ Stato Documento → "modifica richiesta"
      └─ Torna al punto 4 (nuova versione, versioning incrementale)

   RAMO B - Procede alla firma
      6.1 Firma OTP (email / WhatsApp / Telegram)
          └─ Firma Elettronica Semplice (SES)
      6.2 Download PDF/Word per firma esterna
          └─ Firma autografa (scansione/upload) oppure
          └─ Firma digitale tramite provider del cliente
              (SPID, CNS, firma remota qualificata)
          └─ Cliente carica il documento firmato

7. Sistema registra la Firma (hash del file, timestamp, canale, IP, esito)
   └─ Stato Documento → "firmato"
   └─ Stato Pratica → "completata"

8. Tutto il percorso (dati, versioni, notifiche, firme) resta
   consultabile nello Storico della Pratica, in modo cronologico
   e non modificabile (append-only).
```

---

## 4. Nota importante sulla firma elettronica

Ai fini della validità legale in Italia/UE è opportuno distinguere chiaramente nel sistema:

- **Firma Elettronica Semplice (SES)** — es. OTP via email/WhatsApp/Telegram: valore probatorio liberamente valutabile dal giudice (art. 20 CAD), adatta a documenti a basso rischio contenzioso.
- **Firma Elettronica Avanzata (FEA)** — richiede requisiti tecnici precisi: identificazione univoca del firmatario, controllo esclusivo del mezzo di firma, collegamento univoco ai dati firmati, rilevabilità di modifiche successive. Un semplice OTP via chat/email **non basta** a qualificarsi come FEA senza ulteriori misure (es. identity verification, certificato di sessione, log crittografici).
- **Firma Elettronica Qualificata (FEQ)** — SPID/CNS/CIE o certificato qualificato, massima efficacia probatoria (equiparata alla firma autografa).

Suggerimento architetturale: il sistema dovrebbe **etichettare esplicitamente** ogni documento firmato con il tipo di firma utilizzata, e permettere all'operatore di scegliere/imporre il livello richiesto in base al tipo di documento (es. contratto vs. semplice presa visione).

---

## 5. Modello dati (schema DB indicativo)

```
articoli
├─ id, codice, descrizione, prezzo, unita_misura, iva, categoria, attivo

microvoci
├─ id, articolo_id (FK), descrizione_lavoro, tipo_acquisizione_dati,
│  form_id (FK), ordine, obbligatoria

form_template
├─ id, microvoce_id (FK), versione, schema_campi (JSON), attivo

form_risposte
├─ id, form_template_id (FK), pratica_id (FK), dati (JSON),
│  compilato_da (operatore/cliente), data_compilazione

pratiche
├─ id, cliente_id (FK), stato, data_apertura, data_ultima_modifica

pratica_microvoci
├─ id, pratica_id (FK), microvoce_id (FK), stato, form_risposta_id (FK)

documenti
├─ id, pratica_id (FK), versione, stato, template_id (FK),
│  file_pdf_path, file_docx_path, hash_contenuto, data_pubblicazione

richieste_modifica
├─ id, documento_id (FK), cliente_id (FK), testo, data_richiesta, stato

firme
├─ id, documento_id (FK), tipo_firma (SES/FEA/FEQ), canale (email/whatsapp/telegram/upload),
│  provider, otp_verificato, hash_documento_firmato, ip, user_agent, timestamp, esito

link_accesso
├─ id, pratica_id (FK) / microvoce_id (FK), token, canale_invio,
│  scadenza, utilizzato, data_creazione

storico_eventi (audit log, append-only)
├─ id, pratica_id (FK), tipo_evento, entita_riferimento, payload (JSON),
│  attore (operatore/cliente/sistema), timestamp
```

---

## 6. Macchina a stati

**Pratica:** `aperta → dati_in_acquisizione → dati_acquisiti → documento_in_bozza → pubblicata → in_revisione_cliente → [modifica_richiesta ↺] → firmata → completata`

**Documento:** `bozza → pubblicato → in_revisione → modifica_richiesta → ripubblicato → firmato → archiviato`

**Firma:** `richiesta → otp_inviato → otp_verificato → completata` (ramo SES)
oppure `richiesta → documento_scaricato → firmato_esterno_caricato → verificato → completata` (ramo upload)

---

## 7. Considerazioni tecniche

- **Persistenza totale su DB**: nessuno stato applicativo vive solo in memoria o in sessione; ogni transizione scrive prima nello storico, poi aggiorna lo stato corrente (pattern event-sourcing "light").
- **Versionamento documenti**: ogni ripubblicazione crea una nuova riga in `documenti`, mai un update distruttivo — la cronologia delle versioni è così naturale.
- **Link univoci con token**: scadenza configurabile, mono-uso o multi-uso a seconda del contesto, tracciati in `link_accesso`.
- **Notifiche multicanale**: astrarre un servizio di notifica con provider intercambiabili (email/SMTP, WhatsApp Business API, Telegram Bot API).
- **Generazione documento**: motore di template (es. Docxtemplater/Carbone per Word, poi conversione PDF) che unisce dati di `form_risposte` con il template dell'Articolo/Microvoce.
- Se questo modulo si affianca alla piattaforma **BluMan** già in sviluppo (multi-tenant, Prisma/Fastify), può riutilizzarne l'architettura multi-tenant e il modello a moduli/dipendenze (DAG) già progettato, trattando ogni Microvoce come un "modulo" del catalogo esistente.

---

## 8. Prossimi passi suggeriti

1. Validare/affinare lo schema campi dei form dinamici (tipi di campo supportati).
2. Definire i template Word/PDF per ciascun Articolo.
3. Scegliere i provider per OTP (email/WhatsApp Business API/Telegram Bot) e per firma qualificata (se richiesta).
4. Disegnare le API REST (CRUD articoli/microvoci, generazione link, upload firma, webhook di stato).
5. Prototipo del portale cliente (visualizzazione stato pratica + area firma).
