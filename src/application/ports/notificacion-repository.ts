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

/** Parámetros para reclamar notificaciones que toca enviar. */
export interface ReclamoNotificaciones {
  /** Momento actual: se reclaman las que ya vencieron (`proximoIntento <= ahora`). */
  readonly ahora: Date;
  /** Máximo de notificaciones a reclamar. */
  readonly limite: number;
  /**
   * Hasta cuándo queda reservada cada notificación reclamada. Mientras no pase ese
   * momento, nadie más puede reclamarla. Si quien la reclamó se cae sin terminar,
   * al vencer la reserva vuelve a estar disponible y no se pierde.
   */
  readonly reservarHasta: Date;
}

/** Notificación lista para enviar, junto con la URL y el secreto de firma de su tenant. */
export interface NotificacionPorEnviar {
  readonly notificacion: Notificacion;
  /** URL de webhook del tenant en el momento de reclamarla. */
  readonly webhookUrl: string;
  /** Secreto con el que se firma el aviso, vigente al reclamarla. */
  readonly webhookSecreto: string;
}

export interface NotificacionRepository {
  /** Guarda una notificación nueva. Debe usarse dentro de la misma transacción que guarda el evento. */
  crear(notificacion: Notificacion): Promise<void>;

  /**
   * Lista las notificaciones de UN tenant, de la más reciente a la más antigua.
   * Nunca devuelve notificaciones de otros tenants.
   */
  listar(consulta: ConsultaNotificaciones): Promise<Notificacion[]>;

  /**
   * Reclama, de forma exclusiva, notificaciones PENDIENTES cuyo momento de envío
   * ya llegó. Solo se reclaman las de tenants que tienen webhook configurado (URL y
   * secreto): las demás quedan pendientes, sin gastar intentos, hasta que lo configuren.
   *
   * Si varias instancias del servicio reclaman a la vez, ninguna notificación se
   * entrega a dos de ellas.
   */
  reclamarPorEnviar(reclamo: ReclamoNotificaciones): Promise<NotificacionPorEnviar[]>;

  /** Guarda el nuevo estado de una notificación existente (intentos, próximo intento, resultado). */
  guardar(notificacion: Notificacion): Promise<void>;
}
