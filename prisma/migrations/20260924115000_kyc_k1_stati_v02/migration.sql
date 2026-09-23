-- KYC/AML Fase K1 (Malta, spec v0.2 §8) — nuovi stati del ciclo di vita della pratica.
-- A sé rispetto alla creazione tabelle: in Postgres `ALTER TYPE ... ADD VALUE` va isolato dalla
-- transazione in cui il valore verrebbe usato. Qui i valori si aggiungono soltanto (i legacy
-- `in_attesa_revisione`/`scaduto` restano nell'enum, non più scritti dal codice v0.2). Idempotente.
ALTER TYPE "StatoKyc" ADD VALUE IF NOT EXISTS 'in_raccolta';
ALTER TYPE "StatoKyc" ADD VALUE IF NOT EXISTS 'in_verifica';
ALTER TYPE "StatoKyc" ADD VALUE IF NOT EXISTS 'in_attesa_approvazione';
ALTER TYPE "StatoKyc" ADD VALUE IF NOT EXISTS 'sospeso';
ALTER TYPE "StatoKyc" ADD VALUE IF NOT EXISTS 'in_revisione';
ALTER TYPE "StatoKyc" ADD VALUE IF NOT EXISTS 'chiuso';
