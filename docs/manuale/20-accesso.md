# 20 · Accesso alla piattaforma

## 👤 Cosa fa e come si usa
La pagina di **accesso** (`/login`) è la porta d'ingresso dello staff dello studio. Il cliente non passa da qui: entra nel Portale con il **Magic Link** (§12).

- **Entrare**: si inseriscono email aziendale e password e si preme **Accedi alla Piattaforma**. Il ruolo non si sceglie: lo stabilisce il sistema in base all'utenza.
- **Primo accesso**: chi è stato invitato riceve una password temporanea e deve sostituirla prima di usare l'app.
- **Password dimenticata**: non esiste un recupero automatico. Il collegamento invita a contattare il Super Admin; anche il responsabile dello studio può rigenerare la password di un membro del team (§17).
- **Autenticazione a due fattori**: se attivata, dopo la password viene chiesto il codice a 6 cifre dell'app di autenticazione (Google Authenticator, 1Password, Bitwarden). In alternativa si può usare un **codice di recupero** a 8 caratteri.

## 📐 Calcoli & logica
- Il secondo fattore è disponibile per **super admin** e **advisor**, e si attiva in Impostazioni (§16). I collaboratori ne sono esclusi per scelta.
- Il codice va inserito entro **2 minuti**: allo scadere si torna al primo passaggio e si ripete l'accesso.
- Da un indirizzo IP registrato come fidato il codice non viene richiesto.

## 🔗 Collegamenti
- **Portale** (§12): accesso del cliente senza password.
- **Impostazioni** (§16): attivazione del 2FA e gestione del team.
- **Permessi** (§17): cosa può fare ciascun ruolo dopo l'accesso.

## ⚠️ Stati limite & errori
- Credenziali errate: il messaggio compare sopra il modulo.
- Un operatore **archiviato** non può più accedere (§16), così come gli utenti di uno studio archiviato.

## 🔧 Nota tecnica
- Frontend: `pages/LoginPage.tsx`, `components/MustChangePasswordModal.tsx`.
- Rotte: `src/routes/auth.ts` (`POST /auth/login`, verifica TOTP, cambio password).
