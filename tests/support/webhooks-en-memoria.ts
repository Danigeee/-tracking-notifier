// Implementación en memoria del puerto WebhookConfigRepository, solo para pruebas.

import { WebhookConfigRepository } from "../../src/application/ports/webhook-config-repository";

/** Guarda la URL y el secreto de cada tenant en Maps. */
export class WebhookConfigRepositoryEnMemoria implements WebhookConfigRepository {
  private readonly urls = new Map<string, string>();
  private readonly secretos = new Map<string, string>();

  async obtener(tenantId: string): Promise<string | null> {
    return this.urls.get(tenantId) ?? null;
  }

  async guardar(tenantId: string, url: string, secretoInicial: string): Promise<string> {
    this.urls.set(tenantId, url);
    // Se conserva el secreto que ya existía; solo se usa el inicial si no había ninguno.
    if (!this.secretos.has(tenantId)) {
      this.secretos.set(tenantId, secretoInicial);
    }
    return this.secretos.get(tenantId)!;
  }

  async rotarSecreto(tenantId: string, secretoNuevo: string): Promise<boolean> {
    // Solo se puede rotar si el tenant ya configuró su webhook.
    if (!this.urls.has(tenantId)) return false;
    this.secretos.set(tenantId, secretoNuevo);
    return true;
  }

  /** Secreto vigente de un tenant. Solo para comprobar en las pruebas. */
  secretoDe(tenantId: string): string | null {
    return this.secretos.get(tenantId) ?? null;
  }
}
