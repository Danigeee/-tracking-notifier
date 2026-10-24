// Middleware que registra cada petición HTTP y le asigna un identificador de seguimiento.

import { randomUUID } from "node:crypto";
import { NextFunction, Request, RequestHandler, Response } from "express";
import { Registrador } from "../../application/ports/registrador";

/** Nombre de la cabecera con el identificador de seguimiento de la petición. */
export const CABECERA_REQUEST_ID = "X-Request-Id";

/**
 * Un identificador enviado por quien llama solo se acepta si tiene un formato seguro
 * (letras, números, punto, guion y guion bajo, de 8 a 64 caracteres). Así no se puede
 * colar texto arbitrario en los logs a través de esta cabecera.
 */
const FORMATO_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Por cada petición:
 *  - Asigna un `requestId` (el que venga en X-Request-Id si es válido, o uno nuevo),
 *    lo devuelve en la respuesta y lo deja en `res.locals.requestId`.
 *  - Al terminar la respuesta, escribe UNA línea de log con el método, la ruta, el código
 *    de respuesta y la duración.
 *
 * Qué NO registra: el cuerpo, la query ni las cabeceras. La ruta se registra como el patrón
 * ("/guias/:guiaId/eventos") y no como la dirección real; el tenant y la guía van aparte,
 * en sus propios campos, solo cuando ya pasaron la validación.
 */
export function registroPeticiones(registrador: Registrador): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const inicio = process.hrtime.bigint();

    const entrante = req.header(CABECERA_REQUEST_ID);
    const requestId = entrante && FORMATO_REQUEST_ID.test(entrante) ? entrante : randomUUID();
    res.locals["requestId"] = requestId;
    res.setHeader(CABECERA_REQUEST_ID, requestId);

    // "finish" se emite cuando la respuesta ya se envió completa.
    res.on("finish", () => {
      const duracionMs = Number(process.hrtime.bigint() - inicio) / 1_000_000;
      // Si ninguna ruta atendió la petición, no se registra la dirección pedida (puede ser basura).
      const ruta = req.route?.path ?? "(sin ruta)";
      const datos = {
        requestId,
        metodo: req.method,
        ruta,
        status: res.statusCode,
        duracionMs: Math.round(duracionMs * 10) / 10,
        tenantId: res.locals["tenantId"] as string | undefined,
        guiaId: res.locals["guiaId"] as string | undefined,
        errorCodigo: res.locals["errorCodigo"] as string | undefined,
      };

      // El nivel depende del resultado. El health check se consulta con mucha frecuencia
      // (por ejemplo, por Docker), así que cuando va bien solo se muestra al depurar.
      if (res.statusCode >= 500) {
        registrador.error("petición con error del servidor", datos);
      } else if (res.statusCode >= 400) {
        registrador.warn("petición rechazada", datos);
      } else if (ruta === "/health") {
        registrador.debug("petición atendida", datos);
      } else {
        registrador.info("petición atendida", datos);
      }
    });

    next();
  };
}
