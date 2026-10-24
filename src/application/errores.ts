// Errores de la capa de aplicación.
//
// Son distintos de los errores del dominio: representan situaciones de los
// casos de uso (por ejemplo, un recurso que no existe) y no reglas de negocio.
// Tampoco conocen HTTP; la capa de API los traducirá usando `codigo`.

/**
 * Clase base de los errores de aplicación.
 * El `codigo` es un identificador estable y legible por máquina.
 */
export abstract class ErrorAplicacion extends Error {
  protected constructor(
    /** Identificador estable del tipo de error (por ejemplo "GUIA_NO_ENCONTRADA"). */
    public readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    // El nombre de la clase concreta aparece en trazas y logs.
    this.name = new.target.name;
  }
}

/**
 * Se lanza cuando se consulta el webhook de un tenant que todavía no lo configuró.
 */
export class WebhookNoConfiguradoError extends ErrorAplicacion {
  constructor() {
    super("WEBHOOK_NO_CONFIGURADO", "El cliente todavía no configuró su webhook");
  }
}

/**
 * Se lanza cuando la guía pedida no existe para el tenant que consulta.
 * Si la guía existe pero es de otro tenant, el resultado es el mismo: así no
 * se revela que existe en otro cliente.
 */
export class GuiaNoEncontradaError extends ErrorAplicacion {
  constructor(
    /** Identificador de la guía que se buscó. */
    public readonly guiaId: string,
  ) {
    super("GUIA_NO_ENCONTRADA", `No existe la guía ${guiaId}`);
  }
}
