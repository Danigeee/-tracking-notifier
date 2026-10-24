// Pruebas de integración de la persistencia, contra un PostgreSQL real.
// Comprueban lo que las pruebas con repositorios en memoria no pueden demostrar:
// que los datos se guardan y se leen igual, y que las restricciones de la base funcionan.

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Guia } from "../../src/domain/guia";
import { Notificacion } from "../../src/domain/notificacion";
import { contar, crearPrisma, ensamblar, evento, tenantUnico } from "./support/entorno";

describe("persistencia (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof ensamblar>;

  beforeAll(() => {
    prisma = crearPrisma();
    app = ensamblar(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("guarda una guía con sus eventos y la lee igual, en orden", async () => {
    const tenant = tenantUnico();
    const guia = Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0, "Recibida"));
    guia.registrarEvento(evento("e2", "EN_RUTA", 5));
    guia.registrarEvento(evento("e3", "ENTREGADA", 10, "Entregada en portería"));

    await app.guias.guardar(guia);
    const leida = await app.guias.buscar(tenant, "GUIA-1");

    expect(leida?.estadoActual).toBe("ENTREGADA");
    expect(leida?.eventos.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(leida?.eventos.map((e) => e.estado)).toEqual(["CREADA", "EN_RUTA", "ENTREGADA"]);
    expect(leida?.eventos.map((e) => e.observacion)).toEqual([
      "Recibida",
      undefined, // sin observación: la base guarda null y el dominio lo ve como ausente
      "Entregada en portería",
    ]);
  });

  it("conserva las fechas con precisión de milisegundos", async () => {
    const tenant = tenantUnico();
    const fecha = new Date("2026-10-24T10:00:00.123Z");
    const guia = Guia.iniciar("GUIA-1", tenant, { eventId: "e1", estado: "CREADA", fechaEvento: fecha });

    await app.guias.guardar(guia);

    const leida = await app.guias.buscar(tenant, "GUIA-1");
    expect(leida?.eventos[0]?.fechaEvento.toISOString()).toBe("2026-10-24T10:00:00.123Z");
  });

  it("la misma guía puede existir en dos tenants sin mezclarse", async () => {
    const a = tenantUnico("a");
    const b = tenantUnico("b");
    await app.guias.guardar(Guia.iniciar("GUIA-1", a, evento("e1", "CREADA", 0)));
    const guiaB = Guia.iniciar("GUIA-1", b, evento("e1", "CREADA", 0));
    guiaB.registrarEvento(evento("e2", "DEVUELTA", 5));
    await app.guias.guardar(guiaB);

    expect((await app.guias.buscar(a, "GUIA-1"))?.estadoActual).toBe("CREADA");
    expect((await app.guias.buscar(b, "GUIA-1"))?.estadoActual).toBe("DEVUELTA");
  });

  it("no devuelve la guía de otro tenant", async () => {
    const dueno = tenantUnico("dueno");
    await app.guias.guardar(Guia.iniciar("GUIA-1", dueno, evento("e1", "CREADA", 0)));

    expect(await app.guias.buscar(tenantUnico("otro"), "GUIA-1")).toBeNull();
  });

  it("guardar de nuevo la misma guía no duplica eventos", async () => {
    const tenant = tenantUnico();
    const guia = Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0));
    guia.registrarEvento(evento("e2", "EN_RUTA", 5));

    await app.guias.guardar(guia);
    await app.guias.guardar(guia);

    expect((await contar(prisma, tenant, "GUIA-1")).eventos).toBe(2);
  });

  it("agrega solo los eventos nuevos al guardar una guía que ya existía", async () => {
    const tenant = tenantUnico();
    await app.guias.guardar(Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0)));

    const guia = (await app.guias.buscar(tenant, "GUIA-1"))!;
    guia.registrarEvento(evento("e2", "EN_RUTA", 5));
    await app.guias.guardar(guia);

    expect((await app.guias.buscar(tenant, "GUIA-1"))?.eventos.map((e) => e.eventId)).toEqual([
      "e1",
      "e2",
    ]);
  });

  it("crea el tenant al guardar su primera guía", async () => {
    const tenant = tenantUnico();
    expect(await prisma.tenantDb.findUnique({ where: { id: tenant } })).toBeNull();

    await app.guias.guardar(Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0)));

    expect(await prisma.tenantDb.findUnique({ where: { id: tenant } })).not.toBeNull();
  });

  it("registrar eventos no borra la URL ni el secreto del webhook ya configurado", async () => {
    const tenant = tenantUnico();
    const { secreto } = await app.configurarWebhook.ejecutar({
      tenantId: tenant,
      url: "https://cliente.example/hook",
    });

    await app.registrarEvento.ejecutar({
      tenantId: tenant,
      guiaId: "GUIA-1",
      eventId: "e1",
      estado: "CREADA",
      fechaEvento: new Date(),
    });

    const fila = await prisma.tenantDb.findUnique({ where: { id: tenant } });
    expect(fila?.webhookUrl).toBe("https://cliente.example/hook");
    expect(fila?.webhookSecret).toBe(secreto);
  });

  describe("restricciones de la base de datos (defensa en profundidad)", () => {
    it("la clave primaria impide dos eventos con el mismo eventId en una guía", async () => {
      const tenant = tenantUnico();
      await app.guias.guardar(Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0)));

      const duplicado = prisma.eventoGuiaDb.create({
        data: {
          tenantId: tenant,
          guiaId: "GUIA-1",
          eventId: "e1",
          estado: "CREADA",
          fechaEvento: new Date(),
        },
      });

      // P2002 es el código de Prisma para "violación de unicidad".
      await expect(duplicado).rejects.toMatchObject({ code: "P2002" });
    });

    it("no admite una notificación de un evento que no existe (clave foránea)", async () => {
      const tenant = tenantUnico();
      await app.guias.guardar(Guia.iniciar("GUIA-1", tenant, evento("e1", "CREADA", 0)));
      const huerfana = Notificacion.crear(tenant, "GUIA-1", evento("NO-EXISTE", "CREADA", 0), new Date());

      // P2003 es el código de Prisma para "violación de clave foránea".
      await expect(app.notificaciones.crear(huerfana)).rejects.toMatchObject({ code: "P2003" });
    });

    it("no admite dos notificaciones para el mismo evento", async () => {
      const tenant = tenantUnico();
      await app.registrarEvento.ejecutar({
        tenantId: tenant,
        guiaId: "GUIA-1",
        eventId: "e1",
        estado: "CREADA",
        fechaEvento: new Date(),
      });
      const otra = Notificacion.crear(tenant, "GUIA-1", evento("e1", "CREADA", 0), new Date());

      await expect(app.notificaciones.crear(otra)).rejects.toMatchObject({ code: "P2002" });
    });

    it("no admite una guía de un tenant que no existe", async () => {
      const sinTenant = prisma.guiaDb.create({ data: { tenantId: tenantUnico("fantasma"), id: "G" } });

      await expect(sinTenant).rejects.toMatchObject({ code: "P2003" });
    });
  });
});
