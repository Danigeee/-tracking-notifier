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
