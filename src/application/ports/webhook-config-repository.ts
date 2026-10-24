// Puerto de salida: almacenamiento de la configuración de webhook de cada tenant.

export interface WebhookConfigRepository {
  /**
   * Devuelve la URL de webhook del tenant.
   * @returns la URL, o `null` si el tenant todavía no la configuró.
   */
  obtener(tenantId: string): Promise<string | null>;

  /**
   * Guarda la URL de webhook del tenant, reemplazando la anterior si existía.
   * Si el tenant aún no existe, lo crea.
   *
   * También asegura que el tenant tenga un secreto de firma: si todavía no tenía,
   * guarda `secretoInicial`; si ya tenía uno, lo conserva. Todo en una sola operación
   * atómica, de modo que dos configuraciones simultáneas no se pisen el secreto.
   *
   * @returns el secreto vigente del tenant. Es igual a `secretoInicial` solo si fue
   *          este llamado quien lo creó.
   */
  guardar(tenantId: string, url: string, secretoInicial: string): Promise<string>;

  /**
   * Reemplaza el secreto de firma de un tenant que ya configuró su webhook.
   * @returns `true` si se reemplazó; `false` si el tenant no tiene webhook configurado
   */
  rotarSecreto(tenantId: string, secretoNuevo: string): Promise<boolean>;
}
