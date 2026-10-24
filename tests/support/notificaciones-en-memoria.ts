// Implementación en memoria del puerto NotificacionRepository, solo para pruebas.

import {
  ConsultaNotificaciones,
  NotificacionRepository,
} from "../../src/application/ports/notificacion-repository";
import { Notificacion } from "../../src/domain/notificacion";

export class NotificacionRepositoryEnMemoria implements NotificacionRepository {
  /** Notificaciones en orden de creación. */
  private readonly almacen: Notificacion[] = [];

  async crear(notificacion: Notificacion): Promise<void> {
    this.almacen.push(notificacion);
  }

  async listar(consulta: ConsultaNotificaciones): Promise<Notificacion[]> {
    return this.almacen
      .filter((n) => n.tenantId === consulta.tenantId)
      .filter((n) => !consulta.estado || n.estado === consulta.estado)
      .reverse() // la más reciente primero
      .slice(0, consulta.limite);
  }

  /** Todas las notificaciones guardadas, de cualquier tenant. Solo para comprobar en las pruebas. */
  todas(): readonly Notificacion[] {
    return [...this.almacen];
  }
}
