# PIANO — BluMan

Obiettivo: correggere i difetti emersi dalla diagnosi del 02/11/2026 (permessi, importi, dati inventati,
sicurezza), poi mettere ordine in documentazione e codice.
Fuori scope: nuove funzioni del backlog del titolare (LAVORO_RIMANENTE.md: fornitore KYC, goAML…).
Riferimento: diagnosi del 02/11/2026 (codici A, F, D, M, N).

## Standard — adozione (17/11/2026)
- [~] S.1 Adozione sul fork: regole, workflow, script comuni, documenti, bot e secret (PR di adozione)
- [ ] S.2 Primo giro sul pilota: una PR normale passa CI sul runner «ci», revisore e merge da soli; schedule di sentinella e riepilogo abilitati sul fork
- [ ] S.3 Prima pubblicazione con `scripts/pubblica.sh`: PR verso upstream, misurare che Railway e Vercel pubblichino (il manuale dice che il deploy Vercel da webhook resta BLOCKED)
- [ ] S.4 Chiusura adozione: «da verificare» di docs/adozione-standard.md chiusi; documenti del titolare in radice → docs/storico (con lui: rimandi di README, manuale e credenziali.test.ts; sostituisce 5.1 e 5.2)

## Fase 0 — Preparazione
- [x] 0.1 CI verificata: verde; la X rossa su GitHub è il deploy Vercel da push (bloccato per scelta)
- [x] 0.2 Copia locale C:\Progetti\bluman allineata, typecheck/test/build verdi (02/11)
- [ ] 0.3 CLAUDE.md, PIANO.md, .claude/settings.json — modello: Sonnet
- [ ] 0.4 Verificare che il JWT_SECRET di produzione non sia quello che era in docs/storico/analisi.txt:310 (D2; valore rimosso dal file, si legge con `git show 25237740:analisi.txt`) — a mano

## Fase 1 — Permessi
- [ ] 1.1 PUT /tenant/utenti/:userId/permessi solo advisor/super_admin, body zod, transazione, audit completo (A1) — modello: Opus
- [ ] 1.2 Mappa RBAC: kyc, fornitori, fatture-ricevute, liquidazione-iva, fascicolo fiscale, firme, search; correggere rbacModuli.test.ts:73-76 (A2) — modello: Opus — dipende da 1.1
- [ ] 1.3 Blocco KYC sulla fatturazione da progetto non aggirabile: tipoDocumento rispettato o rifiutato, progetto solo per id (N1, N2, parte di A7) — modello: Opus

## Fase 2 — Soldi e documenti
- [ ] 2.1 Lettera d'incarico: importo da centesimi a euro; correggere generazioneDocumenti.test.ts:255 (A3) — modello: Sonnet
- [ ] 2.2 Incasso con la data inserita, non oggi (A4) — modello: Opus
- [ ] 2.3 XML SdI: `??` sulle aliquote, cassa con l'aliquota corretta e Natura se esente (A5) — modello: Opus
- [ ] 2.4 Numerazione FT da progetto per anno, come il registro (A7) — modello: Opus
- [ ] 2.5 Rate stornate non bloccano lo stato incassata (A8) — modello: Sonnet
- [ ] 2.6 Impostazioni studio: errore vero se il DB non salva, via inMemoryTenantStore (A6) — modello: Sonnet
- [ ] 2.7 FatturazioneTab: niente 400 € / 120 €/h / 1000 € / 3500 € inviati; numero e stato dal DB (N3, N4, F2) — modello: Opus
- [ ] 2.8 Copia firmata: errore esplicito se le firme non si leggono, niente copia duplicata (N5) — modello: Sonnet
- [ ] 2.9 Numero lettera d'incarico in transazione con vincolo unico (A9) — modello: Opus

## Fase 3 — Niente dati inventati
- [ ] 3.1 RedditivitaTab: valore e tariffe dal DB (F1) — modello: Sonnet
- [ ] 3.2 AnagraficaErpModal: salvataggio fallito dichiarato (F3) — modello: Sonnet
- [ ] 3.3 PassaggioModal: autore dall'utente collegato, nessuna nota fabbricata (F4) — modello: Sonnet
- [ ] 3.4 Dati demo mai mostrati su errore API; Dashboard con stato d'errore (F5) — modello: Sonnet
- [ ] 3.5 Pagine Banks, Scadenzario, Retainers: errore distinto da "vuoto" (F6; Payments eliminata il 28/11, R.8) — modello: Sonnet
- [ ] 3.6 Testi di ripiego negli atti → campo mancante segnalato — modello: Sonnet

