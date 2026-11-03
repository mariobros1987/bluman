# 🔍 AUDIT COMPLETO BluMan — 27 settembre 2026

Audit dell'intera piattaforma, **sezione per sezione**, con due obiettivi: (a) materiale per la **guida** («come funziona & logica applicata»); (b) **rilievi** di correttezza/sicurezza. Ogni sezione è stata prodotta leggendo il **codice reale** con citazioni `file:riga` (non solo la mappa `.agents/AGENTS.md`), da auditor distinti in parallelo.

> I dettagli completi di ciascuna area sono nei 7 file di sezione (vedi Indice in fondo). Questo documento è la **sintesi esecutiva** + i **temi trasversali**. I rilievi sono da intendersi *da confermare*: vanno verrificati sul campo prima di correggere.

---

## 📊 Matrice dei rilievi per severità

| # | Sezione | Alta | Media-alta | Media | Bassa | Tot |
|---|---------|:----:|:----------:|:-----:|:-----:|:---:|
| 01 | Sicurezza & multi-tenant | 2 | — | 3 | 3 | 8 |
| 02 | KYC/AML (K0–K9) | 1 | 1 | 5 | 3 | 10 |
| 03 | Progetti & motore di stato | 3 | — | 4 | 2 | 9 |
| 04 | Contabilità & fatturazione | 2 | 1 | 3 | 5 | 11 |
| 05 | Documenti & firma | 2 | — | 3 | 3 | 8 |
| 06 | Comunicazioni & canali | 0 | — | 3 | 3 | 6 |
| 07 | Frontend & infra/deploy | 1 | 1 | 3 | 3 | 8 |
| | **Totale** | **11** | **3** | **24** | **22** | **60** |

Nessun rilievo è stato classificato *critico/sfruttabile da esterno anonimo*: le difese perimetrali (RLS, guard auth, webhook firmati, isolamento tenant) reggono. I rilievi ALTA sono quasi tutti **abusi da parte di un utente interno autenticato** o **integrità dei dati/evidenze**.

---

## 🚨 Rilievi ALTA — sintesi esecutiva

1. **[01] Bypass 2FA via preToken** — il `preToken` del login sarebbe un JWT non marcato che l'hook accetta come sessione e rinnova a token pieno 12h → chi ha solo la password aggira il secondo fattore.
2. **[01] `PATCH /tenant/info` senza guard di ruolo** — un collaboratore può cambiare l'IBAN dello studio (frode incassi), i dati fiscali, o sospendere lo studio (DoS).
3. **[02] «Modalità bozza» non applicata** — è solo un badge: uno studio senza profilo regolatorio + MLRO può comunque approvare KYC e sbloccare la fatturazione (§14 non rispettato).
4. **[03] Consuntivazione micro-voce di produzione fuori dal dominio** — `prismaApp.consuntivaMicrovoce` non calcola rischio/ore extra, non fa cascata, scavalca il gate dipendenze; un modulo con voce bloccata può diventare «completato». I test collaudano solo la versione in-memory corretta.
5. **[04] Gate KYC/AML aggirabile in fatturazione** — `POST /progetti/:id/fatture` (via `prismaApp.emettiFattura`) non applica il blocco KYC presente su `/invoices`: si fattura un cliente bloccato dall'antiriciclaggio.
6. **[04] Arrotondamento IVA incoerente nell'XML SDI** — somma IVA per-riga vs IVA di gruppo → scarto ±1 cent Imponibile/Imposta → rifiuto SdI (riapre il difetto B1).
7. **[05] Firma-studio con evidenza legale debole** — l'impronta del sigillo è SHA-256 della *stringa dell'URL* (non del contenuto) e una checksum semplice **non HMAC**, mentre il flusso cliente legge il file e firma in HMAC.
8. **[07] Backup / Disaster Recovery non operativo** — lo script scrive su filesystem effimero di Railway e non è schedulato → nessun ripristino reale del DB.

---

## 🧵 Temi trasversali (la vera lettura d'insieme)

**T1 — Il percorso `prismaApp.ts` diverge dal percorso «buono» (service/dominio).** È il tema strutturale più importante. Le rotte `/progetti/*` passano dall'adapter `prismaApp` che reimplementa a mano operazioni che altrove hanno guardie e logica testata: consuntivazione micro-voce fuori dal dominio (rilievo 4), emissione fattura che salta il gate KYC (rilievo 5). *Direzione di fondo*: convogliare queste rotte sugli stessi service/gate del resto, o portare le guardie dentro `prismaApp`. Risolve due ALTA in un colpo.

**T2 — Il lato «studio/operatore» è meno presidiato del lato cliente/portale.** Il portale cliente è blindato; le rotte interne assumono operatori fidati: `PATCH /tenant/info` senza ruolo (01), gap RBAC sulle API `documenti`/`library`/`settings` (01), canali `/comunicazioni/invia-*` senza audit né restrizione di ruolo (06), firma-studio più debole della firma-cliente (05). *Direzione*: applicare guard di ruolo/permesso e audit anche sulle rotte interne di scrittura sensibile.

