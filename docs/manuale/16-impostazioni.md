# 16 · Impostazioni Studio

## 👤 Cosa fa e come si usa
Le **Impostazioni** (`/settings`) configurano lo studio (tenant):
- **Dati studio**: ragione sociale, sedi, P.IVA, **logo**, colore del tema PDF;
- **Email Suite**: credenziali **SMTP/IMAP** dello studio (per invio/ingestione posta);
- **Canali**: WhatsApp/Telegram/Signal (token, username bot, callback);
- **Configuratore PDF** della fattura;
- **Team**: gli utenti dello studio (iniziali, ruoli) e la **Matrice Permessi RBAC** (§17);
- **Sicurezza**: 2FA/TOTP;
- **Compliance**: profilo regolatorio e **MLRO** (per il modulo KYC, §13).

## 📐 Calcoli & logica
- Le **credenziali dello studio** vivono nella riga **Tenant** del database e si aggiornano via
  `PUT /tenant/settings`; le password delle **persone** solo come **hash scrypt** su
  `user.password_hash` (mai in chiaro, regola 5). Nessun valore di ripiego precompilato nella UI.
- `PATCH /tenant/info` (impostazioni studio) è **riservato ad advisor/super_admin** — non passa dalla
  matrice permessi (è funzione da titolare, decisione 27/09).
- I segreti (SMTP/IMAP pass, token canali) non vengono mai restituiti in chiaro alle letture.

## 🔗 Collegamenti
- **Comunicazioni** (§15): SMTP/IMAP e canali si impostano qui.
- **RBAC** (§17): la Matrice Permessi e il team si gestiscono da qui.
- **KYC** (§13): profilo regolatorio e MLRO.
- **Fatture** (§05): il Configuratore PDF e i dati studio finiscono in fattura.

## ⚠️ Stati limite & errori
- Modifica impostazioni studio da un collaboratore → **403** (solo advisor/super_admin).
- Un canale con credenziali errate → messaggi di configurazione mirati (non un fallimento muto).

## 🔧 Nota tecnica
- Rotte: `src/routes/tenant.ts` (`/tenant/info`, `/tenant/settings`, `/tenant/utenti`, `/tenant/moduli`).
- Frontend: `pages/SettingsPage.tsx`, `components/settings/` (`TabCompany`, `TabChannels`, `TabSdi`,
  `TabUsers`, `OperatorDetailModal`, `TabSicurezza`, `TabCompliance`, `TabInvoiceDesign`).
- Schema: `Tenant` (dati studio, `smtp_pass`/`imap_pass`, servername certificati), `User`.
- Fonti: `.agents/AGENTS.md`, `AUDIT_2026-09-27/01-sicurezza-multitenant.md`.
