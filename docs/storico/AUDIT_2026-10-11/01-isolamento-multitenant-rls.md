# 01 · Isolamento multi-tenant & RLS — 11/10/2026

> Audit avversariale a mano. Ogni rilievo cita `file:riga` su codice letto.

## Sintesi

L'isolamento è il pezzo più solido dell'applicazione. L'app gira come `bluman_app` senza
BYPASSRLS, il contesto del tenant è impostato come variabile di sessione a ogni richiesta
(`attivaContestoTenant`), e l'header `x-tenant-id` è onorato **solo** per il `super_admin`
(`src/server.ts:591-597`): per ogni altro ruolo il tenant del token è vincolante. L'uso di
`prismaAmministrativo()` (che scavalca RLS) è confinato a contesti legittimi — script di
manutenzione, lookup di login anonimo, risoluzione del tenant nei webhook, registro di audit,
cancellazione tenant — e non compare in nessuna rotta di dominio servita a un operatore. Non ho
trovato scritture o letture cross-tenant indebite. I rilievi sotto sono di irrobustimento.

## Rilievi

### [Severità Bassa] Il registro di audit scrive e si arricchisce scavalcando la RLS

- **Descrizione.** `recordAudit` scrive la riga di audit con `prismaAmministrativo()` e, se mancano
  nome/email/ruolo, li legge con lo stesso client (`user.findUnique` per id). È un uso legittimo
  (l'audit deve poter scrivere con un `tenantId` esplicito a prescindere dal contesto, e la
  lettura riguarda l'utente che agisce, non dati di altri tenant), ma amplia la superficie del
  client amministrativo: un `tenantId` sbagliato passato dal chiamante scriverebbe la riga nel
  tenant sbagliato senza che la RLS lo impedisca.
- **File.** `src/util/serverHelpers.ts:171` (lookup utente), `:185-199` (create audit).
- **Come sfruttarlo.** Non direttamente sfruttabile da un utente: dipende da come i chiamanti
  passano `tenantId`. Il rischio è un errore di programmazione che la RLS non intercetterebbe.
- **Rimedio.** Mantenere `recordAudit` l'unico punto che scrive l'audit via client amministrativo,
  e asserire che `params.tenantId` provenga sempre da `req.tenantId` (già la norma): nessun
  chiamante deve poter passare un tenant arbitrario.

### [Severità Bassa] La prova d'isolamento RLS è uno script manuale, non un test della suite

- **Descrizione.** `src/scripts/checkRls.ts` dimostra l'isolamento impostando un tenant finto e
  verificando che `cliente` non restituisca righe, e lo esegue il deploy (`distribuisci.sh`, passo 7).
  È ottimo come sonda di produzione, ma è una verifica a valle del deploy: una migrazione che crei
  una tabella **senza** policy RLS non verrebbe fermata dalla suite prima del push.
- **File.** `src/scripts/checkRls.ts:21-48`; migrazioni con RLS inline in `prisma/migrations/**`.
- **Come sfruttarlo.** Non è un exploit: è il rischio che una tabella nuova nasca senza policy e il
  buco si scopra solo dopo il deploy.
- **Rimedio.** Un test della suite che, contro uno schema di prova, verifichi che **ogni** tabella
  con `tenant_id` abbia `rowsecurity = true` e una policy — così la mancanza blocca il passo 1,
  non la sonda post-deploy.

## Note positive (verificate, nessun rilievo)

- **`x-tenant-id` solo per super_admin**: `src/server.ts:591-597`. Per gli altri ruoli il tenant
  del token comanda; onorarlo per tutti renderebbe l'isolamento aggirabile con una riga di curl.
- **`prismaAmministrativo()` confinato**: le uniche occorrenze fuori da `src/scripts/**` sono
  `auth.ts` (login/lookup anonimo, per definizione senza contesto), `webhooks.ts` e
  `contabilitaWebhookSdi.ts` (risoluzione tenant prima che il contesto esista — documentato),
  `serverHelpers.ts` (audit, vedi sopra) e `services/eliminazioneTenant.ts` (cancellazione che
  attraversa le tabelle, dove la RLS bloccherebbe il cascade). Tutti contesti legittimi (§14).
- **Contesto per-richiesta**: `attivaContestoTenant({ tenantId, ruolo })` chiude ogni richiesta
  autenticata (`src/server.ts:606`), ed è ciò su cui filtrano le policy.

## Conteggio: 0 Alta, 0 Media, 2 Bassa.