**T3 — Gate e guardie «dichiarati ma non applicati».** Cose che sembrano attive ma non incidono: modalità bozza come semplice badge (02), motivazioni del rischio cliente non imposte mentre lo sono sul business risk (02), CI che non è un cancello di deploy (07), relay serverless fail-open se manca `EMAIL_RELAY_SECRET` (06). *Direzione*: rendere ogni gate un vero blocco, e fallire chiuso.

**T4 — Integrità dati, atomicità e DR.** Aggiornamento fattura non atomico (04), arrotondamento IVA→rifiuto SdI (04), backup non operativo (07), cascata stato che può chiudere moduli bloccati (03). *Direzione*: transazioni per le scritture multi-riga, un solo punto di verità per l'IVA, un backup DB reale fuori dall'app.

---

## ✅ Punti solidi confermati (da mettere nella guida come «così deve restare»)

- **Isolamento multi-tenant / RLS**: solido e ben presidiato (ruolo `bluman_app` senza bypass, policy `FORCE` su tutte le tabelle, contesto per richiesta). Verificato su §01 e su tutte le tabelle KYC nuove.
- **Vincolo §5.3 KYC** (nulla del flusso anomalie/STR visibile al cliente): rispettato su API, portale e cron.
- **Webhook in ingresso** (WhatsApp/Telegram): firma per-tenant, ordine tenant→firma, fail-closed; nessun messaggio perso in silenzio.
- **Segreti**: nessuno nel bundle o in `localStorage`; nessun ripiego su env per le credenziali dei canali; guard auth fail-closed con elenco di rotte *pubbliche*.
- **Documenti**: path traversal chiuso, download HMAC, IP/impronta solo server-side, immutabilità dell'originale sigillato (§36); flusso di firma **cliente** corretto (HMAC).
- **Contabilità**: il ciclo **NC/storno** (indicato in memoria come il più grave) risulta **già sanato** nella revisione del 21/09/2026.

---

## ❓ Domande aperte prioritarie per il titolare

1. **`EMAIL_RELAY_SECRET` è impostato in produzione (Vercel + Railway)?** Se no, `/api/send-email` è un open relay/SSRF (06). *Verifica prioritaria.*
2. **Esiste un backup del database fuori dall'app** (es. lato Supabase/provider)? Se sì, l'assenza di backup applicativo (07) è meno grave; se no, è urgente.
3. **Reset annuale della numerazione fatture**, esigibilità differita in LIPE, e fonte di verità del saldo cassa (04): da confermare le regole fiscali.
4. **Uso dei canali da parte dei `collaboratore_esterno`**: consentito verso destinatari arbitrari, o va ristretto? (06)
5. Verify token WhatsApp / bot token storici già rigenerati su Meta/BotFather? (06)

---

## 🗂️ Indice delle sezioni di dettaglio

- [`01-sicurezza-multitenant.md`](01-sicurezza-multitenant.md) — auth, JWT, 2FA, RBAC, RLS, segreti, upload.
- [`02-kyc-aml.md`](02-kyc-aml.md) — modulo compliance K0–K9.
- [`03-progetti-motore-stato.md`](03-progetti-motore-stato.md) — istanziazione, cascata stati, dipendenze.
- [`04-contabilita-fatturazione.md`](04-contabilita-fatturazione.md) — fatture/NC, SDI, prima nota, LIPE, ciclo passivo.
- [`05-documenti-firma.md`](05-documenti-firma.md) — Document Studio, generazione §36, workflow, archivio, firma.
- [`06-comunicazioni-canali.md`](06-comunicazioni-canali.md) — email relay, WhatsApp/Telegram, webhook, notifiche.
- [`07-frontend-infra.md`](07-frontend-infra.md) — API client, RBAC UI, caching, Docker/Railway/Vercel, CI, backup.

## 🛠️ Ordine di correzione suggerito (proposta, da approvare)

1. **Rapide e ad alto impatto**: guard di ruolo su `PATCH /tenant/info` (01) e marcatura del `preToken` 2FA (01) — sicurezza, poche righe.
2. **Tema T1**: allineare `/progetti/:id/fatture` al gate KYC e la consuntivazione al dominio (04+03) — chiude 2 ALTA.
3. **Evidenze legali**: firma-studio su HMAC + hash del contenuto (05) — conformità.
4. **Gate reali**: applicare la modalità bozza (02) e chiudere il relay fail-open (06).
5. **Integrità/DR**: transazione su `PUT /invoices/:id` + arrotondamento IVA unico (04); backup DB reale (07, dipende dalla domanda 2).

*Nessuna correzione è stata applicata: questo è solo l'audit. Dimmi da quali rilievi partire e li affrontiamo in slice piccole e verificate, come per il KYC.*
