# 00 · Audit di sicurezza — quadro completo — 11/10/2026

> Audit avversariale sull'intera app BluMan, richiesto dal titolare. Difensivo e
> autorizzato (prodotto del proprietario). Ogni capitolo cita `file:riga` su codice reale;
> dove una cosa è solida, è scritto. Metodo: lettura diretta del codice. La delega a
> sotto-agenti è fallita per un errore di autenticazione del modello (`403`), quindi i cinque
> capitoli sono stati scritti a mano, in sequenza.

## Esito in una riga

**Nessun rilievo Alta.** L'app è matura e difesa in profondità: l'isolamento multi-tenant via
RLS è solido, il rilievo Alta storico (RBAC «default permissivo») è **chiuso e verificato**, i
segreti sono obbligatori in produzione e la crittografia usa primitive corrette. Il lavoro
restante è **irrobustimento**, e la cosa più concreta da sistemare è **un XSS immagazzinato nel
portale cliente** (Media): una vista salta il sanitizzatore che la vista gemella invece usa.

## Classifica dei rilievi

| # | Severità | Rilievo | File chiave |
|---|---|---|---|
| 1 | **Media — RISOLTO 11/10** | XSS nel portale cliente: engagement HTML reso senza `sanitizzaHtmlDocumento` | `frontend/src/components/portal/TabProposta.tsx:99`; `frontend/src/pages/ClientPortal.tsx:362-413` |
| 2 | **Media — RISOLTO 11/10** | Nessuna CSP sul frontend servito da nginx (solo 3 header) | `nginx/bluman_app.inc:9-27` |
| 3 | **Media — difesa in profondità** | Body non validati con schema su 30 rotte (`Record<string, any>`); verificato: nessun mass-assignment reale | `src/routes/{tenant,clienti,kyc,progetti,notifiche,webhooks}.ts` |
| 4 | Bassa | Token di sessione in `localStorage` → ogni XSS è furto di sessione | `frontend/src/api/auth.ts:92-112` |
| 5 | Bassa | CORS ammette qualunque `*.vercel.app` con `credentials: true` | `src/server.ts:264,281-295` |
| 6 | Bassa | HSTS ancora commentato (in attesa del TLS) | `nginx/default.conf:76` |
| 7 | Bassa | File storici senza prefisso-tenant leggibili cross-studio | `src/routes/catalogo.ts:201-216` |
| 8 | Bassa | Rate-limit dedicato assente oltre a login/OTP (export/PDF) | `src/server.ts:354` |
| 9 | Bassa | Audit scrive/arricchisce scavalcando la RLS | `src/util/serverHelpers.ts:171,185` |
| 10 | Bassa | Prova RLS è script post-deploy, non test della suite | `src/scripts/checkRls.ts:21-48` |
| 11 | Bassa | CORS ammette l'origine letterale `null` | `src/server.ts:286` |
| 12 | Bassa | Nessuna revoca sessione per-utente prima della scadenza | `src/util/jwt.ts:78-137` |
| 13 | Bassa | Sigillo di firma ripiega su `JWT_SECRET` | `src/services/otpService.ts:321-347` |
| 14 | Bassa | Marca temporale del sigillo = orologio del server (no TSA) | `src/services/otpService.ts:317-319` |

**Conteggio totale: 0 Alta, 3 Media (due risolti l'11/10, il terzo è difesa in profondità senza
exploit dimostrato), 11 Bassa.** (Più il rilievo Alta storico sul RBAC, verificato come **risolto**.)

### Stato della correzione (11/10/2026)

- **Media #1 e #2 risolti e verificati**: XSS del portale chiuso (sanitizzazione + escape),
  CSP aggiunta al frontend. Typecheck, build e suite frontend (192/192) verdi.
- **Media #3**: verificato che **non esiste** uno spread del body in Prisma (nessun mass-assignment);
  resta difesa in profondità, da fare come passata `zod` deliberata e testata, non con una
  riscrittura cieca dei 30 handler.
