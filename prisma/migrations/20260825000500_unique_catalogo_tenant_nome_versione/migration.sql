-- §Blocco 7 (fix): vincolo anti-duplicato sul catalogo.
-- I doppioni esistenti (stesso tenant, stesso nome, stessa versione) sono stati
-- ripuliti con scripts/pulizia-duplicati-catalogo.mjs prima di questo vincolo.

-- CreateIndex
CREATE UNIQUE INDEX "articolo_tenant_id_nome_versione_key" ON "articolo"("tenant_id", "nome", "versione");

-- CreateIndex
CREATE UNIQUE INDEX "modulo_template_tenant_id_nome_versione_key" ON "modulo_template"("tenant_id", "nome", "versione");
