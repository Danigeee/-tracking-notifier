// Preparación y limpieza global de las pruebas de integración.
//
// Antes de la primera prueba:
//   1. Se conecta al PostgreSQL de desarrollo (el del `docker compose`).
//   2. Crea una base de datos NUEVA y vacía, solo para esta ejecución.
//   3. Le aplica las migraciones reales del proyecto (`prisma migrate deploy`).
// Al terminar, borra esa base. Los datos de desarrollo nunca se tocan.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";

/** Dato que este archivo comparte con las pruebas: la URL de la base temporal. */
declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Conexión de administración, usada solo para crear y borrar la base temporal.
 * Por defecto apunta al Postgres del docker compose; se puede cambiar con la variable
 * TEST_DATABASE_ADMIN_URL (por ejemplo, en el CI).
 */
const URL_ADMIN =
  process.env["TEST_DATABASE_ADMIN_URL"] ?? "postgresql://postgres:postgres@localhost:5433/postgres";

/** Prefijo de las bases temporales. Solo se borran las que tienen exactamente este formato. */
const PREFIJO = "tracking_notifier_test_";
const FORMATO_NOMBRE = /^tracking_notifier_test_(\d+)_[0-9a-f]{8}$/;

/** URL de una base concreta, usando las credenciales y el servidor de la conexión de administración. */
function urlDeBase(nombre: string): string {
  const url = new URL(URL_ADMIN);
  url.pathname = `/${nombre}`;
  return url.toString();
}

export default async function preparar(proyecto: TestProject): Promise<() => Promise<void>> {
  const admin = new PrismaClient({ datasourceUrl: URL_ADMIN });

  // 1. Comprobar que PostgreSQL responde, con un mensaje claro si no.
  try {
    await admin.$queryRaw`SELECT 1`;
  } catch {
    await admin.$disconnect();
    throw new Error(
      "No se pudo conectar a PostgreSQL para las pruebas de integración.\n" +
        "Enciende la base con: docker compose up -d db\n" +
        "(o define TEST_DATABASE_ADMIN_URL con otra conexión de administración)",
    );
  }

  // 2. Limpiar bases temporales que hayan quedado de ejecuciones interrumpidas hace más de 1 hora.
  const existentes = await admin.$queryRaw<{ datname: string }[]>`
    SELECT datname FROM pg_database WHERE datname LIKE ${PREFIJO + "%"}`;
  const haceUnaHora = Date.now() - 3_600_000;
  for (const { datname } of existentes) {
    const coincide = FORMATO_NOMBRE.exec(datname);
    if (coincide && Number(coincide[1]) < haceUnaHora) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  }

  // 3. Crear la base temporal. El nombre lo generamos nosotros (solo letras, números y guion
  //    bajo), por eso es seguro ponerlo directamente en la sentencia.
  const nombre = `${PREFIJO}${Date.now()}_${randomBytes(4).toString("hex")}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE "${nombre}"`);
  const url = urlDeBase(nombre);

  // 4. Aplicar las migraciones reales, con el mismo comando que se usaría en producción.
  try {
    execFileSync(
      process.execPath,
      [join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
    );
  } catch (error) {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.$disconnect();
    throw new Error(`No se pudieron aplicar las migraciones a la base temporal: ${String(error)}`);
  }

  // Las pruebas reciben la URL con `inject("databaseUrl")`.
  proyecto.provide("databaseUrl", url);

  // Limpieza al terminar todas las pruebas.
  return async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await admin.$disconnect();
  };
}
