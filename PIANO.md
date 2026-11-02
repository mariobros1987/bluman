# PIANO — BluMan

Obiettivo: correggere i difetti emersi dalla diagnosi del 02/11/2026 (permessi, importi, dati inventati,
sicurezza), poi mettere ordine in documentazione e codice.
Fuori scope: nuove funzioni del backlog del titolare (LAVORO_RIMANENTE.md: fornitore KYC, goAML…).
Riferimento: diagnosi del 02/11/2026 (codici A, F, D, M, N).

## Fase 0 — Preparazione
- [x] 0.1 CI verificata: verde; la X rossa su GitHub è il deploy Vercel da push (bloccato per scelta)
- [x] 0.2 Copia locale C:\Progetti\bluman allineata, typecheck/test/build verdi (02/11)
- [ ] 0.3 CLAUDE.md, PIANO.md, .claude/settings.json — modello: Sonnet
- [ ] 0.4 Verificare che il JWT_SECRET di produzione non sia quello di analisi.txt:310 (D2) — a mano

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
- [ ] 3.5 Pagine Banks, Scadenzario, Retainers, Payments: errore distinto da "vuoto" (F6) — modello: Sonnet
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

## Varianti al piano
- 02/11 piano creato dalla diagnosi; il backlog di LAVORO_RIMANENTE.md resta al titolare
