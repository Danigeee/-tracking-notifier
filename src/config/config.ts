// Configuración de la aplicación, leída desde variables de entorno.
//
// Se valida al arrancar: si falta algo obligatorio o tiene un valor inválido,
// el servicio no inicia y dice qué variable falló (sin mostrar su valor, porque
// puede contener secretos como la contraseña de la base de datos).

import { z } from "zod";

/** Variables de entorno esperadas y sus reglas. */
const esquemaEntorno = z.object({
  // Puerto HTTP en el que escucha el servicio.
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Cadena de conexión a PostgreSQL. No tiene valor por defecto: es obligatoria.
  DATABASE_URL: z.string().min(1),
  // Cada cuántos milisegundos el worker busca notificaciones pendientes.
  WORKER_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  // Cuántas notificaciones procesa el worker por pasada.
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(10),
  // Tiempo máximo de espera de la respuesta del webhook del cliente (la prueba pide 5 segundos).
  WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
});

/** Configuración ya validada y con nombres propios de la aplicación. */
export interface Config {
  readonly puerto: number;
  readonly databaseUrl: string;
  readonly workerIntervaloMs: number;
  readonly workerTamanoLote: number;
  readonly webhookTimeoutMs: number;
}

/**
 * Lee y valida la configuración.
 * @param entorno variables de entorno; por defecto las del proceso (se parametriza para poder probarla)
 * @throws Error indicando qué variables son inválidas, sin revelar sus valores
 */
export function cargarConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquemaEntorno.safeParse(entorno);

  if (!resultado.success) {
    // Solo se listan los nombres de las variables con problema, nunca sus valores.
    const variables = [...new Set(resultado.error.issues.map((i) => i.path.join(".")))];
    throw new Error(`Configuración inválida. Revisa las variables: ${variables.join(", ")}`);
  }

  return {
    puerto: resultado.data.PORT,
    databaseUrl: resultado.data.DATABASE_URL,
    workerIntervaloMs: resultado.data.WORKER_INTERVAL_MS,
    workerTamanoLote: resultado.data.WORKER_BATCH_SIZE,
    webhookTimeoutMs: resultado.data.WEBHOOK_TIMEOUT_MS,
  };
}
