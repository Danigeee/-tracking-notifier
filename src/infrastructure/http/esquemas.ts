// Validación de la entrada HTTP con Zod.
//
// El dominio no valida formatos (UUID, fechas, longitudes): eso se hace aquí,
// en el borde, antes de llamar a los casos de uso.

import { z } from "zod";
import { ESTADOS_GUIA } from "../../domain/estado-guia";
import { DetalleError, ErrorValidacion } from "./errores-http";

// Mensajes de validación por defecto de Zod en español.
z.config(z.locales.es());

/** Identificador de guía (en la URL): 1 a 64 caracteres seguros. */
export const esquemaGuiaId = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, "Debe tener 1 a 64 caracteres: letras, números, punto, guion o guion bajo");

/** Identificador del tenant (cabecera X-Tenant-Id): 1 a 64 caracteres seguros. */
export const esquemaTenantId = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,64}$/, "Debe tener 1 a 64 caracteres: letras, números, punto, guion o guion bajo");

/** Cuerpo de POST /guias/:guiaId/eventos. */
export const esquemaEvento = z.object({
  eventId: z.uuid("Debe ser un UUID"),
  estado: z.enum(ESTADOS_GUIA, `Debe ser uno de: ${ESTADOS_GUIA.join(", ")}`),
  // ISO 8601 con zona horaria ("Z" o desplazamiento como +05:00).
  fechaEvento: z.iso.datetime({ offset: true, error: "Debe ser una fecha ISO 8601 con zona horaria" }),
  observacion: z.string().max(500, "Debe tener como máximo 500 caracteres").optional(),
});

/**
 * Cuerpo de PUT /webhook.
 * Se aceptan URLs http y https (decisión para esta prueba; en producción solo https).
 */
export const esquemaWebhook = z.object({
  url: z
    .url({ protocol: /^https?$/, error: "Debe ser una URL válida que empiece por http:// o https://" })
    .max(2048, "Debe tener como máximo 2048 caracteres"),
});

/**
 * Valida un valor con un esquema. Si falla, lanza ErrorValidacion con el detalle
 * de cada campo inválido.
 * @param origen texto que se antepone al nombre del campo (por ejemplo "cabecera")
 */
export function validar<T>(esquema: z.ZodType<T>, valor: unknown, origen?: string): T {
  const resultado = esquema.safeParse(valor);
  if (resultado.success) {
    return resultado.data;
  }
  const detalles: DetalleError[] = resultado.error.issues.map((problema) => ({
    campo: [origen, problema.path.join(".")].filter(Boolean).join(" "),
    mensaje: problema.message,
  }));
  throw new ErrorValidacion(detalles);
}
