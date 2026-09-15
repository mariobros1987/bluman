-- Indice UNIQUE parziale sulla numerazione delle fatture EMESSE:
-- (tenant_id, serie, numero_progressivo_serie) univoco solo dove
-- stato <> 'bozza'.
--
-- Perché parziale: il numero legale si assegna ALL'EMISSIONE — l'emissione
-- ricalcola «max delle emesse + 1» e sovrascrive il numero provvisorio che la
-- bozza aveva riservato, quindi due bozze possono legittimamente condividere
-- lo stesso progressivo provvisorio. Un vincolo totale lo vieterebbe.
--
-- Perché serve: la numerazione è «max+1» letta e scritta in transazione, ma
-- senza vincolo il database non garantisce nulla — due emissioni concorrenti
-- (o la via adapter `POST /progetti/:id/fatture`, storicamente senza
-- Serializable) potevano scrivere lo stesso numero e nessuno se ne accorgeva.
-- Verificato il 15/09/2026: nessun duplicato presente, l'indice si crea senza
-- toccare dati.
--
-- Nota: gli indici parziali non si esprimono in schema.prisma — come gli
-- indici trgm già presenti, questo vive solo nel database e la sua ragione
-- è documentata nel commento al campo `numeroProgressivoSerie` dello schema.
CREATE UNIQUE INDEX "fattura_emesse_tenant_serie_prog_key"
  ON "fattura" ("tenant_id", "serie", "numero_progressivo_serie")
  WHERE "stato" <> 'bozza';
