// Pruebas de integración de la atomicidad: o se guarda todo o no se guarda nada.
// Es el corazón del patrón "outbox": nunca existe un evento aceptado sin su notificación.

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Guia } from "../../src/domain/guia";
import { Notificacion } from "../../src/domain/notificacion";
import { contar, crearPrisma, ensamblar, evento, tenantUnico } from "./support/entorno";

describe("atomicidad (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof ensamblar>;

  beforeAll(() => {
    prisma = crearPrisma();
    app = ensamblar(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("si algo falla después de guardar la guía y la notificación, no queda nada", async () => {
    const tenant = tenantUnico();
    const e = evento("e1", "CREADA", 0);

    await expect(
      app.unidadDeTrabajo.ejecutar(async ({ guias, notificaciones }) => {
        await guias.guardar(Guia.iniciar("GUIA-1", tenant, e));
        await notificaciones.crear(Notificacion.crear(tenant, "GUIA-1", e, new Date()));
        throw new Error("fallo simulado");
      }),
    ).rejects.toThrow("fallo simulado");

    expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 0, eventos: 0, notificaciones: 0 });
  });

  it("si la notificación no se puede guardar, el evento tampoco queda", async () => {
    const tenant = tenantUnico();

    await expect(
      app.unidadDeTrabajo.ejecutar(async ({ guias, notificaciones }) => {
        await guias.guardar(Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0)));
        // Esta notificación apunta a un evento que no existe: la base la rechaza.
        await notificaciones.crear(
          Notificacion.crear(tenant, "GUIA-1", evento("NO-EXISTE", "CREADA", 0), new Date()),
        );
      }),
    ).rejects.toMatchObject({ code: "P2003" });

    expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 0, eventos: 0, notificaciones: 0 });
  });

  it("el tenant creado dentro de la transacción también se descarta", async () => {
    const tenant = tenantUnico();

    await app.unidadDeTrabajo
      .ejecutar(async ({ guias }) => {
        await guias.guardar(Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0)));
        throw new Error("fallo simulado");
      })
      .catch(() => undefined);

    expect(await prisma.tenantDb.findUnique({ where: { id: tenant } })).toBeNull();
  });

  it("registrar un evento deja evento y notificación pendiente juntos", async () => {
    const tenant = tenantUnico();

    await app.registrarEvento.ejecutar({
      tenantId: tenant,
      guiaId: "GUIA-1",
      eventId: "e1",
      estado: "CREADA",
      fechaEvento: new Date(),
    });

    expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 1, eventos: 1, notificaciones: 1 });
    const notificacion = await prisma.notificacionDb.findFirst({ where: { tenantId: tenant } });
    expect(notificacion).toMatchObject({ estado: "PENDIENTE", intentos: 0, ultimoError: null });
  });

  it("un evento duplicado no crea otra notificación", async () => {
    const tenant = tenantUnico();
    const comando = {
      tenantId: tenant,
      guiaId: "GUIA-1",
      eventId: "e1",
      estado: "CREADA" as const,
      fechaEvento: new Date(),
    };

    await app.registrarEvento.ejecutar(comando);
    const segundo = await app.registrarEvento.ejecutar(comando);

    expect(segundo.resultado).toBe("DUPLICADO");
    expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 1, eventos: 1, notificaciones: 1 });
  });

  it("un evento rechazado por las reglas no deja ningún rastro", async () => {
    const tenant = tenantUnico();
    await app.registrarEvento.ejecutar({
      tenantId: tenant,
      guiaId: "GUIA-1",
      eventId: "e1",
      estado: "CREADA",
      fechaEvento: new Date(),
    });

    // ENTREGADA directamente desde CREADA no está permitido.
    await expect(
      app.registrarEvento.ejecutar({
        tenantId: tenant,
        guiaId: "GUIA-1",
        eventId: "e2",
        estado: "ENTREGADA",
        fechaEvento: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow();

    expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 1, eventos: 1, notificaciones: 1 });
  });

  it("un primer evento que no es CREADA no crea ni la guía ni el tenant", async () => {
    const tenant = tenantUnico();

    await expect(
      app.registrarEvento.ejecutar({
        tenantId: tenant,
        guiaId: "GUIA-1",
        eventId: "e1",
        estado: "EN_RUTA",
        fechaEvento: new Date(),
      }),
    ).rejects.toThrow();

    expect(await contar(prisma, tenant, "GUIA-1")).toEqual({ guias: 0, eventos: 0, notificaciones: 0 });
    expect(await prisma.tenantDb.findUnique({ where: { id: tenant } })).toBeNull();
  });
});
