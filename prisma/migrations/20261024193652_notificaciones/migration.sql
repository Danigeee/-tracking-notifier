-- CreateEnum
CREATE TYPE "EstadoNotificacion" AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA');

-- CreateTable
CREATE TABLE "notificaciones" (
    "tenant_id" TEXT NOT NULL,
    "guia_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "estado" "EstadoNotificacion" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_error" TEXT,
    "ultimo_codigo_http" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("tenant_id","guia_id","event_id")
);

-- CreateIndex
CREATE INDEX "notificaciones_estado_proximo_intento_idx" ON "notificaciones"("estado", "proximo_intento");

-- CreateIndex
CREATE INDEX "notificaciones_tenant_id_estado_created_at_idx" ON "notificaciones"("tenant_id", "estado", "created_at");

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_tenant_id_guia_id_event_id_fkey" FOREIGN KEY ("tenant_id", "guia_id", "event_id") REFERENCES "eventos_guia"("tenant_id", "guia_id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;
