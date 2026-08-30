-- §35 (addendum) — il nome che il certificato deve attestare, separato dall'indirizzo a cui
-- collegarsi.
--
-- Il caso misurato sulla casella dello studio: `imap.register.it` ha un record DNS
-- (195.110.124.132) e risponde sulla 993, ma presenta un certificato emesso per
-- `*.securemail.pro`; `imap.securemail.pro` — il nome coerente con quel certificato — non ha
-- alcun record DNS, quindi non è raggiungibile. Con un solo campo «Server» le due condizioni
-- non possono essere soddisfatte insieme: scrivendo il primo nome la verifica TLS interrompe
-- la connessione, scrivendo il secondo non si arriva nemmeno a stabilirla.
--
-- Il tentativo precedente risolveva l'IP del nome configurato sul backend e lo passava alla
-- funzione di relay come host di rete. Non poteva funzionare: un nome senza record A non
-- risolve dal backend più di quanto risolva da Vercel — il DNS è lo stesso — quindi la
-- risoluzione falliva e si ricadeva sul nome originale.
--
-- Qui le due informazioni diventano due colonne. `smtp_host` / `imap_host` restano l'indirizzo
-- a cui collegarsi (deve risolvere); `smtp_servername` / `imap_servername` sono il nome che il
-- certificato deve attestare (deve comparire tra i suoi nomi). Vuote — il caso normale — la
-- verifica avviene contro l'host, esattamente come prima.
--
-- Non è un'eccezione alla verifica TLS (§3.4): il certificato viene verificato, la catena
-- deve essere valida e il nome dichiarato deve comparire nel certificato. È un'associazione
-- indirizzo→nome dichiarata da chi amministra lo studio, non un nome dedotto dal certificato
-- che il server presenta — dedurlo equivarrebbe a fidarsi di qualunque certificato.
--
-- Migrazione additiva: due colonne nullable, nessun backfill, nessun fermo. Gli studi che non
-- le compilano si comportano come prima della migrazione.

ALTER TABLE "tenant" ADD COLUMN "smtp_servername" TEXT;
ALTER TABLE "tenant" ADD COLUMN "imap_servername" TEXT;
