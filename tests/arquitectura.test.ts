// Prueba de arquitectura: hace cumplir la regla de dependencias de la
// arquitectura hexagonal. Si alguien importa algo que no debe, esta prueba falla.
//
//   infraestructura ──► aplicación ──► dominio
//
//  - El dominio no importa nada fuera del dominio (ni librerías, ni otras capas).
//  - La aplicación solo importa dominio y aplicación (ni librerías, ni infraestructura).

import { readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { describe, expect, it } from "vitest";

const RAIZ_SRC = resolve(__dirname, "../src");

/** Devuelve las rutas de todos los archivos .ts de una carpeta de `src`, incluidas las subcarpetas. */
function archivosTs(carpeta: string): string[] {
  const base = join(RAIZ_SRC, carpeta);
  return readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((ruta) => ruta.endsWith(".ts"))
    .map((ruta) => join(base, ruta));
}

/** Extrae los destinos de los `import ... from "x"` de un archivo. */
function importaciones(archivo: string): string[] {
  const codigo = readFileSync(archivo, "utf8");
  return [...codigo.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

/**
 * Comprueba que todos los imports de una capa sean relativos y apunten solo a
 * las carpetas permitidas. Un import que no empieza por "." es una librería externa.
 */
function violaciones(carpeta: string, permitidas: string[]): string[] {
  const errores: string[] = [];
  for (const archivo of archivosTs(carpeta)) {
    for (const destino of importaciones(archivo)) {
      if (!destino.startsWith(".")) {
        errores.push(`${archivo} importa la librería externa "${destino}"`);
        continue;
      }
      const resuelto = resolve(dirname(archivo), destino);
      const permitido = permitidas.some((p) => resuelto.startsWith(join(RAIZ_SRC, p)));
      if (!permitido) {
        errores.push(`${archivo} importa "${destino}", fuera de las capas permitidas`);
      }
    }
  }
  return errores;
}

describe("regla de dependencias", () => {
  it("el dominio no depende de nada fuera del dominio", () => {
    expect(violaciones("domain", ["domain"])).toEqual([]);
  });

  it("la aplicación solo depende del dominio y de sí misma", () => {
    expect(violaciones("application", ["domain", "application"])).toEqual([]);
  });
});
