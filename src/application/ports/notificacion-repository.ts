// Puerto de salida: almacenamiento de notificaciones.

import { EstadoNotificacion, Notificacion } from "../../domain/notificacion";

/** Filtros para listar las notificaciones de un tenant. */
export interface ConsultaNotificaciones {
  readonly tenantId: string;
  /** Si se indica, solo las que están en ese estado. */
  readonly estado?: EstadoNotificacion;
  /** Máximo de resultados. */
  readonly limite: number;
}

export interface NotificacionRepository {
  /** Guarda una notificación nueva. Debe usarse dentro de la misma transacción que guarda el evento. */
  crear(notificacion: Notificacion): Promise<void>;

  /**
   * Lista las notificaciones de UN tenant, de la más reciente a la más antigua.
   * Nunca devuelve notificaciones de otros tenants.
   */
  listar(consulta: ConsultaNotificaciones): Promise<Notificacion[]>;
}
