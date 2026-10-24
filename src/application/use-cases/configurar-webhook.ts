// Caso de uso: configurar la URL del webhook de un cliente.

import { WebhookConfigRepository } from "../ports/webhook-config-repository";

/** Datos para configurar el webhook. La URL llega ya validada desde la capa de entrada. */
export interface ConfigurarWebhookComando {
  readonly tenantId: string;
  /** URL a la que se notificará cada evento del tenant. */
  readonly url: string;
}

export class ConfigurarWebhook {
  constructor(private readonly webhooks: WebhookConfigRepository) {}

  /**
   * Guarda la URL del tenant. Si ya tenía una, la reemplaza.
   * @returns la URL guardada
   */
  async ejecutar(comando: ConfigurarWebhookComando): Promise<string> {
    await this.webhooks.guardar(comando.tenantId, comando.url);
    return comando.url;
  }
}
