-- L'indice unico della numerazione delle fatture emesse deve includere l'ANNO.
--
-- PRIMA (migrazione 20260915203000): (tenant_id, serie, numero_progressivo_serie) dove
-- stato <> 'bozza'. Era corretto finché il progressivo non ripartiva mai — cioè finché la
-- numerazione non era annuale.
--
-- Il difetto, scoperto il 15/10/2026: il progressivo **non ripartiva a gennaio**. Le query di
-- numerazione filtravano `{ tenantId, serie }` e contavano tutte le emesse di sempre, quindi il
-- 1° gennaio 2027 la prima fattura dell'anno sarebbe stata `FT-2027/043` invece di `FT-2027/001`.
-- L'art. 21 del DPR 633/72 chiede la numerazione «in ordine progressivo per anno solare», e una
-- serie che non riparte non è una serie annuale. Il numero stampato l'anno lo conteneva già, quindi
-- il difetto era visibile leggendo la fattura: `FT-2027/043` è un numero che si contraddice.
--
-- Sistemato il codice in **quattro** punti — bozza, emissione, nota di credito e canone generato
-- da contratto (`contabilitaFatture.ts`, `contabilitaContratti.ts`) — questo indice va allineato,
-- perché altrimenti il guasto si sposta nel verso opposto: con il contatore annuale due anni
-- diversi producono entrambi il progressivo 1, e l'indice vecchio, che l'anno non lo conosce,
-- rifiuterebbe la `FT-2027/001` come duplicato della `FT-2026/001`. Il contatore giusto e il
-- vincolo sbagliato sarebbero peggio di prima.
--
-- `date_trunc('year', "data")` è ammesso in un indice perché la colonna è `timestamp(3)` **senza**
-- fuso orario: su una colonna `timestamptz` la funzione dipenderebbe dal `TimeZone` della sessione,
-- sarebbe STABLE e non IMMUTABLE, e l'indice non si potrebbe creare. È lo stesso criterio — anno
-- **locale** — che usa `getFullYear()` in `formattaNumeroDocumento`, così il numero stampato e il
-- vincolo contano lo stesso anno: se i due criteri divergessero, un documento emesso a cavallo
-- della mezzanotte di capodanno sarebbe *numerato* 2027 e *contato* nel 2026.
--
-- Limite noto, accettato: `data` è nullable, e in un indice unico i NULL sono distinti, quindi una
-- riga emessa con `data` NULL non sarebbe vincolata. Non capita — il campo ha `@default(now())` e
-- l'emissione lo scrive sempre — e le bozze, le uniche righe a poter restare senza data, sono
-- escluse comunque dalla clausola `WHERE`.
--
-- Verificato sul database di produzione il 15/10/2026 prima di scrivere questa migrazione:
-- `fattura` ha **0 righe** (0 emesse, 0 con `data` NULL), quindi la ricreazione non può fallire
-- per un duplicato già presente.

DROP INDEX IF EXISTS "fattura_emesse_tenant_serie_prog_key";

CREATE UNIQUE INDEX "fattura_emesse_tenant_serie_prog_key"
  ON "fattura" ("tenant_id", "serie", date_trunc('year', "data"), "numero_progressivo_serie")
  WHERE "stato" <> 'bozza';
