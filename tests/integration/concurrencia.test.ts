// Pruebas de integración de concurrencia: varias peticiones a la vez contra PostgreSQL real.
// Un repositorio en memoria no puede demostrar nada de esto: aquí se prueba el bloqueo
// por guía y las operaciones atómicas de la base de datos.

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contar, crearPrisma, ensamblar, tenantUnico } from "./support/entorno";

/** Fecha fija, `minuto` minutos después de las 10:00 UTC. */
const fecha = (minuto: number) => new Date(Date.UTC(2026, 9, 24, 10, minuto));

describe("concurrencia (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof ensamblar>;

  beforeAll(() => {
    prisma = crearPrisma();
    app = ensamblar(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("registrar eventos", () => {
    it("10 peticiones simultáneas con el mismo eventId dejan 1 evento y 1 notificación", async () => {
      const tenant = tenantUnico();

      const resultados = await Promise.all(
        Array.from({ length: 10 }, () =>
          app.registrarEvento.ejecutar({
            tenantId: tenant,
            guiaId: "GUIA-1",
            eventId: "mismo-evento",
            estado: "CREADA",
            fechaEvento: fecha(0),
          }),
        ),
      );

      expect(resultados.filter((r) => r.resultado === "REGISTRADO")).toHaveLength(1);
      expect(resultados.filter((r) => r.resultado === "DUPLICADO")).toHaveLength(9);
      expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 1, eventos: 1, notificaciones: 1 });
    });

    it("lo mismo con una guía que ya existía: un solo evento nuevo y una sola notificación", async () => {
      const tenant = tenantUnico();
      await app.registrarEvento.ejecutar({
        tenantId: tenant,
        guiaId: "GUIA-1",
        eventId: "e1",
        estado: "CREADA",
        fechaEvento: fecha(0),
      });

      const resultados = await Promise.all(
        Array.from({ length: 10 }, () =>
          app.registrarEvento.ejecutar({
            tenantId: tenant,
            guiaId: "GUIA-1",
            eventId: "e2",
            estado: "EN_RUTA",
            fechaEvento: fecha(5),
          }),
        ),
      );

      expect(resultados.filter((r) => r.resultado === "REGISTRADO")).toHaveLength(1);
      expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 1, eventos: 2, notificaciones: 2 });
    });

    it("dos eventos distintos a la vez sobre la misma guía se serializan y quedan consistentes", async () => {
      const tenant = tenantUnico();
      await app.registrarEvento.ejecutar({
        tenantId: tenant,
        guiaId: "GUIA-1",
        eventId: "e1",
        estado: "CREADA",
        fechaEvento: fecha(0),
      });

      // EN_RUTA (minuto 5) y DEVUELTA (minuto 6) llegan a la vez. Según quién entre primero:
      //  - EN_RUTA y luego DEVUELTA: los dos son válidos.
      //  - DEVUELTA y luego EN_RUTA: EN_RUTA se rechaza (desde DEVUELTA no se puede cambiar).
      const resultados = await Promise.allSettled([
        app.registrarEvento.ejecutar({
          tenantId: tenant,
          guiaId: "GUIA-1",
          eventId: "e2",
          estado: "EN_RUTA",
          fechaEvento: fecha(5),
        }),
        app.registrarEvento.ejecutar({
          tenantId: tenant,
          guiaId: "GUIA-1",
          eventId: "e3",
          estado: "DEVUELTA",
          fechaEvento: fecha(6),
        }),
      ]);

      const guia = await app.guias.buscar(tenant, "GUIA-1");
      const conteo = await contar(prisma, tenant, "GUIA-1");
      // Pase lo que pase, el estado final es DEVUELTA y cada evento tiene su notificación.
      expect(guia?.estadoActual).toBe("DEVUELTA");
      expect(conteo.eventos).toBe(conteo.notificaciones);
      // La DEVUELTA siempre se acepta; la EN_RUTA solo si entró primero.
      expect(resultados[1]?.status).toBe("fulfilled");
      expect(conteo.eventos).toBe(resultados[0]?.status === "fulfilled" ? 3 : 2);
      // El historial queda en orden cronológico.
      const fechas = guia!.eventos.map((e) => e.fechaEvento.getTime());
      expect(fechas).toEqual([...fechas].sort((a, b) => a - b));
    });

    it("guías distintas del mismo tenant se procesan a la vez sin interferirse", async () => {
      const tenant = tenantUnico();

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          app.registrarEvento.ejecutar({
            tenantId: tenant,
            guiaId: `GUIA-${i}`,
            eventId: `e-${i}`,
            estado: "CREADA",
            fechaEvento: fecha(0),
          }),
        ),
      );

      expect(await prisma.guiaDb.count({ where: { tenantId: tenant } })).toBe(10);
      expect(await prisma.notificacionDb.count({ where: { tenantId: tenant } })).toBe(10);
    });
  });

  describe("secreto del webhook", () => {
    it("12 configuraciones simultáneas de un tenant nuevo muestran un único secreto, el guardado", async () => {
      const tenant = tenantUnico();

      const resultados = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          app.configurarWebhook.ejecutar({ tenantId: tenant, url: `https://cliente.example/hook${i}` }),
        ),
      );

      const conSecreto = resultados.filter((r) => r.secreto !== null);
      expect(conSecreto).toHaveLength(1);
      const fila = await prisma.tenantDb.findUnique({ where: { id: tenant } });
      expect(fila?.webhookSecret).toBe(conSecreto[0]?.secreto);
    });

    it("6 rotaciones simultáneas dejan como secreto uno de los devueltos y no tocan la URL", async () => {
      const tenant = tenantUnico();
      await app.configurarWebhook.ejecutar({ tenantId: tenant, url: "https://cliente.example/hook" });

      const rotados = await Promise.all(
        Array.from({ length: 6 }, () => app.rotarSecretoWebhook.ejecutar({ tenantId: tenant })),
      );

      const fila = await prisma.tenantDb.findUnique({ where: { id: tenant } });
      expect(rotados).toContain(fila?.webhookSecret);
      expect(fila?.webhookUrl).toBe("https://cliente.example/hook");
    });

    it("rotar el secreto de un tenant sin webhook no crea nada", async () => {
      const tenant = tenantUnico();
      await prisma.tenantDb.create({ data: { id: tenant } });

      await expect(app.rotarSecretoWebhook.ejecutar({ tenantId: tenant })).rejects.toThrow();

      const fila = await prisma.tenantDb.findUnique({ where: { id: tenant } });
      expect(fila?.webhookSecret).toBeNull();
    });

    it("una configuración simultánea con un registro de eventos no pierde la URL ni el secreto", async () => {
      const tenant = tenantUnico();

      const [config] = await Promise.all([
        app.configurarWebhook.ejecutar({ tenantId: tenant, url: "https://cliente.example/hook" }),
        ...Array.from({ length: 5 }, (_, i) =>
          app.registrarEvento.ejecutar({
            tenantId: tenant,
            guiaId: `GUIA-${i}`,
            eventId: `e-${i}`,
            estado: "CREADA",
            fechaEvento: fecha(0),
          }),
        ),
      ]);

      const fila = await prisma.tenantDb.findUnique({ where: { id: tenant } });
      expect(fila?.webhookUrl).toBe("https://cliente.example/hook");
      expect(fila?.webhookSecret).toBe(config.secreto);
    });
  });
});