## Fase 4 — Sicurezza
- [ ] 4.1 SIGILLO_HMAC_SECRET obbligatorio; PDF "HMAC-SHA256" (A12) — modello: Opus
- [ ] 4.2 Chiave TOTP indipendente da JWT_SECRET, con migrazione dei segreti (A12) — modello: Opus
- [ ] 4.3 HTML sanificato nel download lettera dal portale e nell'anteprima file (N6, N7, F7) — modello: Opus
- [ ] 4.4 Aggiornare fastify, nodemailer, zod, dompurify senza salto di major (D8) — modello: Sonnet
- [ ] 4.5 Notifiche "nuovo progetto" al tenant della richiesta (A11) — modello: Sonnet
- [ ] 4.6 Eliminazione modulo con conContestoInTransazione (A10) — modello: Sonnet
- [ ] 4.7 .railway/railway.ts: variabili mancanti dichiarate (N8) — a mano con il titolare

## Fase 5 — Ordine
- [ ] 5.1 Archivio docs/storico/ (27 file) ed eliminazione dei 7 duplicati, rimandi aggiornati — modello: Sonnet
- [ ] 5.2 README e ISTRUZIONI_PER_IA allineati (M1, D5) — modello: Sonnet
- [ ] 5.3 Indici su tenant_id per le 20 tabelle (D7), migrazione additiva — modello: Opus
- [ ] 5.4 Node 20 in engines e .nvmrc (D6); ramo master eliminato — modello: Sonnet
- [ ] 5.5 Split di firma.ts, progetti.ts, tenant.ts, uno per sessione — modello: Sonnet

## Risposte del titolare — 28/11/2026
Dal documento «Domande per Mario» compilato in call (19 domande). I numeri sono quelli del documento.
- [x] R.2 Fattura senza i dati fiscali del cliente: bloccata (409) nelle tre rotte che emettono, con il rimando alla scheda cliente
- [x] R.3 Importi in fattura dal listino dell'articolo; in proporzione al listino se il modulo ha un prezzo a pacchetto
- [x] R.5 «Storna incasso»: riga contraria, rata riaperta, uscita in Prima Nota dallo stesso conto, motivo nel registro
- [x] R.6 Conto dell'incasso obbligatorio
- [x] R.7 Sconto concordato sul progetto, dichiarato in fattura
- [x] R.8 Pagina Pagamenti eliminata (la 3.5 non la riguarda più)
- [x] R.9 Retainer: nessuna fattura automatica, «Da fare oggi» ricorda i canoni da fatturare
- [x] R.12 Nuovo progetto: avviso se manca il modulo da cui un altro dipende (nessun blocco)
- [x] R.13 Attività chiusa a zero ore: domanda di conferma (nessun blocco)
- [x] R.14 Il livello di firma del modello è il minimo del documento
- [x] R.15 Rischio antiriciclaggio di un cliente nuovo: «non valutato»
- [x] R.16 Il form dell'articolo si salva, diventa un passaggio del cliente nei progetti nuovi e riprende le risposte già date
- [ ] R.1 Multi-Paese, emittente per progetto — fermo sulle domande al titolare: (a) l'elenco dei Paesi (Malta e Gibilterra erano esempi); (b) un'azienda che fattura = uno studio a sé (un tenant per azienda, come oggi: nessun codice nuovo) oppure più emittenti nello stesso studio, scelte sul progetto (anagrafiche emittente, numerazione e registro per emittente, isolamento da ripensare); (c) per ogni Paese: tipi di cliente, canale d'invio, formato del documento
- [ ] R.4 IVA per Paese nelle impostazioni dello studio — dipende da R.1; aliquote, periodicità e prospetto di versamento per Paese vanno scritti con un commercialista (oggi: 22% Italia e 0% estero sono ripieghi del codice, il prospetto F24 trimestrale resta una bozza)
- [ ] R.10 Vincolo UNIQUE sulle fatture d'acquisto doppie — «dati di esempio, vincolo da confermare»: prima i conteggi sui dati veri (R.19), poi la migrazione; fino ad allora resta il controllo applicativo (409)
- [ ] R.11 Bloccare le attività in attesa di un altro modulo — da rivedere con Francesco o Giuseppe: nessun blocco aggiunto
- [ ] R.17–R.19 Chi pubblica, quando, e i controlli sui dati veri — non annotate nel documento; nel frattempo vale DEPLOY.md
- [ ] R.20 Documenti allacciati all'articolo — non deciso: i campi restano, con l'avviso che non si salvano
- [ ] R.21 Passaggi interni scritti sull'articolo della Libreria (DIARIO 27/11) e domande 21–24 sul portale — non sono nel documento compilato: restano aperte
- [ ] R.22 Seguiti nati da queste risposte, da fare se servono: sconto come riga propria nell'XML SdI; storno degli incassi vecchi il cui movimento di Prima Nota non si riconosce (oggi lo storno si ferma e lo dice); form sui progetti già creati e modifica di un form; i clienti nati col «medio» automatico restano «medio»; il compositore della fattura dichiara lo sconto ma le fatture già emesse non cambiano

## Varianti al piano
- 02/11 piano creato dalla diagnosi; il backlog di LAVORO_RIMANENTE.md resta al titolare
- 28/11 aggiunta la sezione «Risposte del titolare» (12 applicate, le altre ferme su una sua decisione). Le spunte delle fasi 0–5 non sono state riverificate in questo giro: lo stato vero di quei punti sta nel DIARIO e nelle PR
