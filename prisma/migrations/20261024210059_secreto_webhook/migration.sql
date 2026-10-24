-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "webhook_secret" TEXT;

-- Los clientes que ya tenían webhook configurado reciben un secreto generado al azar
-- (64 caracteres hexadecimales, con el mismo formato "whsec_" que los nuevos). Sin
-- secreto no se les podría firmar los avisos y quedarían sin enviarse.
UPDATE "tenants"
SET "webhook_secret" = 'whsec_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE "webhook_url" IS NOT NULL AND "webhook_secret" IS NULL;
