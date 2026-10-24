// Evento de cambio de estado de una guía.

import { EstadoGuia } from "./estado-guia";

/**
 * Registro inmutable de un cambio de estado de una guía.
 *
 * Los datos llegan ya validados desde la capa de entrada (formato de UUID,
 * fecha ISO 8601 válida, etc.); el dominio solo aplica las reglas de negocio.
 */
export interface EventoGuia {
  /** Identificador único del evento, asignado por el sistema que lo envía (UUID). Sirve para la idempotencia. */
  readonly eventId: string;
  /** Estado al que pasa la guía con este evento. */
  readonly estado: EstadoGuia;
  /** Momento en que ocurrió el cambio de estado según el sistema de origen. */
  readonly fechaEvento: Date;
  /** Comentario libre opcional. Puede contener texto del cliente, por eso no se registra en logs. */
  readonly observacion?: string;
}
