// Traducción de errores a respuestas HTTP con un formato único.
//
// Aquí (y solo aquí) se decide qué código HTTP corresponde a cada error del
// dominio o de la aplicación. Esas capas no conocen HTTP.

import { GuiaNoEncontradaError } from "../../application/errores";
import {
  EventoFueraDeOrdenError,
  PrimerEventoInvalidoError,
  TransicionInvalidaError,
} from "../../domain/errores";

/** Detalle de un campo inválido en una validación. */
export interface DetalleError {
  /** Campo afectado, por ejemplo "estado" o "cabecera X-Tenant-Id". */
  readonly campo: string;
  readonly mensaje: string;
}

/** Cuerpo de TODAS las respuestas de error de la API. */
export interface CuerpoError {
  readonly error: {
    /** Identificador estable y legible por máquina. */
    readonly codigo: string;
    /** Descripción legible para una persona. */
    readonly mensaje: string;
    /** Solo en errores de validación: qué campos fallaron. */
    readonly detalles?: readonly DetalleError[];
  };
}

/** Respuesta lista para enviar: código HTTP y cuerpo. */
export interface RespuestaError {
  readonly status: number;
  readonly cuerpo: CuerpoError;
}

/** Error de validación de la entrada (cuerpo, parámetros o cabeceras). Responde 400. */
export class ErrorValidacion extends Error {
  constructor(public readonly detalles: readonly DetalleError[]) {
    super("La petición no es válida");
    this.name = "ErrorValidacion";
  }
}

/** Construye una respuesta de error. */
function respuesta(
  status: number,
  codigo: string,
  mensaje: string,
  detalles?: readonly DetalleError[],
): RespuestaError {
  return { status, cuerpo: { error: { codigo, mensaje, ...(detalles && { detalles }) } } };
}

/** Respuesta para rutas que no existen. */
export function respuestaNoEncontrada(): RespuestaError {
  return respuesta(404, "RUTA_NO_ENCONTRADA", "La ruta solicitada no existe");
}

/**
 * Convierte cualquier error en una respuesta HTTP.
 * Los errores desconocidos devuelven un mensaje genérico para no filtrar detalles internos.
 */
export function traducirError(error: unknown): RespuestaError {
  if (error instanceof ErrorValidacion) {
    return respuesta(400, "PETICION_INVALIDA", error.message, error.detalles);
  }
  if (error instanceof GuiaNoEncontradaError) {
    return respuesta(404, error.codigo, error.message);
  }
  // Conflictos con el estado actual de la guía.
  if (error instanceof TransicionInvalidaError || error instanceof EventoFueraDeOrdenError) {
    return respuesta(409, error.codigo, error.message);
  }
  // El contenido es válido en formato pero no se puede procesar (guía que no empieza en CREADA).
  if (error instanceof PrimerEventoInvalidoError) {
    return respuesta(422, error.codigo, error.message);
  }
  // Errores del lector de JSON de Express.
  const tipo = (error as { type?: string } | null)?.type;
  if (tipo === "entity.parse.failed") {
    return respuesta(400, "JSON_INVALIDO", "El cuerpo no es un JSON válido");
  }
  if (tipo === "entity.too.large") {
    return respuesta(413, "CUERPO_DEMASIADO_GRANDE", "El cuerpo de la petición es demasiado grande");
  }
  return respuesta(500, "ERROR_INTERNO", "Ocurrió un error interno");
}
