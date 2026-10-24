// Adaptador de salida: implementa el puerto ClienteWebhook con HTTP (fetch de Node).

import {
  ClienteWebhook,
  PayloadWebhook,
  ResultadoEnvio,
} from "../../application/ports/cliente-webhook";
import { Reloj } from "../../application/ports/reloj";
import { calcularFirma } from "./firma";

export class ClienteWebhookHttp implements ClienteWebhook {
  /**
   * @param timeoutMs tiempo máximo de espera de la respuesta del cliente, en milisegundos
   * @param reloj fuente de la hora que se incluye en la firma
   */
  constructor(
    private readonly timeoutMs: number,
    private readonly reloj: Reloj,
  ) {}

  async enviar(url: string, payload: PayloadWebhook, secreto: string): Promise<ResultadoEnvio> {
    // Se firma el texto exacto que se envía: el cliente debe recalcular la firma
    // sobre los mismos bytes, así que el cuerpo se serializa una sola vez.
    const cuerpo = JSON.stringify(payload);
    // La hora se toma en cada intento: un reintento lleva una firma nueva y vigente.
    const timestamp = Math.floor(this.reloj.ahora().getTime() / 1000);

    try {
      const respuesta = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Mismo valor en todos los reintentos: permite al cliente descartar repetidos,
          // porque la entrega es "al menos una vez".
          "X-Event-Id": payload.eventId,
          // Hora del envío y firma de "<hora>.<cuerpo>". Ver firma.ts.
          "X-Timestamp": String(timestamp),
          "X-Signature": calcularFirma(secreto, timestamp, cuerpo),
        },
        body: cuerpo,
        // Corta la espera pasado el tiempo máximo.
        signal: AbortSignal.timeout(this.timeoutMs),
        // No se siguen redirecciones: una respuesta 3xx cuenta como fallo.
        redirect: "manual",
      });

      // Se descarta el cuerpo de la respuesta para liberar la conexión. No se lee ni se
      // guarda: podría contener datos del cliente.
      await respuesta.body?.cancel();

      if (respuesta.status >= 200 && respuesta.status < 300) {
        return { exito: true, codigoHttp: respuesta.status };
      }
      return {
        exito: false,
        motivo: `el webhook respondió ${respuesta.status}`,
        codigoHttp: respuesta.status,
      };
    } catch (error) {
      return { exito: false, motivo: motivoDelError(error), codigoHttp: null };
    }
  }
}

/** Texto corto y sin datos sensibles para un error de red. */
function motivoDelError(error: unknown): string {
  const nombre = error instanceof Error ? error.name : "";
  if (nombre === "TimeoutError" || nombre === "AbortError") {
    return "tiempo de espera agotado";
  }
  return "no se pudo conectar con el webhook";
}
