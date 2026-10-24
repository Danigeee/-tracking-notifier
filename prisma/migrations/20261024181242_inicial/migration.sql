-- CreateEnum
CREATE TYPE "EstadoGuia" AS ENUM ('CREADA', 'EN_RUTA', 'ENTREGADA', 'DEVUELTA');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "webhook_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guias" (
    "tenant_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guias_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "eventos_guia" (
    "tenant_id" TEXT NOT NULL,
    "guia_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "estado" "EstadoGuia" NOT NULL,
    "fecha_evento" TIMESTAMPTZ(3) NOT NULL,
    "observacion" TEXT,
    "secuencia" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_guia_pkey" PRIMARY KEY ("tenant_id","guia_id","event_id")
);

-- CreateIndex
CREATE INDEX "eventos_guia_tenant_id_guia_id_secuencia_idx" ON "eventos_guia"("tenant_id", "guia_id", "secuencia");

-- AddForeignKey
ALTER TABLE "guias" ADD CONSTRAINT "guias_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_guia" ADD CONSTRAINT "eventos_guia_tenant_id_guia_id_fkey" FOREIGN KEY ("tenant_id", "guia_id") REFERENCES "guias"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
