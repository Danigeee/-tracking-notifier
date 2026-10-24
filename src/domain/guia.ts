// Entidad Guía: guarda el historial de eventos y protege las reglas de negocio.

import { PrimerEventoInvalidoError, EventoFueraDeOrdenError } from "./errores";
import { EstadoGuia, validarTransicion } from "./estado-guia";
import { EventoGuia } from "./evento-guia";

/**
 * Resultado de registrar un evento en una guía.
 *  - REGISTRADO: el evento era nuevo y se agregó al historial.
 *  - DUPLICADO: ese `eventId` ya estaba registrado; no se hizo nada.
 */
export type ResultadoRegistro = "REGISTRADO" | "DUPLICADO";

/**
 * Una guía de envío de un cliente (tenant).
 *
 * Invariantes que la clase garantiza:
 *  - Siempre tiene al menos un evento y el primero es CREADA.
 *  - Los eventos están en orden cronológico.
 *  - Cada cambio de estado cumple las transiciones permitidas.
 *  - Ningún `eventId` aparece dos veces.
 *
 * No depende de ningún framework ni de la base de datos.
 */
export class Guia {
  /** El constructor es privado: solo se crea con `iniciar` o `reconstruir`. */
  private constructor(
    /** Identificador de la guía (por ejemplo, su número de seguimiento). */
    public readonly id: string,
    /** Cliente dueño de la guía. Una guía pertenece a un solo tenant. */
    public readonly tenantId: string,
    /** Historial en orden cronológico. */
    private readonly historial: EventoGuia[],
  ) {}

  /**
   * Crea una guía nueva a partir de su primer evento.
   * @throws PrimerEventoInvalidoError si el evento no es CREADA.
   */
  static iniciar(id: string, tenantId: string, primerEvento: EventoGuia): Guia {
    if (primerEvento.estado !== "CREADA") {
      throw new PrimerEventoInvalidoError(primerEvento.estado);
    }
    return new Guia(id, tenantId, [primerEvento]);
  }

  /**
   * Reconstruye una guía ya existente con su historial guardado.
   * Lo usan los repositorios al leer de la base de datos. No vuelve a validar
   * el historial porque se asume que se validó al guardarlo.
   */
  static reconstruir(id: string, tenantId: string, eventos: readonly EventoGuia[]): Guia {
    if (eventos.length === 0) {
      // Es un error de programación o datos corruptos, no una regla de negocio.
      throw new Error(`La guía ${id} no puede reconstruirse sin eventos`);
    }
    return new Guia(id, tenantId, [...eventos]);
  }

  /** Último evento aceptado, que define el estado actual. */
  private get ultimoEvento(): EventoGuia {
    // El historial nunca está vacío (lo garantizan `iniciar` y `reconstruir`).
    return this.historial[this.historial.length - 1]!;
  }

  /** Estado actual de la guía. */
  get estadoActual(): EstadoGuia {
    return this.ultimoEvento.estado;
  }

  /** Copia del historial en orden cronológico (no se puede modificar desde afuera). */
  get eventos(): readonly EventoGuia[] {
    return [...this.historial];
  }

  /**
   * Intenta registrar un nuevo evento. Aplica las reglas en este orden:
   *  1. Si el `eventId` ya existe, es un duplicado: se ignora sin error.
   *  2. La fecha no puede ser anterior a la del último evento.
   *  3. La transición de estado debe estar permitida.
   *
   * @throws EventoFueraDeOrdenError si la fecha es anterior al último evento.
   * @throws TransicionInvalidaError si el cambio de estado no está permitido.
   */
  registrarEvento(evento: EventoGuia): ResultadoRegistro {
    // 1. Idempotencia: el mismo evento reenviado no cambia nada ni se notifica de nuevo.
    //    Se compara solo el eventId; el contenido del reenvío no se vuelve a evaluar.
    if (this.historial.some((existente) => existente.eventId === evento.eventId)) {
      return "DUPLICADO";
    }

    // 2. Orden cronológico: se permite igual fecha, se rechaza una anterior.
    const ultimo = this.ultimoEvento;
    if (evento.fechaEvento.getTime() < ultimo.fechaEvento.getTime()) {
      throw new EventoFueraDeOrdenError(
        evento.fechaEvento.toISOString(),
        ultimo.fechaEvento.toISOString(),
      );
    }

    // 3. Regla de estados (lanza TransicionInvalidaError si no se permite).
    validarTransicion(ultimo.estado, evento.estado);

    this.historial.push(evento);
    return "REGISTRADO";
  }
}
