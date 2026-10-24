// Errores del dominio.
//
// Representan reglas de negocio violadas. No conocen HTTP ni ningún framework:
// la capa de infraestructura (API) decidirá más adelante qué código HTTP
// corresponde a cada uno usando el campo `codigo`.

/**
 * Clase base de todos los errores del dominio.
 * El `codigo` es un identificador estable y legible por máquina, pensado para
 * que otras capas traduzcan el error sin depender del texto del mensaje.
 */
export abstract class ErrorDominio extends Error {
  protected constructor(
    /** Identificador estable del tipo de error (por ejemplo "TRANSICION_INVALIDA"). */
    public readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    // El nombre de la clase concreta aparece en trazas y logs.
    this.name = new.target.name;
  }
}

/**
 * Se lanza cuando el primer evento de una guía no es CREADA.
 * Las guías solo pueden nacer en ese estado.
 */
export class PrimerEventoInvalidoError extends ErrorDominio {
  constructor(
    /** Estado con el que se intentó iniciar la guía. */
    public readonly estadoRecibido: string,
  ) {
    super(
      "PRIMER_EVENTO_INVALIDO",
      `El primer evento de una guía debe ser CREADA y se recibió ${estadoRecibido}`,
    );
  }
}

/**
 * Se lanza cuando llega un evento con una fecha anterior a la del último
 * evento ya aceptado de la guía (llegó desordenado).
 */
export class EventoFueraDeOrdenError extends ErrorDominio {
  constructor(
    /** Fecha del evento rechazado, en formato ISO 8601. */
    public readonly fechaEvento: string,
    /** Fecha del último evento aceptado, en formato ISO 8601. */
    public readonly fechaUltimoEvento: string,
  ) {
    super(
      "EVENTO_FUERA_DE_ORDEN",
      `El evento con fecha ${fechaEvento} es anterior al último evento aceptado (${fechaUltimoEvento})`,
    );
  }
}

/**
 * Se lanza cuando se intenta pasar una guía de un estado a otro que las reglas
 * no permiten (por ejemplo, cambiar una guía que ya fue ENTREGADA).
 */
export class TransicionInvalidaError extends ErrorDominio {
  constructor(
    /** Estado en el que está la guía actualmente. */
    public readonly estadoActual: string,
    /** Estado al que se intentó pasar. */
    public readonly estadoNuevo: string,
  ) {
    super(
      "TRANSICION_INVALIDA",
      `No se permite pasar de ${estadoActual} a ${estadoNuevo}`,
    );
  }
}
