-- CreateEnum
CREATE TYPE "RuoloUtente" AS ENUM ('super_admin', 'advisor', 'collaboratore_interno', 'collaboratore_esterno', 'cliente');

-- CreateEnum
CREATE TYPE "StatoUtente" AS ENUM ('attivo', 'invitato', 'disattivato');

-- CreateEnum
CREATE TYPE "TipoGiurisdizione" AS ENUM ('ue', 'extra_ue', 'stato_usa', 'altro');

-- CreateEnum
CREATE TYPE "TipoPassaggio" AS ENUM ('info', 'documento', 'form', 'verifica');

-- CreateEnum
CREATE TYPE "ChiPassaggio" AS ENUM ('operatore', 'cliente');

-- CreateEnum
CREATE TYPE "StatoPreventivo" AS ENUM ('bozza', 'inviato', 'accettato', 'rifiutato');

-- CreateEnum
CREATE TYPE "StatoProgetto" AS ENUM ('pre_project', 'in_progress', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "StatoModulo" AS ENUM ('pending', 'attesa_dipendenza', 'in_progress', 'delayed', 'blocked', 'done');

-- CreateEnum
CREATE TYPE "StatoMicrovoce" AS ENUM ('pending', 'attesa_dipendenza', 'active', 'delayed', 'blocked', 'done');

-- CreateEnum
CREATE TYPE "StatoScansione" AS ENUM ('in_corso', 'pulito', 'infetto');

-- CreateEnum
CREATE TYPE "FrequenzaContratto" AS ENUM ('mensile', 'trimestrale', 'semestrale', 'annuale');

-- CreateEnum
CREATE TYPE "StatoContrattoRicorrente" AS ENUM ('attivo', 'sospeso', 'concluso');

-- CreateEnum
CREATE TYPE "TipoDocumentoFiscale" AS ENUM ('fattura', 'nota_credito');

-- CreateEnum
CREATE TYPE "StatoFattura" AS ENUM ('bozza', 'emessa', 'incassata', 'annullata');

-- CreateEnum
CREATE TYPE "TipoClienteFiscale" AS ENUM ('privato_italia', 'business_italia', 'estero');

-- CreateEnum
CREATE TYPE "CanaleFattura" AS ENUM ('sdi', 'standard');

-- CreateEnum
CREATE TYPE "StatoSdi" AS ENUM ('n_a', 'inviata', 'consegnata', 'scartata', 'mancata_consegna');

-- CreateEnum
CREATE TYPE "StatoScadenzaIncasso" AS ENUM ('in_attesa', 'incassato', 'parziale', 'scaduto');

-- CreateEnum
CREATE TYPE "MetodoPagamento" AS ENUM ('bonifico', 'carta', 'assegno', 'contanti', 'stripe');

-- CreateEnum
CREATE TYPE "TipoFatturaRiga" AS ENUM ('modulo_completo', 'modulo_parziale', 'milestone_libera');

-- CreateEnum
CREATE TYPE "LivelloAccesso" AS ENUM ('lettura', 'scrittura');

-- CreateEnum
CREATE TYPE "PermessoLivello" AS ENUM ('denied', 'read', 'write');

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "ragione_sociale" TEXT NOT NULL,
    "piva" TEXT,
    "codice_fiscale" TEXT,
    "sede_legale" TEXT,
    "sede_operativa" TEXT,
    "logo_url" TEXT,
    "colore_tema_fattura" TEXT,
    "note_pie_fattura" TEXT,
    "titolo_intestazione" TEXT,
    "iban" TEXT,
    "email" TEXT,
    "pec" TEXT,
    "telefono" TEXT,
    "wa_phone_id" TEXT,
    "wa_access_token" TEXT,
    "wa_verify_token" TEXT,
    "tg_bot_token" TEXT,
    "tg_bot_username" TEXT,
    "smtp_host" TEXT,
    "smtp_port" INTEGER,
    "smtp_secure" BOOLEAN DEFAULT false,
    "smtp_user" TEXT,
    "smtp_pass" TEXT,
    "smtp_from_email" TEXT,
    "smtp_from_name" TEXT,
    "smtp_reply_to" TEXT,
    "smtp_bcc" TEXT,
    "imap_host" TEXT,
    "imap_port" INTEGER,
    "imap_secure" BOOLEAN DEFAULT true,
    "imap_user" TEXT,
    "imap_pass" TEXT,
    "imap_folder" TEXT DEFAULT 'INBOX',
    "imap_poll_interval" TEXT DEFAULT '5m',
    "imap_protocol" TEXT DEFAULT 'imap',
    "email_signature_html" TEXT,
    "regime_fiscale" TEXT,
    "capitale_sociale" TEXT,
    "reg_imprese" TEXT,
    "mostra_sdi" BOOLEAN DEFAULT true,
    "mostra_iva" BOOLEAN DEFAULT true,
    "email_inbound_parse_url" TEXT,
    "signal_cli_endpoint" TEXT,
    "lead_advisor_nome" TEXT,
    "lead_advisor_email" TEXT,
    "lead_advisor_password" TEXT,
    "giurisdizione" TEXT,
    "durata_mesi" INTEGER DEFAULT 12,
    "data_attivazione" TEXT,
    "data_scadenza" TEXT,
    "piano" TEXT NOT NULL DEFAULT 'enterprise',
    "stato" TEXT NOT NULL DEFAULT 'attivo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ruolo" "RuoloUtente" NOT NULL,
    "stato" "StatoUtente" NOT NULL DEFAULT 'invitato',
    "password_hash" TEXT,
    "totp_secret" TEXT,
    "specializzazione" TEXT,
    "costo_orario_centesimi" INTEGER DEFAULT 3000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "piva" TEXT,
    "codice_fiscale" TEXT,
    "giurisdizione" TEXT,
    "sede_legale" TEXT,
    "sdi_code" TEXT,
    "iban" TEXT,
    "rischio_aml" TEXT,
    "ubo" TEXT,
    "fonte_patrimonio" TEXT,
    "data_kyc" TEXT,
    "referenti_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articolo" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "ore_default" INTEGER NOT NULL,
    "prezzo_default" INTEGER NOT NULL,
    "documento_allegato_url" TEXT,
    "form_master_id" TEXT,
    "link_istruzioni" TEXT,
    "is_ultima_versione" BOOLEAN NOT NULL DEFAULT true,
    "is_attivo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "articolo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulo_template" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "prezzo_pacchetto" INTEGER,
    "is_ultima_versione" BOOLEAN NOT NULL DEFAULT true,
    "is_attivo" BOOLEAN NOT NULL DEFAULT true,
    "giurisdizione_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modulo_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giurisdizione" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "codice" TEXT NOT NULL,
    "tipo" "TipoGiurisdizione" NOT NULL DEFAULT 'ue',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "giurisdizione_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riga_distinta" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modulo_template_id" TEXT NOT NULL,
    "articolo_id" TEXT NOT NULL,
    "articolo_versione" INTEGER NOT NULL,
    "ordine" INTEGER NOT NULL,
    "quantita" INTEGER NOT NULL DEFAULT 1,
    "override_ore" INTEGER,
    "override_prezzo" INTEGER,
    "obbligatorio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "riga_distinta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passaggio_template" (
    "id" TEXT NOT NULL,
    "articolo_id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "tipo" "TipoPassaggio" NOT NULL,
    "chi" "ChiPassaggio" NOT NULL,
    "ordine" INTEGER NOT NULL,
    "descrizione" TEXT,
    "campi_form_json" JSONB,

    CONSTRAINT "passaggio_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulo_dipendenza_template" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modulo_template_id" TEXT NOT NULL,
    "dipende_da_modulo_template_id" TEXT NOT NULL,

    CONSTRAINT "modulo_dipendenza_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preventivo" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,
    "stato" "StatoPreventivo" NOT NULL DEFAULT 'bozza',
    "righe_json" JSONB NOT NULL,
    "valore_totale" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preventivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_letter" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "preventivo_id" TEXT NOT NULL,
    "stato_firma" TEXT NOT NULL DEFAULT 'in_attesa',
    "link_firma" TEXT,
    "firmato_at" TIMESTAMP(3),

    CONSTRAINT "engagement_letter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progetto" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "stato" "StatoProgetto" NOT NULL DEFAULT 'pre_project',
    "data_inizio" TIMESTAMP(3),
    "data_scadenza" TIMESTAMP(3),
    "valore_totale" INTEGER NOT NULL,
    "giurisdizione_primaria_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progetto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulo_progetto" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,
    "modulo_template_id" TEXT NOT NULL,
    "modulo_template_versione" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "prezzo" INTEGER NOT NULL,
    "ore_preventivate" INTEGER NOT NULL,
    "ore_consuntivate" INTEGER NOT NULL DEFAULT 0,
    "stato" "StatoModulo" NOT NULL DEFAULT 'pending',

    CONSTRAINT "modulo_progetto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "microvoce_progetto" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modulo_progetto_id" TEXT NOT NULL,
    "articolo_id" TEXT NOT NULL,
    "articolo_versione" INTEGER NOT NULL,
    "riga_distinta_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ore_preventivate" INTEGER NOT NULL,
    "ore_consuntivate" INTEGER NOT NULL DEFAULT 0,
    "stato" "StatoMicrovoce" NOT NULL DEFAULT 'pending',
    "segnale_rischio" BOOLEAN NOT NULL DEFAULT false,
    "ore_extra" INTEGER NOT NULL DEFAULT 0,
    "causa_nota" TEXT,
    "risorsa_id" TEXT,
    "ordine" INTEGER NOT NULL,

    CONSTRAINT "microvoce_progetto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passaggio_progetto" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "microvoce_progetto_id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "tipo" "TipoPassaggio" NOT NULL,
    "chi" "ChiPassaggio" NOT NULL,
    "ordine" INTEGER NOT NULL,
    "descrizione" TEXT,
    "campi_form_json" JSONB,
    "stato" TEXT NOT NULL DEFAULT 'pending',
    "documento_id" TEXT,
    "risposte_form_json" JSONB,
    "note_operatore_json" JSONB,
    "richiede_firma_cliente" BOOLEAN NOT NULL DEFAULT false,
    "documento_allegato_url" TEXT,
    "form_master_id" TEXT,
    "link_istruzioni" TEXT,

    CONSTRAINT "passaggio_progetto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modello_documento_in_bianco" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "richiede_firma" BOOLEAN NOT NULL DEFAULT true,
    "descrizione" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "modello_documento_in_bianco_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_master" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "campi_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulo_progetto_dipendenza" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "modulo_progetto_id" TEXT NOT NULL,
    "dipende_da_modulo_progetto_id" TEXT NOT NULL,

    CONSTRAINT "modulo_progetto_dipendenza_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "microvoce_progetto_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "caricato_da" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stato_scansione" "StatoScansione" NOT NULL DEFAULT 'in_corso',
    "scansionato_at" TIMESTAMP(3),
    "data_scadenza_doc" TIMESTAMP(3),
    "categoria_doc" TEXT DEFAULT 'generico',
    "avviso_scadenza_inviato" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_voce" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "passaggio_progetto_id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "obbligatorio" BOOLEAN NOT NULL DEFAULT false,
    "completato" BOOLEAN NOT NULL DEFAULT false,
    "completato_da" TEXT,
    "completato_at" TIMESTAMP(3),

    CONSTRAINT "checklist_voce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratto_ricorrente" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "progetto_id" TEXT,
    "titolo" TEXT NOT NULL,
    "frequenza" "FrequenzaContratto" NOT NULL DEFAULT 'mensile',
    "importo_centesimi" INTEGER NOT NULL,
    "prossima_fatturazione" TIMESTAMP(3) NOT NULL,
    "stato" "StatoContrattoRicorrente" NOT NULL DEFAULT 'attivo',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contratto_ricorrente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fattura" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,
    "tipo_documento" "TipoDocumentoFiscale" NOT NULL DEFAULT 'fattura',
    "serie" TEXT NOT NULL DEFAULT 'FT',
    "numero_progressivo_serie" INTEGER NOT NULL DEFAULT 1,
    "numero" TEXT,
    "data" TIMESTAMP(3),
    "stato" "StatoFattura" NOT NULL DEFAULT 'bozza',
    "fattura_riferimento_id" TEXT,
    "causa_nota_credito" TEXT,
    "tipo_cliente_fiscale" "TipoClienteFiscale" NOT NULL,
    "partita_iva" TEXT,
    "codice_fiscale" TEXT,
    "numero_progressivo" TEXT,
    "canale" "CanaleFattura" NOT NULL,
    "stato_sdi" "StatoSdi" NOT NULL DEFAULT 'n_a',

    CONSTRAINT "fattura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scadenza_incasso" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fattura_id" TEXT NOT NULL,
    "numero_rata" INTEGER NOT NULL DEFAULT 1,
    "importo_centesimi" INTEGER NOT NULL,
    "data_scadenza" TIMESTAMP(3) NOT NULL,
    "stato" "StatoScadenzaIncasso" NOT NULL DEFAULT 'in_attesa',
    "note" TEXT,

    CONSTRAINT "scadenza_incasso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrazione_incasso" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "scadenza_incasso_id" TEXT,
    "fattura_id" TEXT NOT NULL,
    "importo_incassato_centesimi" INTEGER NOT NULL,
    "data_incasso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metodo_pagamento" "MetodoPagamento" NOT NULL DEFAULT 'bonifico',
    "riferimento_transazione" TEXT,
    "note_operatore" TEXT,

    CONSTRAINT "registrazione_incasso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fattura_riga" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fattura_id" TEXT NOT NULL,
    "tipo" "TipoFatturaRiga" NOT NULL,
    "modulo_progetto_id" TEXT,
    "percentuale" INTEGER,
    "importo" INTEGER NOT NULL,
    "descrizione" TEXT NOT NULL,

    CONSTRAINT "fattura_riga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_calendario" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "progetto_id" TEXT,
    "titolo" TEXT NOT NULL,
    "data_inizio" TIMESTAMP(3) NOT NULL,
    "data_fine" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evento_calendario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accesso_risorsa" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "progetto_id" TEXT,
    "modulo_progetto_id" TEXT,
    "microvoce_progetto_id" TEXT,
    "livello" "LivelloAccesso" NOT NULL,
    "invitato_da" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accesso_risorsa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permesso_modulo" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "modulo_chiave" TEXT NOT NULL,
    "livello" "PermessoLivello" NOT NULL DEFAULT 'write',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permesso_modulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifica" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "destinatario_id" TEXT NOT NULL,
    "destinatario_tipo" TEXT NOT NULL,
    "canale" TEXT NOT NULL DEFAULT 'email',
    "oggetto" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "stato_lettura" TEXT NOT NULL DEFAULT 'non_letta',
    "inviata_at" TIMESTAMP(3),

    CONSTRAINT "notifica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "user_nome" TEXT NOT NULL,
    "ruolo" TEXT NOT NULL,
    "azione" TEXT NOT NULL,
    "entita" TEXT NOT NULL,
    "dettagli" TEXT NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comunicazione_progetto" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "progetto_id" TEXT NOT NULL,
    "canale" TEXT NOT NULL,
    "mittente" TEXT NOT NULL,
    "destinatario" TEXT NOT NULL,
    "direzione" TEXT NOT NULL DEFAULT 'entrata',
    "testo" TEXT NOT NULL,
    "allegati_json" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comunicazione_progetto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conto_bancario" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nome_conto" TEXT NOT NULL,
    "banca" TEXT NOT NULL,
    "iban" TEXT,
    "bic_swift" TEXT,
    "saldo_iniziale" INTEGER NOT NULL DEFAULT 0,
    "saldo_attuale" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conto_bancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modello_documento_custom" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'contratto',
    "descrizione" TEXT,
    "contenuto_html" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modello_documento_custom_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_letter_preventivo_id_key" ON "engagement_letter"("preventivo_id");

-- CreateIndex
CREATE UNIQUE INDEX "passaggio_progetto_documento_id_key" ON "passaggio_progetto"("documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "fattura_numero_progressivo_key" ON "fattura"("numero_progressivo");

-- CreateIndex
CREATE UNIQUE INDEX "permesso_modulo_tenant_id_user_id_modulo_chiave_key" ON "permesso_modulo"("tenant_id", "user_id", "modulo_chiave");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articolo" ADD CONSTRAINT "articolo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_template" ADD CONSTRAINT "modulo_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_template" ADD CONSTRAINT "modulo_template_giurisdizione_id_fkey" FOREIGN KEY ("giurisdizione_id") REFERENCES "giurisdizione"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giurisdizione" ADD CONSTRAINT "giurisdizione_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riga_distinta" ADD CONSTRAINT "riga_distinta_modulo_template_id_fkey" FOREIGN KEY ("modulo_template_id") REFERENCES "modulo_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riga_distinta" ADD CONSTRAINT "riga_distinta_articolo_id_fkey" FOREIGN KEY ("articolo_id") REFERENCES "articolo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passaggio_template" ADD CONSTRAINT "passaggio_template_articolo_id_fkey" FOREIGN KEY ("articolo_id") REFERENCES "articolo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_dipendenza_template" ADD CONSTRAINT "modulo_dipendenza_template_modulo_template_id_fkey" FOREIGN KEY ("modulo_template_id") REFERENCES "modulo_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_dipendenza_template" ADD CONSTRAINT "modulo_dipendenza_template_dipende_da_modulo_template_id_fkey" FOREIGN KEY ("dipende_da_modulo_template_id") REFERENCES "modulo_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventivo" ADD CONSTRAINT "preventivo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preventivo" ADD CONSTRAINT "preventivo_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_letter" ADD CONSTRAINT "engagement_letter_preventivo_id_fkey" FOREIGN KEY ("preventivo_id") REFERENCES "preventivo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progetto" ADD CONSTRAINT "progetto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progetto" ADD CONSTRAINT "progetto_giurisdizione_primaria_id_fkey" FOREIGN KEY ("giurisdizione_primaria_id") REFERENCES "giurisdizione"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_progetto" ADD CONSTRAINT "modulo_progetto_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_progetto" ADD CONSTRAINT "modulo_progetto_modulo_template_id_fkey" FOREIGN KEY ("modulo_template_id") REFERENCES "modulo_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "microvoce_progetto" ADD CONSTRAINT "microvoce_progetto_modulo_progetto_id_fkey" FOREIGN KEY ("modulo_progetto_id") REFERENCES "modulo_progetto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "microvoce_progetto" ADD CONSTRAINT "microvoce_progetto_articolo_id_fkey" FOREIGN KEY ("articolo_id") REFERENCES "articolo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "microvoce_progetto" ADD CONSTRAINT "microvoce_progetto_riga_distinta_id_fkey" FOREIGN KEY ("riga_distinta_id") REFERENCES "riga_distinta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "microvoce_progetto" ADD CONSTRAINT "microvoce_progetto_risorsa_id_fkey" FOREIGN KEY ("risorsa_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passaggio_progetto" ADD CONSTRAINT "passaggio_progetto_microvoce_progetto_id_fkey" FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passaggio_progetto" ADD CONSTRAINT "passaggio_progetto_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_progetto_dipendenza" ADD CONSTRAINT "modulo_progetto_dipendenza_modulo_progetto_id_fkey" FOREIGN KEY ("modulo_progetto_id") REFERENCES "modulo_progetto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modulo_progetto_dipendenza" ADD CONSTRAINT "modulo_progetto_dipendenza_dipende_da_modulo_progetto_id_fkey" FOREIGN KEY ("dipende_da_modulo_progetto_id") REFERENCES "modulo_progetto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_microvoce_progetto_id_fkey" FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_caricato_da_fkey" FOREIGN KEY ("caricato_da") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_voce" ADD CONSTRAINT "checklist_voce_passaggio_progetto_id_fkey" FOREIGN KEY ("passaggio_progetto_id") REFERENCES "passaggio_progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratto_ricorrente" ADD CONSTRAINT "contratto_ricorrente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratto_ricorrente" ADD CONSTRAINT "contratto_ricorrente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratto_ricorrente" ADD CONSTRAINT "contratto_ricorrente_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fattura" ADD CONSTRAINT "fattura_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scadenza_incasso" ADD CONSTRAINT "scadenza_incasso_fattura_id_fkey" FOREIGN KEY ("fattura_id") REFERENCES "fattura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrazione_incasso" ADD CONSTRAINT "registrazione_incasso_scadenza_incasso_id_fkey" FOREIGN KEY ("scadenza_incasso_id") REFERENCES "scadenza_incasso"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrazione_incasso" ADD CONSTRAINT "registrazione_incasso_fattura_id_fkey" FOREIGN KEY ("fattura_id") REFERENCES "fattura"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fattura_riga" ADD CONSTRAINT "fattura_riga_fattura_id_fkey" FOREIGN KEY ("fattura_id") REFERENCES "fattura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fattura_riga" ADD CONSTRAINT "fattura_riga_modulo_progetto_id_fkey" FOREIGN KEY ("modulo_progetto_id") REFERENCES "modulo_progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_calendario" ADD CONSTRAINT "evento_calendario_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_calendario" ADD CONSTRAINT "evento_calendario_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesso_risorsa" ADD CONSTRAINT "accesso_risorsa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesso_risorsa" ADD CONSTRAINT "accesso_risorsa_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesso_risorsa" ADD CONSTRAINT "accesso_risorsa_modulo_progetto_id_fkey" FOREIGN KEY ("modulo_progetto_id") REFERENCES "modulo_progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesso_risorsa" ADD CONSTRAINT "accesso_risorsa_microvoce_progetto_id_fkey" FOREIGN KEY ("microvoce_progetto_id") REFERENCES "microvoce_progetto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accesso_risorsa" ADD CONSTRAINT "accesso_risorsa_invitato_da_fkey" FOREIGN KEY ("invitato_da") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permesso_modulo" ADD CONSTRAINT "permesso_modulo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permesso_modulo" ADD CONSTRAINT "permesso_modulo_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifica" ADD CONSTRAINT "notifica_destinatario_id_fkey" FOREIGN KEY ("destinatario_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicazione_progetto" ADD CONSTRAINT "comunicazione_progetto_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicazione_progetto" ADD CONSTRAINT "comunicazione_progetto_progetto_id_fkey" FOREIGN KEY ("progetto_id") REFERENCES "progetto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conto_bancario" ADD CONSTRAINT "conto_bancario_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modello_documento_custom" ADD CONSTRAINT "modello_documento_custom_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