- **11 Bassa**: non toccati — sono per lo più legati a eventi futuri (HSTS e `*.vercel.app` al
  cut-over TLS/dominio) o a scelte d'architettura da pesare (storage del token, revoca sessione,
  sigillo), non correzioni «mordi e fuggi».

## I tre Media, e cosa farne

1. **XSS nel portale cliente (il più concreto).** `TabProposta.tsx:473` rende l'HTML della lettera
   d'incarico con `dangerouslySetInnerHTML` **senza** `sanitizzaHtmlDocumento`, mentre la vista
   gemella `DocumentiTab.tsx:38` lo sanitizza. L'HTML è composto interpolando dati di tenant/cliente
   senza escape (`ClientPortal.tsx:378-412`, fra cui `formData.ragioneSociale` inserito dal cliente).
   Il portale tiene `bluman_portal_token` in `localStorage`: un markup attivo in uno di quei campi
   si esegue nella sessione del cliente. **Fix:** una riga (avvolgere in `sanitizzaHtmlDocumento`) +
   `escapeHtmlTesto` sui valori interpolati. È il primo da chiudere.
2. **CSP assente sul frontend.** È la seconda barriera che renderebbe l'XSS sopra molto meno utile.
   Da aggiungere in `nginx/bluman_app.inc`, restrittiva, sul blocco `server` (non dentro un
   `location`, per la lezione già nota degli header ereditati).
3. **Body non validati.** Difesa in profondità mancante, non un buco dimostrabile oggi (gli handler
   mappano i campi a mano e non fanno spread in `prisma.create`). Introdurre schemi `zod` sulle
   rotte che scrivono anagrafiche/tenant/KYC.

## Cosa è risultato solido (non dato per scontato)

- **Isolamento multi-tenant** (cap. 01): `prismaAmministrativo()` confinato a contesti legittimi,
  `x-tenant-id` onorato solo per super_admin, nessun SQL raw nelle rotte, contesto per-richiesta.
- **RBAC** (cap. 02): il rilievo Alta storico è chiuso — default per ruolo lato server e
  **fail-closed** sull'errore di lettura della matrice.
- **Auth/crypto** (cap. 02, 04): JWT HMAC-SHA256 a tempo costante con rotazione; OTP casuali,
  hashati, limitati, vincolati all'ambito; segreti obbligatori in produzione; AES-256-GCM per il TOTP.
- **File** (cap. 03): download con tre reti contro il path traversal e controllo di appartenenza al tenant.
- **Copia off-site** (cap. 04): token mai restituito, `0640`, `refresh_token` obbligatorio,
  stato che degrada a `sconosciuto` mai a `ok`.

## I capitoli

- [01 · Isolamento multi-tenant & RLS](01-isolamento-multitenant-rls.md) — 0A/0M/2B
- [02 · Autenticazione, autorizzazione & RBAC](02-autenticazione-autorizzazione-rbac.md) — 0A/0M/2B + 1 storico risolto
- [03 · Validazione input, injection & file](03-validazione-input-injection-file.md) — 0A/1M/2B
- [04 · Segreti, crittografia & configurazione](04-segreti-crittografia-config.md) — 0A/0M/2B
- [05 · Frontend, infrastruttura & dipendenze](05-frontend-infra-dipendenze.md) — 0A/2M/3B

## Nota di metodo e limiti

Audit per lettura mirata delle superfici a rischio, non riga per riga di tutti i 187 file backend
e 227 frontend. Non ho eseguito scanner dinamici né `npm audit` (fuori ambiente). I rilievi Media/
Bassa sono fondati su codice letto; dove ho scritto «non ho trovato un exploit» significa che il
rischio è di regressione o difesa in profondità, non un buco dimostrato. Le righe citate erano
valide all'11/10/2026 sul commit in produzione.
