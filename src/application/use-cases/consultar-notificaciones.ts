// Caso de uso: consultar las notificaciones de un cliente (por ejemplo, las fallidas).

import { EstadoNotificacion, Notificacion } from "../../domain/notificacion";
import { NotificacionRepository } from "../ports/notificacion-repository";

/** Filtros de la consulta. */
export interface ConsultarNotificacionesConsulta {
  /** Cliente que consulta (viene de la cabecera X-Tenant-Id). */
  readonly tenantId: string;
  /** Si se indica, solo las notificaciones en ese estado. */
  readonly estado?: EstadoNotificacion;
  /** Máximo de resultados. */
  readonly limite: number;
}

export class ConsultarNotificaciones {
  constructor(private readonly notificaciones: NotificacionRepository) {}

  /**
   * Lista las notificaciones del tenant, de la más reciente a la más antigua.
   * Solo ve las suyas: el filtro por tenant lo aplica el repositorio.
   */
  async ejecutar(consulta: ConsultarNotificacionesConsulta): Promise<readonly Notificacion[]> {
    return this.notificaciones.listar(consulta);
  }
}
