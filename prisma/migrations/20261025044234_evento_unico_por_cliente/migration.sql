-- Un eventId identifica un único evento de un cliente: no puede estar en dos guías distintas.
-- CreateIndex
CREATE UNIQUE INDEX "eventos_guia_tenant_id_event_id_key" ON "eventos_guia"("tenant_id", "event_id");
