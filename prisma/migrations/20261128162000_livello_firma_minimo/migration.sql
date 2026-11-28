-- Livello di firma minimo del documento (titolare, 28/11/2026) — ADDITIVA: una colonna nuova
-- con valore predefinito 'ses', nessun dato toccato.
--
-- Il livello del modello da cui un documento nasce è il minimo: il livello richiesto si può
-- alzare, non abbassare. I documenti già esistenti nascono con minimo 'ses' (nessun minimo):
-- per loro non cambia niente, perché il modello d'origine non è stato registrato.

-- AlterTable
ALTER TABLE "documento" ADD COLUMN     "livello_firma_minimo" TEXT NOT NULL DEFAULT 'ses';
