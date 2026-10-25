// Caso de uso: registrar un cambio de estado de una guía.

import { EstadoGuia } from "../../domain/estado-guia";
import { EventIdYaUsadoError } from "../errores";
import { EventoGuia } from "../../domain/evento-guia";
import { Guia, ResultadoRegistro } from "../../domain/guia";
import { Notificacion } from "../../domain/notificacion";
import { Registrador } from "../ports/registrador";
import { Reloj } from "../ports/reloj";
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
  constructor(
    private readonly unidadDeTrabajo: UnidadDeTrabajo,
    private readonly reloj: Reloj,
    private readonly registrador: Registrador,
  ) {}

  /**
   * Registra el evento en la guía del tenant. Si la guía no existe, la crea
   * (el primer evento debe ser CREADA). Por cada evento aceptado deja creada su
   * notificación pendiente. Todo ocurre en una sola transacción.
   *
   * @throws EventIdYaUsadoError si el eventId ya se usó en otra guía del cliente
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

    const resultado = await this.unidadDeTrabajo.ejecutar<RegistrarEventoResultado>(async ({ guias, notificaciones }) => {
      // El eventId es único por cliente: si ya está en OTRA guía, se rechaza. Esta consulta va
      // primero porque, dentro de la transacción, también bloquea el evento y así dos
      // peticiones simultáneas con el mismo eventId se ejecutan una tras otra.
      const guiaDelEvento = await guias.guiaDelEvento(comando.tenantId, comando.eventId);
      if (guiaDelEvento !== null && guiaDelEvento !== comando.guiaId) {
        throw new EventIdYaUsadoError(comando.eventId);
      }

      const existente = await guias.buscar(comando.tenantId, comando.guiaId);

      // Guía nueva: nace con este evento (lanza error si no es CREADA).
      if (!existente) {
        const guia = Guia.iniciar(comando.guiaId, comando.tenantId, evento);
        await guias.guardar(guia);
        await notificaciones.crear(
          Notificacion.crear(comando.tenantId, comando.guiaId, evento, this.reloj.ahora()),
        );
        return { resultado: "REGISTRADO", estadoActual: guia.estadoActual };
      }

      // Guía existente: el dominio decide si es nuevo, duplicado o inválido.
      const resultado = existente.registrarEvento(evento);

      // Un duplicado no cambia nada: no se guarda ni se crea otra notificación.
      if (resultado === "REGISTRADO") {
        await guias.guardar(existente);
        await notificaciones.crear(
          Notificacion.crear(comando.tenantId, comando.guiaId, evento, this.reloj.ahora()),
        );
      }
      return { resultado, estadoActual: existente.estadoActual };
    });

    // Se registra después de confirmar la transacción: si hubiera fallado, no queda un
    // log que diga que el evento se aceptó. No se incluye la observación (texto libre).
    this.registrador.info(
      resultado.resultado === "REGISTRADO" ? "evento registrado" : "evento duplicado ignorado",
      {
        tenantId: comando.tenantId,
        guiaId: comando.guiaId,
        eventId: comando.eventId,
        estado: comando.estado,
      },
    );
    return resultado;
  }
}
