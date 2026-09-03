-- Fase 3 FEA (piano firma §4) — certificato di sessione e identificazione del firmatario.
-- Solo colonne additive nullable su firma_elettronica: le righe già registrate sono
-- atti probatori e non si toccano (vincolo 9 esteso ai valori probatori).

-- Misura 3: id della sessione portale e momento del login, nel digest del sigillo.
ALTER TABLE "firma_elettronica" ADD COLUMN "session_id" TEXT,
ADD COLUMN "login_at" TIMESTAMP(3);

-- Misura 1: documento di riconoscimento del firmatario (hash + tipo), nel digest quando presente.
ALTER TABLE "firma_elettronica" ADD COLUMN "doc_riconoscimento_hash" TEXT,
ADD COLUMN "doc_riconoscimento_tipo" TEXT;
