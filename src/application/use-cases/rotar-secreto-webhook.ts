// Caso de uso: generar un secreto de firma nuevo para un cliente.
//
// Sirve cuando el cliente perdió su secreto o sospecha que se filtró. El secreto
// anterior deja de servir de inmediato.

import { WebhookNoConfiguradoError } from "../errores";
import { GeneradorSecretos } from "../ports/generador-secretos";
import { WebhookConfigRepository } from "../ports/webhook-config-repository";

export class RotarSecretoWebhook {
  constructor(
    private readonly webhooks: WebhookConfigRepository,
    private readonly generadorSecretos: GeneradorSecretos,
  ) {}

  /**
   * Reemplaza el secreto del tenant y lo devuelve (es la única vez que se muestra).
   * @throws WebhookNoConfiguradoError si el tenant todavía no configuró su webhook
   */
  async ejecutar(consulta: { readonly tenantId: string }): Promise<string> {
    const nuevo = this.generadorSecretos.generar();
    const rotado = await this.webhooks.rotarSecreto(consulta.tenantId, nuevo);
    if (!rotado) {
      throw new WebhookNoConfiguradoError();
    }
    return nuevo;
  }
}
