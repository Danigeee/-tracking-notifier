// Implementación en memoria del puerto WebhookConfigRepository, solo para pruebas.

import { WebhookConfigRepository } from "../../src/application/ports/webhook-config-repository";

/** Guarda la URL de cada tenant en un Map. */
export class WebhookConfigRepositoryEnMemoria implements WebhookConfigRepository {
  private readonly urls = new Map<string, string>();

  async obtener(tenantId: string): Promise<string | null> {
    return this.urls.get(tenantId) ?? null;
  }

  async guardar(tenantId: string, url: string): Promise<void> {
    this.urls.set(tenantId, url);
  }
}
