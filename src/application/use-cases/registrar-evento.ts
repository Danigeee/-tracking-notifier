// Caso de uso: registrar un cambio de estado de una guía.

import { EstadoGuia } from "../../domain/estado-guia";
import { EventoGuia } from "../../domain/evento-guia";
import { Guia, ResultadoRegistro } from "../../domain/guia";
import { UnidadDeTrabajo } from "../ports/unidad-de-trabajo";

/** Datos necesarios para registrar un evento. Llegan ya validados desde la capa de entrada. */
export interface RegistrarEventoComando {
  /** Cliente que envía el evento (viene de la cabecera X-Tenant-Id). */
  readonly tenantId: string;
  /** Guía a la que pertenece el evento (viene de la URL). */
  readonly guiaId: string;
  /** Identificador único del evento, para la idempotencia. */
  readonly eventId: string;
  readonly estado: EstadoGuia;
  readonly fechaEvento: Date;
  readonly observacion?: string;
}

/** Resultado del caso de uso. */
export interface RegistrarEventoResultado {
  /** REGISTRADO si el evento era nuevo; DUPLICADO si ya se había recibido antes. */
  readonly resultado: ResultadoRegistro;
  /** Estado en el que queda la guía después de la operación. */
  readonly estadoActual: EstadoGuia;
}

export class RegistrarEvento {
  constructor(private readonly unidadDeTrabajo: UnidadDeTrabajo) {}

  /**
   * Registra el evento en la guía del tenant. Si la guía no existe, la crea
   * (el primer evento debe ser CREADA). Todo ocurre dentro de una transacción.
   *
   * @throws PrimerEventoInvalidoError, EventoFueraDeOrdenError o
   *         TransicionInvalidaError si se incumple alguna regla del dominio.
   */
  async ejecutar(comando: RegistrarEventoComando): Promise<RegistrarEventoResultado> {
    const evento: EventoGuia = {
      eventId: comando.eventId,
      estado: comando.estado,
      fechaEvento: comando.fechaEvento,
      observacion: comando.observacion,
    };

    return this.unidadDeTrabajo.ejecutar(async ({ guias }) => {
      const existente = await guias.buscar(comando.tenantId, comando.guiaId);

      // Guía nueva: nace con este evento (lanza error si no es CREADA).
      if (!existente) {
        const guia = Guia.iniciar(comando.guiaId, comando.tenantId, evento);
        await guias.guardar(guia);
        return { resultado: "REGISTRADO", estadoActual: guia.estadoActual };
      }

      // Guía existente: el dominio decide si es nuevo, duplicado o inválido.
      const resultado = existente.registrarEvento(evento);

      // Un duplicado no cambia nada, así que no se guarda de nuevo.
      if (resultado === "REGISTRADO") {
        await guias.guardar(existente);
      }
      return { resultado, estadoActual: existente.estadoActual };
    });
  }
}
