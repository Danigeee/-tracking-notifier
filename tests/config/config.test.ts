// Pruebas de la carga y validación de la configuración.

import { describe, expect, it } from "vitest";
import { cargarConfig } from "../../src/config/config";

// Valor ficticio de conexión.
const DATABASE_URL = "postgresql://usuario:clave-secreta@localhost:5433/base";

describe("cargarConfig", () => {
  it("lee el puerto y la cadena de conexión", () => {
    const config = cargarConfig({ PORT: "4000", DATABASE_URL });

    expect(config).toMatchObject({ puerto: 4000, databaseUrl: DATABASE_URL });
  });

  it("usa el puerto 3000 si no se define PORT", () => {
    expect(cargarConfig({ DATABASE_URL }).puerto).toBe(3000);
  });

  it("usa valores por defecto para el worker y el timeout del webhook", () => {
    const config = cargarConfig({ DATABASE_URL });

    expect(config.workerIntervaloMs).toBe(2000);
    expect(config.workerTamanoLote).toBe(10);
    expect(config.webhookTimeoutMs).toBe(5000);
  });

  it("lee el worker y el timeout desde el entorno", () => {
    const config = cargarConfig({
      DATABASE_URL,
      WORKER_INTERVAL_MS: "500",
      WORKER_BATCH_SIZE: "25",
      WEBHOOK_TIMEOUT_MS: "3000",
    });

    expect(config.workerIntervaloMs).toBe(500);
    expect(config.workerTamanoLote).toBe(25);
    expect(config.webhookTimeoutMs).toBe(3000);
  });

  it("falla si los valores del worker no son válidos", () => {
    expect(() => cargarConfig({ DATABASE_URL, WORKER_BATCH_SIZE: "0" })).toThrow(/WORKER_BATCH_SIZE/);
    expect(() => cargarConfig({ DATABASE_URL, WORKER_INTERVAL_MS: "10" })).toThrow(/WORKER_INTERVAL_MS/);
    expect(() => cargarConfig({ DATABASE_URL, WEBHOOK_TIMEOUT_MS: "abc" })).toThrow(/WEBHOOK_TIMEOUT_MS/);
  });

  describe("esperas entre reintentos", () => {
    it("por defecto son 10 s, 1 min, 5 min y 30 min", () => {
      expect(cargarConfig({ DATABASE_URL }).reintentoEsperasSegundos).toEqual([10, 60, 300, 1800]);
    });

    it("se pueden configurar con una lista separada por comas", () => {
      const config = cargarConfig({ DATABASE_URL, REINTENTO_ESPERAS_SEGUNDOS: "1,2,3,4" });

      expect(config.reintentoEsperasSegundos).toEqual([1, 2, 3, 4]);
    });

    it("tolera espacios alrededor de los valores", () => {
      const config = cargarConfig({ DATABASE_URL, REINTENTO_ESPERAS_SEGUNDOS: " 1 , 2 " });

      expect(config.reintentoEsperasSegundos).toEqual([1, 2]);
    });

    it("acepta menos esperas (menos intentos en total)", () => {
      expect(cargarConfig({ DATABASE_URL, REINTENTO_ESPERAS_SEGUNDOS: "5" }).reintentoEsperasSegundos).toEqual([5]);
    });

    it.each([
      ["vacía", ""],
      ["con un valor que no es número", "1,abc,3"],
      ["con un cero", "1,0,3"],
      ["con un negativo", "1,-2,3"],
      ["con un decimal", "1,2.5,3"],
      ["con un hueco entre comas", "1,,3"],
      ["con una espera de más de un día", "1,86401"],
      ["con más de 4 esperas (superaría los 5 intentos de la prueba)", "1,2,3,4,5"],
    ])("rechaza una lista %s", (_descripcion, valor) => {
      expect(() => cargarConfig({ DATABASE_URL, REINTENTO_ESPERAS_SEGUNDOS: valor })).toThrow(
        /REINTENTO_ESPERAS_SEGUNDOS/,
      );
    });

    it("el error nombra la variable pero no repite su valor", () => {
      try {
        cargarConfig({ DATABASE_URL, REINTENTO_ESPERAS_SEGUNDOS: "valor-que-no-debe-salir" });
      } catch (error) {
        expect((error as Error).message).not.toContain("valor-que-no-debe-salir");
      }
    });
  });

  it("el nivel de logs por defecto es info", () => {
    expect(cargarConfig({ DATABASE_URL }).nivelLog).toBe("info");
  });

  it.each(["debug", "info", "warn", "error", "silent"])("acepta el nivel de logs %s", (nivel) => {
    expect(cargarConfig({ DATABASE_URL, LOG_LEVEL: nivel }).nivelLog).toBe(nivel);
  });

  it("falla si el nivel de logs no existe", () => {
    expect(() => cargarConfig({ DATABASE_URL, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
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
