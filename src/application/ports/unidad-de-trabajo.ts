// Puerto de salida: unidad de trabajo (transacción).
//
// Permite ejecutar varias operaciones de almacenamiento como un bloque
// atómico: o todas se confirman o ninguna. Se usa para guardar el evento y su
// notificación pendiente juntos, de modo que nunca se acepte un evento sin
// dejar registrada la notificación que le corresponde.

import { GuiaRepository } from "./guia-repository";
import { NotificacionRepository } from "./notificacion-repository";

/**
 * Repositorios que participan en la transacción en curso.
 * Todos comparten la misma transacción.
 */
export interface RepositoriosTransaccionales {
  readonly guias: GuiaRepository;
  readonly notificaciones: NotificacionRepository;
}

export interface UnidadDeTrabajo {
  /**
   * Ejecuta `trabajo` dentro de una transacción.
   * Si `trabajo` termina bien, se confirman los cambios; si lanza un error,
   * se descartan todos y el error se propaga a quien llamó.
   */
  ejecutar<T>(trabajo: (repositorios: RepositoriosTransaccionales) => Promise<T>): Promise<T>;
}
