// Notificación: aviso al cliente de que un evento fue aceptado.
//
// Cada evento aceptado genera exactamente una notificación, que el sistema
// envía al webhook del cliente de forma asíncrona (con reintentos).

import { EventoGuia } from "./evento-guia";

/** Lista de estados posibles de una notificación. */
export const ESTADOS_NOTIFICACION = ["PENDIENTE", "ENVIADA", "FALLIDA"] as const;

/**
 *  - PENDIENTE: todavía no se envió, o se está reintentando.
 *  - ENVIADA: el cliente respondió con éxito.
 *  - FALLIDA: se agotaron los intentos y no se pudo entregar.
 */
export type EstadoNotificacion = (typeof ESTADOS_NOTIFICACION)[number];

/** Todos los datos de una notificación. */
export interface DatosNotificacion {
  readonly tenantId: string;
  readonly guiaId: string;
  /** Evento que se notifica; es lo que recibirá el cliente. */
  readonly evento: EventoGuia;
  readonly estado: EstadoNotificacion;
  /** Intentos de envío realizados hasta ahora. */
  readonly intentos: number;
  /** Momento a partir del cual toca el siguiente intento. */
  readonly proximoIntento: Date;
  /** Motivo del último fallo, si lo hubo (texto corto, nunca el cuerpo de la respuesta del cliente). */
  readonly ultimoError: string | null;
  /** Código HTTP de la última respuesta del cliente, si respondió. */
  readonly ultimoCodigoHttp: number | null;
  readonly creadaEn: Date;
}

export class Notificacion {
  private constructor(private readonly datos: DatosNotificacion) {}

  /**
   * Crea la notificación de un evento recién aceptado: queda pendiente, sin
   * intentos y lista para enviarse de inmediato.
   * @param ahora momento actual (lo entrega el reloj, el dominio no lo lee solo)
   */
  static crear(tenantId: string, guiaId: string, evento: EventoGuia, ahora: Date): Notificacion {
    return new Notificacion({
      tenantId,
      guiaId,
      evento,
      estado: "PENDIENTE",
      intentos: 0,
      proximoIntento: ahora,
      ultimoError: null,
      ultimoCodigoHttp: null,
      creadaEn: ahora,
    });
  }

  /** Reconstruye una notificación guardada. Lo usan los repositorios al leer de la base de datos. */
  static reconstruir(datos: DatosNotificacion): Notificacion {
    return new Notificacion(datos);
  }

  get tenantId(): string {
    return this.datos.tenantId;
  }
  get guiaId(): string {
    return this.datos.guiaId;
  }
  get evento(): EventoGuia {
    return this.datos.evento;
  }
  /** Identificador del evento notificado. */
  get eventId(): string {
    return this.datos.evento.eventId;
  }
  get estado(): EstadoNotificacion {
    return this.datos.estado;
  }
  get intentos(): number {
    return this.datos.intentos;
  }
  get proximoIntento(): Date {
    return this.datos.proximoIntento;
  }
  get ultimoError(): string | null {
    return this.datos.ultimoError;
  }
  get ultimoCodigoHttp(): number | null {
    return this.datos.ultimoCodigoHttp;
  }
  get creadaEn(): Date {
    return this.datos.creadaEn;
  }
}
