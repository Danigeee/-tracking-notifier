// Pruebas de la carga y validación de la configuración.

import { describe, expect, it } from "vitest";
import { cargarConfig } from "../../src/config/config";

// Valor ficticio de conexión.
const DATABASE_URL = "postgresql://usuario:clave-secreta@localhost:5433/base";

describe("cargarConfig", () => {
  it("lee el puerto y la cadena de conexión", () => {
    const config = cargarConfig({ PORT: "4000", DATABASE_URL });

    expect(config).toEqual({ puerto: 4000, databaseUrl: DATABASE_URL });
  });

  it("usa el puerto 3000 si no se define PORT", () => {
    expect(cargarConfig({ DATABASE_URL }).puerto).toBe(3000);
  });

  it("falla si falta DATABASE_URL e indica la variable", () => {
    expect(() => cargarConfig({ PORT: "3000" })).toThrow(/DATABASE_URL/);
  });

  it("falla si el puerto no es válido", () => {
    expect(() => cargarConfig({ PORT: "abc", DATABASE_URL })).toThrow(/PORT/);
    expect(() => cargarConfig({ PORT: "70000", DATABASE_URL })).toThrow(/PORT/);
  });

  it("no revela en el error el valor de las variables", () => {
    try {
      cargarConfig({ PORT: "abc", DATABASE_URL });
    } catch (error) {
      expect((error as Error).message).not.toContain("clave-secreta");
    }
  });
});
