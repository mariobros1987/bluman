-- §23 / regola 6 di .agents/AGENTS.md — eliminazione della password in chiaro dal database.
--
-- `tenant.lead_advisor_password` conteneva la password di accesso del responsabile dello
-- studio in testo leggibile. Tre conseguenze concrete:
--   1. `GET /admin/tenants` la restituiva nel JSON a qualunque utente autenticato;
--   2. `PATCH /tenant/info` permetteva a un collaboratore di sovrascriverla;
--   3. un backup del database, o una query di sola lettura, esponeva le credenziali di
--      tutti gli studi della piattaforma.
--
-- Le password vivono ora esclusivamente come hash scrypt su `user.password_hash`. La
-- password iniziale di un nuovo responsabile viene generata dal server e restituita una
-- volta sola nella risposta a POST /admin/tenants (o /admin/tenants/:id/reset-password).
--
-- Il DROP è distruttivo per progetto: non esiste un percorso di rollback che recuperi i
-- valori, ed è esattamente ciò che serve. Chi ha ancora bisogno di accedere usa il reset.

ALTER TABLE "tenant" DROP COLUMN IF EXISTS "lead_advisor_password";
