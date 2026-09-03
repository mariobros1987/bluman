-- Blocco 2 (portale cliente) — §2.3 dati fiscali proposti dal cliente,
-- §2.5 richieste di addendum, §2.8 numerazione progressiva del contratto.
--
-- §2.3: il cliente PROPONE una modifica ai propri dati fiscali/anagrafici; lo studio la
-- CONFERMA o la rifiuta. La riga del cliente cambia solo alla conferma, così un errore di
-- digitazione non entra mai in anagrafica da solo.
--
-- §2.5: l'addendum nasce da una richiesta libera del cliente. Prima la "cronologia
-- addendum" viveva nel localStorage del browser del cliente: invisibile allo studio e
-- persa al cambio dispositivo. Ora è a database, agganciata al progetto.
--
-- §2.8: il numero della lettera d'incarico era cablato nel frontend (EL-2026-089 per
-- tutti). Ora ogni progetto ha il suo numero progressivo per tenant e anno.

-- CreateEnum
CREATE TYPE "StatoPropostaDati" AS ENUM ('in_attesa', 'confermata', 'rifiutata');

-- CreateEnum
CREATE TYPE "StatoRichiestaAddendum" AS ENUM ('richiesta', 'in_preparazione', 'pronta', 'rifiutata');

-- Allinea la FK firma_elettronica.codice_otp_id al modello (SetNull), già usata a runtime.
ALTER TABLE "firma_elettronica" DROP CONSTRAINT IF EXISTS "firma_elettronica_codice_otp_id_fkey";

-- AlterTable
ALTER TABLE "progetto" ADD COLUMN "numero_contratto" TEXT;

-- CreateTable
CREATE TABLE "proposta_dati_fiscale" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "valore_attuale" TEXT,
    "valore_proposto" TEXT NOT NULL,
    "nota_cliente" TEXT,
    "nota_studio" TEXT,
    "stato" "StatoPropostaDati" NOT NULL DEFAULT 'in_attesa',
    "richiesto_da_id" TEXT,
    "gestito_da_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposta_dati_fiscale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "richiesta_addendum" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,
    "testo_richiesta" TEXT NOT NULL,
    "stato" "StatoRichiestaAddendum" NOT NULL DEFAULT 'richiesta',
    "risposta_studio" TEXT,
    "richiesto_da_id" TEXT,
    "gestito_da_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "richiesta_addendum_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposta_dati_fiscale_cliente_id_campo_stato_idx" ON "proposta_dati_fiscale"("cliente_id", "campo", "stato");

-- CreateIndex
CREATE INDEX "richiesta_addendum_progetto_id_stato_idx" ON "richiesta_addendum"("progetto_id", "stato");

-- AddForeignKey
ALTER TABLE "firma_elettronica" ADD CONSTRAINT "firma_elettronica_codice_otp_id_fkey" FOREIGN KEY ("codice_otp_id") REFERENCES "codice_otp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_dati_fiscale" ADD CONSTRAINT "proposta_dati_fiscale_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_dati_fiscale" ADD CONSTRAINT "proposta_dati_fiscale_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "richiesta_addendum" ADD CONSTRAINT "richiesta_addendum_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "richiesta_addendum" ADD CONSTRAINT "richiesta_addendum_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "richiesta_addendum" ADD CONSTRAINT "richiesta_addendum_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill §2.8 — assegna un numero progressivo ai progetti esistenti, uno per tenant e
-- per anno di creazione. Le nuove proposte partono da dopo l'ultimo numero usato.
WITH numbered AS (
  SELECT id,
         EXTRACT(YEAR FROM created_at)::int AS anno,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, EXTRACT(YEAR FROM created_at)
           ORDER BY created_at
         ) AS seq
  FROM "progetto"
  WHERE numero_contratto IS NULL
)
UPDATE "progetto" p
SET numero_contratto = 'EL-' || n.anno || '-' || LPAD(n.seq::text, 3, '0')
FROM numbered n
WHERE p.id = n.id;
