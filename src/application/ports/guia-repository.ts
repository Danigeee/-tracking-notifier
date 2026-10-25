// Puerto de salida: almacenamiento de guías.
//
// Es solo una interfaz. La implementación real (PostgreSQL) vive en la capa de
// infraestructura; la aplicación y el dominio no saben cómo se guardan los datos.

import { Guia } from "../../domain/guia";

export interface GuiaRepository {
  /**
   * Busca una guía de un tenant.
   * Siempre se filtra por tenant: una guía de otro cliente nunca se devuelve.
   * @returns la guía, o `null` si no existe para ese tenant.
   */
  buscar(tenantId: string, guiaId: string): Promise<Guia | null>;

  /**
   * Indica en qué guía de un tenant está registrado un evento.
   * Sirve para impedir que el mismo `eventId` se use en dos guías distintas.
   * @returns el identificador de la guía, o `null` si el evento no existe para ese tenant.
   */
  guiaDelEvento(tenantId: string, eventId: string): Promise<string | null>;

  /**
   * Guarda la guía con su historial actual.
   * Si la guía es nueva la crea; si ya existía, agrega los eventos que falten.
   */
  guardar(guia: Guia): Promise<void>;
}
