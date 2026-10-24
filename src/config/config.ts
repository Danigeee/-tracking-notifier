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
});

/** Configuración ya validada y con nombres propios de la aplicación. */
export interface Config {
  readonly puerto: number;
  readonly databaseUrl: string;
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
  };
}
