// Caso de uso: configurar la URL del webhook de un cliente.

import { GeneradorSecretos } from "../ports/generador-secretos";
import { WebhookConfigRepository } from "../ports/webhook-config-repository";

/** Datos para configurar el webhook. La URL llega ya validada desde la capa de entrada. */
export interface ConfigurarWebhookComando {
  readonly tenantId: string;
  /** URL a la que se notificará cada evento del tenant. */
  readonly url: string;
}

/** Resultado de configurar el webhook. */
export interface ConfigurarWebhookResultado {
  /** URL que quedó guardada. */
  readonly url: string;
  /**
   * Secreto de firma. Solo viene la primera vez que el cliente configura su webhook
   * (cuando se crea): es la única oportunidad de verlo. Si ya tenía uno, es `null`
   * y se conserva el anterior; para obtener otro se debe rotar.
   */
  readonly secreto: string | null;
}

export class ConfigurarWebhook {
  constructor(
    private readonly webhooks: WebhookConfigRepository,
    private readonly generadorSecretos: GeneradorSecretos,
  ) {}

  /**
   * Guarda la URL del tenant. Si ya tenía una, la reemplaza.
   * Si es la primera vez, además crea su secreto de firma y lo devuelve.
   */
  async ejecutar(comando: ConfigurarWebhookComando): Promise<ConfigurarWebhookResultado> {
    // Se propone un secreto nuevo; el repositorio lo usa solo si el tenant no tenía uno.
    const propuesto = this.generadorSecretos.generar();
    const vigente = await this.webhooks.guardar(comando.tenantId, comando.url, propuesto);

    // Si el vigente es el propuesto, este llamado lo creó y se muestra una única vez.
    return { url: comando.url, secreto: vigente === propuesto ? propuesto : null };
  }
}
