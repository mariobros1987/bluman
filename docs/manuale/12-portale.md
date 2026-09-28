# 12 · Portale Cliente

## 👤 Cosa fa e come si usa
Il **Portale** (`/portal`) è l'area del **cliente**, ad accesso **passwordless**: entra dal **Magic
Link** ricevuto via email (§02). Ha **7 schede**:
1. **Proposta & Firma** — vede la proposta e la firma con **OTP** (art. 20 CAD);
2. **Avanzamento** — stato dei moduli/micro-voci in tempo reale (selezione dinamica del progetto);
3. **Form Societari** — compila i dati richiesti (UBO, dati societari);
4. **Documenti & Contratti** — scarica/firma i documenti pubblicati, con cronologia versioni a ritroso;
5. **Fatture** — le sue fatture;
6. **Chat & Comunicazioni** — messaggi con lo studio (anche Telegram/WhatsApp agganciati alla pratica);
7. **Profilo & Sicurezza**.

## 📐 Calcoli & logica
- Il cliente vede **solo i propri dati**: RLS per tenant + guard sul ruolo `cliente` (un token cliente
  non vede il parco progetti dello studio).
- L'avanzamento mostrato è quello **calcolato dal backend** (§01), non ricostruito nel browser.
- La **conclusione di un modulo** dal portale è una **firma FEA** (§11): impronta dal server, IP dal
  sigillo; niente scritture solo in `localStorage`.
- I documenti mostrano evidenza di firma solo se **esiste** un sigillo (regola 7).

## 🔗 Collegamenti
- **Clienti** (§02): accesso via Magic Link.
- **Progetti** (§01): avanzamento e conclusione moduli.
- **Documenti & Firma** (§10–11): pubblicazione e firma OTP.
- **Fatture** (§05) e **Comunicazioni** (§15).

## ⚠️ Stati limite & errori
- Magic link scaduto/inventato → **401**; token valido → JWT col tenant preso dalla riga.
- Firmare un modulo non `done` o non proprio → **409**.
- Empty state sinceri (nessun documento/fattura ancora).

## 🔧 Nota tecnica
- Frontend: `pages/ClientPortal.tsx` + `components/portal/` (18 componenti presentazionali: login, 7
  tab, modali, `usePortalData`, `mapPortalModules`).
- Rotte: `src/routes/portale.ts` (`/portal/request-otp`, `/portal/verify-otp-and-sign`,
  `/portal/documenti`, `/portal/firma-con-file`); login `POST /auth/magic-login`.
- Fonti: `.agents/AGENTS.md`, `spec-portale-moduli-firma.md`.
