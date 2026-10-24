// Puerto de salida: almacenamiento de la URL de webhook de cada tenant.

export interface WebhookConfigRepository {
  /**
   * Devuelve la URL de webhook del tenant.
   * @returns la URL, o `null` si el tenant todavía no la configuró.
   */
  obtener(tenantId: string): Promise<string | null>;

  /**
   * Guarda la URL de webhook del tenant, reemplazando la anterior si existía.
   * Si el tenant aún no existe, lo crea.
   */
  guardar(tenantId: string, url: string): Promise<void>;
}
