// Configuración de la aplicación, leída desde variables de entorno.
//
// Se valida al arrancar: si falta algo obligatorio o tiene un valor inválido,
// el servicio no inicia y dice qué variable falló (sin mostrar su valor, porque
// puede contener secretos como la contraseña de la base de datos).

import { z } from "zod";
import { NIVELES_LOG, NivelLog } from "../infrastructure/logging/registrador-pino";

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
  // Nivel mínimo de los logs. "silent" los apaga.
  LOG_LEVEL: z.enum(NIVELES_LOG).default("info"),
  // Segundos de espera entre los intentos de entrega de un aviso, separados por comas. Con N
  // esperas hay N + 1 intentos en total; como máximo 4 esperas (5 intentos, el tope de la prueba).
  // Por defecto: 10 s, 1 min, 5 min y 30 min. Con valores cortos (por ejemplo "1,1,1,1") se puede
  // ver un aviso fallido en segundos, útil para una demostración.
  REINTENTO_ESPERAS_SEGUNDOS: z
    .string()
    .default("10,60,300,1800")
    // Se separa por comas; el resultado aún no está validado, de eso se encarga el esquema siguiente.
    .transform((texto): unknown => texto.split(",").map((valor) => valor.trim()))
    .pipe(z.array(z.coerce.number().int().min(1).max(86_400)).min(1).max(4)),
});

/** Configuración ya validada y con nombres propios de la aplicación. */
export interface Config {
  readonly puerto: number;
  readonly databaseUrl: string;
  readonly workerIntervaloMs: number;
  readonly workerTamanoLote: number;
  readonly webhookTimeoutMs: number;
  readonly nivelLog: NivelLog;
  /** Segundos de espera entre intentos de entrega; la cantidad de intentos es esta lista + 1. */
  readonly reintentoEsperasSegundos: readonly number[];
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
    const variables = [...new Set(resultado.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Configuración inválida. Revisa las variables: ${variables.join(", ")}`);
  }

  return {
    puerto: resultado.data.PORT,
    databaseUrl: resultado.data.DATABASE_URL,
    workerIntervaloMs: resultado.data.WORKER_INTERVAL_MS,
    workerTamanoLote: resultado.data.WORKER_BATCH_SIZE,
    webhookTimeoutMs: resultado.data.WEBHOOK_TIMEOUT_MS,
    nivelLog: resultado.data.LOG_LEVEL,
    reintentoEsperasSegundos: resultado.data.REINTENTO_ESPERAS_SEGUNDOS,
  };
}
