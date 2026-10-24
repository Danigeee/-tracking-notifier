// Caso de uso: consultar la URL del webhook de un cliente.

import { WebhookNoConfiguradoError } from "../errores";
import { WebhookConfigRepository } from "../ports/webhook-config-repository";

export class ConsultarWebhook {
  constructor(private readonly webhooks: WebhookConfigRepository) {}

  /**
   * Devuelve la URL configurada por el tenant.
   * @throws WebhookNoConfiguradoError si todavía no configuró ninguna
   */
  async ejecutar(consulta: { readonly tenantId: string }): Promise<string> {
    const url = await this.webhooks.obtener(consulta.tenantId);
    if (url === null) {
      throw new WebhookNoConfiguradoError();
    }
    return url;
  }
}
