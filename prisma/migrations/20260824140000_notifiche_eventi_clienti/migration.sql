-- DropForeignKey
ALTER TABLE "notifica" DROP CONSTRAINT "notifica_destinatario_id_fkey";

-- AlterTable
ALTER TABLE "notifica" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "destinatario_cliente_id" TEXT,
ADD COLUMN     "link" TEXT,
ADD COLUMN     "tipo_evento" TEXT,
ALTER COLUMN "destinatario_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "notifica_tenant_id_destinatario_id_idx" ON "notifica"("tenant_id", "destinatario_id");

-- CreateIndex
CREATE INDEX "notifica_tenant_id_destinatario_cliente_id_idx" ON "notifica"("tenant_id", "destinatario_cliente_id");

-- AddForeignKey
ALTER TABLE "notifica" ADD CONSTRAINT "notifica_destinatario_id_fkey" FOREIGN KEY ("destinatario_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifica" ADD CONSTRAINT "notifica_destinatario_cliente_id_fkey" FOREIGN KEY ("destinatario_cliente_id") REFERENCES "cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

