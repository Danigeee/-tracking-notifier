// Adaptador de salida: implementa el puerto Registrador con pino.
//
// Escribe una línea de JSON por cada log, por ejemplo:
//   {"level":"info","time":"2026-10-24T12:00:00.000Z","servicio":"tracking-notifier",
//    "msg":"evento registrado","tenantId":"cliente-demo","guiaId":"GUIA-1"}
// Ese formato lo entienden directamente las herramientas de logs (Datadog, Loki, CloudWatch).

import pino, { DestinationStream, Logger } from "pino";
import { DatosLog, Registrador } from "../../application/ports/registrador";
import { limpiarTexto } from "./limpieza";

/** Niveles admitidos. "silent" apaga los logs (se usa en las pruebas). */
export const NIVELES_LOG = ["debug", "info", "warn", "error", "silent"] as const;
export type NivelLog = (typeof NIVELES_LOG)[number];

/**
 * Nombres de campo que NUNCA deben salir en un log. Es una segunda barrera: aunque
 * alguien pase uno de estos campos por error, pino lo reemplaza por "[oculto]".
 */
const CAMPOS_OCULTOS = [
  "secreto",
  "webhookSecreto",
  "firma",
  "signature",
  "url",
  "webhookUrl",
  "observacion",
  "cuerpo",
  "body",
  "authorization",
  "password",
  "contrasena",
];

export class RegistradorPino implements Registrador {
  private readonly logger: Logger;

  /**
   * @param nivel nivel mínimo que se escribe
   * @param destino dónde escribir; por defecto la salida estándar (se parametriza para probar)
   */
  constructor(nivel: NivelLog, destino?: DestinationStream) {
    this.logger = pino(
      {
        level: nivel,
        // Datos que acompañan a todas las líneas.
        base: { servicio: "tracking-notifier" },
        // Hora en formato ISO 8601, legible y ordenable.
        timestamp: pino.stdTimeFunctions.isoTime,
        // El nivel como texto ("info") en lugar de número (30).
        formatters: { level: (etiqueta) => ({ level: etiqueta }) },
        redact: { paths: CAMPOS_OCULTOS, censor: "[oculto]" },
      },
      destino,
    );
  }

  debug(mensaje: string, datos?: DatosLog): void {
    this.logger.debug(datos ?? {}, mensaje);
  }

  info(mensaje: string, datos?: DatosLog): void {
    this.logger.info(datos ?? {}, mensaje);
  }

  warn(mensaje: string, datos?: DatosLog): void {
    this.logger.warn(datos ?? {}, mensaje);
  }

  error(mensaje: string, datos?: DatosLog, error?: unknown): void {
    this.logger.error({ ...datos, ...(error !== undefined && { error: describirError(error) }) }, mensaje);
  }
}

/**
 * Convierte un error en datos para el log: tipo, mensaje y traza, con los secretos y
 * las URLs ocultos. Un valor que no sea un Error (por ejemplo, un texto lanzado con
 * `throw`) se describe de forma genérica.
 */
function describirError(error: unknown): Record<string, string | undefined> {
  if (!(error instanceof Error)) {
    return { tipo: typeof error };
  }
  // Los errores de Prisma traen un código estable (por ejemplo "P2002") muy útil y sin riesgo.
  const codigo = (error as { code?: unknown }).code;
  return {
    tipo: error.name,
    ...(typeof codigo === "string" && { codigo }),
    mensaje: limpiarTexto(error.message),
    traza: error.stack ? limpiarTexto(error.stack) : undefined,
  };
}
