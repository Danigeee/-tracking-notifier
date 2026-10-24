// Pruebas del registrador real (pino): formato JSON, niveles y protección de datos sensibles.

import { beforeEach, describe, expect, it } from "vitest";
import { NivelLog, RegistradorPino } from "../../../src/infrastructure/logging/registrador-pino";

/** Registrador que escribe en una lista en vez de en la consola. */
function crear(nivel: NivelLog) {
  const lineas: string[] = [];
  const registrador = new RegistradorPino(nivel, { write: (linea: string) => void lineas.push(linea) });
  /** Líneas ya convertidas de JSON a objeto. */
  const registros = () => lineas.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { registrador, lineas, registros };
}

describe("RegistradorPino", () => {
  let log: ReturnType<typeof crear>;

  beforeEach(() => {
    log = crear("debug");
  });

  describe("formato", () => {
    it("escribe una línea de JSON válido por cada log", () => {
      log.registrador.info("uno");
      log.registrador.warn("dos");

      expect(log.lineas).toHaveLength(2);
      // Cada línea se puede convertir a objeto sin error.
      expect(() => log.registros()).not.toThrow();
    });

    it("incluye nivel como texto, hora ISO 8601, servicio y mensaje", () => {
      log.registrador.info("evento registrado");

      const [registro] = log.registros();
      expect(registro).toMatchObject({
        level: "info",
        servicio: "tracking-notifier",
        msg: "evento registrado",
      });
      expect(String(registro?.["time"])).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("incluye los datos como campos de la misma línea", () => {
      log.registrador.info("evento registrado", {
        tenantId: "cliente-demo",
        guiaId: "GUIA-001",
        intento: 2,
        duplicado: false,
      });

      expect(log.registros()[0]).toMatchObject({
        tenantId: "cliente-demo",
        guiaId: "GUIA-001",
        intento: 2,
        duplicado: false,
      });
    });

    it.each(["debug", "info", "warn", "error"] as const)("usa el nivel %s", (nivel) => {
      log.registrador[nivel]("mensaje");

      expect(log.registros()[0]?.["level"]).toBe(nivel);
    });
  });

  describe("niveles", () => {
    it("el nivel info no escribe los debug", () => {
      const { registrador, lineas } = crear("info");

      registrador.debug("detalle");
      registrador.info("normal");

      expect(lineas).toHaveLength(1);
    });

    it("el nivel error solo escribe errores", () => {
      const { registrador, lineas } = crear("error");

      registrador.info("a");
      registrador.warn("b");
      registrador.error("c");

      expect(lineas).toHaveLength(1);
    });

    it("el nivel silent no escribe nada", () => {
      const { registrador, lineas } = crear("silent");

      registrador.error("falla");

      expect(lineas).toHaveLength(0);
    });
  });

  describe("errores", () => {
    it("describe el error con tipo, mensaje y traza", () => {
      log.registrador.error("falló algo", { tenantId: "cliente-demo" }, new TypeError("valor inválido"));

      const registro = log.registros()[0] as { error: Record<string, string> };
      expect(registro.error["tipo"]).toBe("TypeError");
      expect(registro.error["mensaje"]).toBe("valor inválido");
      expect(registro.error["traza"]).toContain("TypeError: valor inválido");
    });

    it("incluye el código de los errores que lo traen (por ejemplo, los de Prisma)", () => {
      const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

      log.registrador.error("falló la base", {}, error);

      expect((log.registros()[0] as { error: Record<string, string> }).error["codigo"]).toBe("P2002");
    });

    it("lo lanzado que no es un Error se describe solo por su tipo", () => {
      log.registrador.error("falló", {}, "texto con datos: password=1234");

      const registro = log.registros()[0] as { error: Record<string, string> };
      expect(registro.error).toEqual({ tipo: "string" });
      expect(log.lineas[0]).not.toContain("1234");
    });

    it("sin error no agrega el campo error", () => {
      log.registrador.error("falló sin causa conocida");

      expect(log.registros()[0]).not.toHaveProperty("error");
    });
  });

  describe("protección de datos sensibles", () => {
    it("oculta los secretos y las URLs dentro del mensaje y la traza de un error", () => {
      const secreto = "whsec_" + "ab".repeat(32);
      const error = new Error(
        `fallo con ${secreto} contra https://cliente.example/token-privado y postgresql://postgres:clave@db:5432/x`,
      );

      log.registrador.error("falló el envío", {}, error);

      const texto = log.lineas[0] ?? "";
      expect(texto).not.toContain(secreto);
      expect(texto).not.toContain("token-privado");
      expect(texto).not.toContain("cliente.example");
      expect(texto).not.toContain("clave");
    });

    it.each([
      "secreto",
      "webhookSecreto",
      "firma",
      "url",
      "webhookUrl",
      "observacion",
      "cuerpo",
      "authorization",
    ])("el campo '%s' nunca sale con su valor, aunque alguien lo pase por error", (campo) => {
      log.registrador.info("mensaje", { [campo]: "VALOR-SENSIBLE" });

      expect(log.lineas[0]).not.toContain("VALOR-SENSIBLE");
      expect(log.registros()[0]?.[campo]).toBe("[oculto]");
    });

    it("no oculta los identificadores de negocio", () => {
      log.registrador.info("mensaje", { tenantId: "cliente-demo", guiaId: "GUIA-001", eventId: "e1" });

      expect(log.registros()[0]).toMatchObject({
        tenantId: "cliente-demo",
        guiaId: "GUIA-001",
        eventId: "e1",
      });
    });
  });
});
