// Puerto de salida: cliente que entrega la notificación al webhook del cliente.
//
// La aplicación no sabe qué es HTTP: solo pide "entregar este mensaje a esta
// dirección, firmado con este secreto" y recibe si funcionó o no. La implementación
// real (fetch, timeout, firma) vive en la capa de infraestructura.

import { EstadoGuia } from "../../domain/estado-guia";

/** Mensaje que recibe el sistema del cliente. */
export interface PayloadWebhook {
  readonly eventId: string;
  readonly guiaId: string;
  readonly estado: EstadoGuia;
  /** Fecha del evento en formato ISO 8601. */
  readonly fechaEvento: string;
  readonly observacion?: string;
}

/** Resultado de un intento de entrega. */
export type ResultadoEnvio =
  | { readonly exito: true; readonly codigoHttp: number }
  | {
      readonly exito: false;
      /** Texto corto de lo que falló. No incluye datos de la respuesta del cliente. */
      readonly motivo: string;
      /** Código HTTP si el cliente llegó a responder; null si no hubo respuesta. */
      readonly codigoHttp: number | null;
    };

export interface ClienteWebhook {
  /**
   * Entrega el mensaje a la URL indicada, firmado con el secreto del cliente.
   * No lanza errores: cualquier fallo (sin conexión, tiempo agotado, respuesta
   * de error) se devuelve como `exito: false`.
   */
  enviar(url: string, payload: PayloadWebhook, secreto: string): Promise<ResultadoEnvio>;
}
