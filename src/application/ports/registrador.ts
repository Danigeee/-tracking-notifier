// Puerto de salida: registro de eventos del sistema (logs).
//
// Reglas de uso, para que los logs no filtren datos personales ni secretos:
//  - El mensaje es SIEMPRE un texto fijo; lo variable va en `datos`, nunca dentro del mensaje.
//  - `datos` solo admite valores simples (texto, número, booleano): no se pueden pasar
//    objetos completos, como un cuerpo de petición o un evento, por descuido.
//  - Se pueden registrar identificadores de negocio (tenantId, guiaId, eventId).
//  - NO se registran: observaciones de eventos, secretos, firmas, cuerpos de peticiones
//    ni URLs de webhook completas.

/** Valores permitidos en los datos de un log. */
export type ValorLog = string | number | boolean | null | undefined;

/** Datos adicionales de un log: pares nombre-valor simples. */
export type DatosLog = Readonly<Record<string, ValorLog>>;

export interface Registrador {
  /** Detalle útil solo para depurar. */
  debug(mensaje: string, datos?: DatosLog): void;
  /** Hecho normal del funcionamiento. */
  info(mensaje: string, datos?: DatosLog): void;
  /** Algo anormal que el sistema maneja solo (un fallo que se reintentará, una petición rechazada). */
  warn(mensaje: string, datos?: DatosLog): void;
  /** Algo que falló y requiere atención. `error` es la causa, si la hay. */
  error(mensaje: string, datos?: DatosLog, error?: unknown): void;
}
