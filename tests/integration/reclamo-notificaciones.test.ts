// Pruebas de integración del reclamo y envío de notificaciones contra PostgreSQL real.
// Verifican que varias instancias del servicio pueden trabajar a la vez sin enviar el mismo
// aviso dos veces (FOR UPDATE SKIP LOCKED), y que un cliente sin webhook no bloquea a los demás.

import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EnviarNotificacionesPendientes } from "../../src/application/use-cases/enviar-notificaciones-pendientes";
import { NotificacionRepositoryPrisma } from "../../src/infrastructure/persistence/notificacion-repository-prisma";
import { RelojSistema } from "../../src/infrastructure/reloj/reloj-sistema";
import { ClienteWebhookHttp } from "../../src/infrastructure/webhook/cliente-webhook-http";
import { RegistradorEnMemoria } from "../support/registrador-en-memoria";
import {
  Receptor,
  crearPrisma,
  crearReceptor,
  ensamblar,
  sembrarNotificaciones,
  tenantUnico,
} from "./support/entorno";

describe("reclamo y envío de notificaciones (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof ensamblar>;
  let receptor: Receptor | undefined;

  beforeAll(() => {
    prisma = crearPrisma();
    app = ensamblar(prisma);
  });

  // Estas pruebas miran toda la tabla de notificaciones, no solo las de un tenant. La base es
  // temporal y exclusiva de las pruebas, así que se vacía antes de cada una para partir de cero.
  beforeEach(async () => {
    await prisma.notificacionDb.deleteMany();
  });

  afterEach(async () => {
    await receptor?.cerrar();
    receptor = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Configura el webhook de un tenant apuntando al receptor y devuelve su secreto. */
  async function configurar(tenant: string): Promise<string> {
    const { secreto } = await app.configurarWebhook.ejecutar({ tenantId: tenant, url: receptor!.url });
    return secreto!;
  }

  describe("varias instancias a la vez", () => {
    it("3 instancias trabajando juntas entregan cada aviso exactamente una vez", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      await configurar(tenant);
      const eventIds = await sembrarNotificaciones(prisma, tenant, 40, "multi");

      // Tres "instancias": cada una con su propia conexión a la base, como procesos distintos.
      const instancias = Array.from({ length: 3 }, () => {
        const prismaPropio = crearPrisma();
        const caso = new EnviarNotificacionesPendientes(
          new NotificacionRepositoryPrisma(prismaPropio),
          new ClienteWebhookHttp(2000, new RelojSistema()),
          new RelojSistema(),
          new RegistradorEnMemoria(),
          { tamanoLote: 5 },
        );
        return { prismaPropio, caso };
      });

      const procesadasPorInstancia = await Promise.all(
        instancias.map(async ({ caso }) => {
          let procesadas = 0;
          for (let i = 0; i < 12; i++) procesadas += (await caso.ejecutar()).procesadas;
          return procesadas;
        }),
      );
      await Promise.all(instancias.map(({ prismaPropio }) => prismaPropio.$disconnect()));

      // Cada aviso lo tomó una sola instancia...
      expect(procesadasPorInstancia.reduce((a, b) => a + b, 0)).toBe(40);
      // ...y el cliente recibió cada evento una sola vez.
      const llegadas = receptor.llegadasPorEvento();
      expect([...llegadas.keys()].sort()).toEqual([...eventIds].sort());
      expect([...llegadas.values()].every((veces) => veces === 1)).toBe(true);
      // Y todos quedaron como enviados, con un solo intento.
      const estados = await prisma.notificacionDb.groupBy({
        by: ["estado", "intentos"],
        where: { tenantId: tenant },
        _count: true,
      });
      expect(estados).toEqual([{ estado: "ENVIADA", intentos: 1, _count: 40 }]);
    });

    it("dos reclamos simultáneos nunca devuelven la misma notificación", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      await configurar(tenant);
      await sembrarNotificaciones(prisma, tenant, 30, "doble");
      const ahora = new Date();
      const reservarHasta = new Date(ahora.getTime() + 60_000);

      const [a, b] = await Promise.all([
        app.notificaciones.reclamarPorEnviar({ ahora, limite: 20, reservarHasta }),
        app.notificaciones.reclamarPorEnviar({ ahora, limite: 20, reservarHasta }),
      ]);

      const clavesA = a.map((x) => x.notificacion.eventId);
      const clavesB = b.map((x) => x.notificacion.eventId);
      expect(clavesA.filter((c) => clavesB.includes(c))).toEqual([]);
      expect(clavesA.length + clavesB.length).toBe(30);
    });
  });

  describe("clientes sin webhook", () => {
    it("30 avisos antiguos de un cliente sin webhook no impiden enviar los de otro cliente", async () => {
      receptor = await crearReceptor();
      const sinWebhook = tenantUnico("sin-webhook");
      const conWebhook = tenantUnico("con-webhook");
      await prisma.tenantDb.create({ data: { id: sinWebhook } });
      await configurar(conWebhook);
      // Los del cliente sin webhook son MÁS antiguos: si se reclamaran, ocuparían el límite del lote.
      await sembrarNotificaciones(prisma, sinWebhook, 30, "viejos", new Date(Date.now() - 3_600_000));
      const eventIds = await sembrarNotificaciones(prisma, conWebhook, 10, "nuevos");
      const caso = new EnviarNotificacionesPendientes(
        app.notificaciones,
        new ClienteWebhookHttp(2000, new RelojSistema()),
        new RelojSistema(),
        new RegistradorEnMemoria(),
        { tamanoLote: 5 },
      );

      for (let i = 0; i < 4; i++) await caso.ejecutar();

      expect([...receptor.llegadasPorEvento().keys()].sort()).toEqual([...eventIds].sort());
      // Los del cliente sin webhook siguen pendientes y sin intentos gastados.
      const sinTocar = await prisma.notificacionDb.findMany({ where: { tenantId: sinWebhook } });
      expect(sinTocar).toHaveLength(30);
      expect(sinTocar.every((n) => n.estado === "PENDIENTE" && n.intentos === 0)).toBe(true);
    });

    it("al configurar el webhook, los avisos acumulados se envían: no se pierden", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      await sembrarNotificaciones(prisma, tenant, 3, "acumulados", new Date(Date.now() - 600_000));
      expect((await app.enviarNotificaciones.ejecutar()).procesadas).toBe(0);

      await configurar(tenant);
      const resumen = await app.enviarNotificaciones.ejecutar();

      expect(resumen.enviadas).toBe(3);
      expect(receptor.recibidas).toHaveLength(3);
    });

    it("un cliente con URL pero sin secreto no se reclama (no se puede firmar)", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      // Se crea directamente en la base, saltando el caso de uso que siempre genera un secreto.
      await prisma.tenantDb.create({ data: { id: tenant, webhookUrl: receptor.url, webhookSecret: null } });
      await sembrarNotificaciones(prisma, tenant, 2, "sin-secreto");

      const resumen = await app.enviarNotificaciones.ejecutar();

      expect(resumen.procesadas).toBe(0);
      expect(receptor.recibidas).toHaveLength(0);
    });
  });

  describe("reserva de las notificaciones reclamadas", () => {
    it("una notificación reclamada no se puede reclamar de nuevo mientras dure la reserva", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      await configurar(tenant);
      await sembrarNotificaciones(prisma, tenant, 3, "reserva");
      const ahora = new Date();
      const reservarHasta = new Date(ahora.getTime() + 60_000);

      const primera = await app.notificaciones.reclamarPorEnviar({ ahora, limite: 10, reservarHasta });
      const segunda = await app.notificaciones.reclamarPorEnviar({ ahora, limite: 10, reservarHasta });

      expect(primera).toHaveLength(3);
      expect(segunda).toHaveLength(0);
    });

    it("si quien la reclamó se cae, al vencer la reserva vuelve a estar disponible", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      await configurar(tenant);
      await sembrarNotificaciones(prisma, tenant, 3, "caida");
      const ahora = new Date();
      // Se reclama pero nunca se guarda el resultado, como si el proceso hubiera muerto.
      await app.notificaciones.reclamarPorEnviar({
        ahora,
        limite: 10,
        reservarHasta: new Date(ahora.getTime() + 60_000),
      });

      const despuesDeLaReserva = new Date(ahora.getTime() + 61_000);
      const recuperadas = await app.notificaciones.reclamarPorEnviar({
        ahora: despuesDeLaReserva,
        limite: 10,
        reservarHasta: new Date(despuesDeLaReserva.getTime() + 60_000),
      });

      expect(recuperadas).toHaveLength(3);
    });

    it("el reclamo devuelve la URL y el secreto vigentes del cliente", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      const secreto = await configurar(tenant);
      await sembrarNotificaciones(prisma, tenant, 1, "datos");

      const [reclamada] = await app.notificaciones.reclamarPorEnviar({
        ahora: new Date(),
        limite: 1,
        reservarHasta: new Date(Date.now() + 60_000),
      });

      expect(reclamada?.webhookUrl).toBe(receptor.url);
      expect(reclamada?.webhookSecreto).toBe(secreto);
    });

    it("respeta el límite del lote y reclama primero las más antiguas", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      await configurar(tenant);
      const antiguas = await sembrarNotificaciones(prisma, tenant, 2, "antigua", new Date(Date.now() - 7_200_000));
      await sembrarNotificaciones(prisma, tenant, 5, "reciente", new Date(Date.now() - 60_000));

      const lote = await app.notificaciones.reclamarPorEnviar({
        ahora: new Date(),
        limite: 2,
        reservarHasta: new Date(Date.now() + 60_000),
      });

      expect(lote.map((x) => x.notificacion.eventId).sort()).toEqual([...antiguas].sort());
    });

    it("no reclama las que todavía no vencieron", async () => {
      receptor = await crearReceptor();
      const tenant = tenantUnico();
      await configurar(tenant);
      await sembrarNotificaciones(prisma, tenant, 2, "futuras", new Date(Date.now() + 3_600_000));

      const lote = await app.notificaciones.reclamarPorEnviar({
        ahora: new Date(),
        limite: 10,
        reservarHasta: new Date(Date.now() + 60_000),
      });

      expect(lote).toHaveLength(0);
    });
  });

  describe("guardar el resultado del envío", () => {
    it("un fallo deja la notificación pendiente con el motivo y el próximo intento", async () => {
      receptor = await crearReceptor(() => 500);
      const tenant = tenantUnico();
      await configurar(tenant);
      await sembrarNotificaciones(prisma, tenant, 1, "fallo");

      const antes = Date.now();
      await app.enviarNotificaciones.ejecutar();

      const fila = await prisma.notificacionDb.findFirstOrThrow({ where: { tenantId: tenant } });
      expect(fila).toMatchObject({
        estado: "PENDIENTE",
        intentos: 1,
        ultimoError: "el webhook respondió 500",
        ultimoCodigoHttp: 500,
      });
      // El siguiente intento es unos 10 segundos después.
      expect(fila.proximoIntento.getTime() - antes).toBeGreaterThanOrEqual(9_000);
      expect(fila.proximoIntento.getTime() - antes).toBeLessThan(15_000);
    });

    it("tras 5 fallos queda FALLIDA y ya no se reclama", async () => {
      receptor = await crearReceptor(() => 500);
      const tenant = tenantUnico();
      await configurar(tenant);
      await sembrarNotificaciones(prisma, tenant, 1, "agotada");

      for (let intento = 1; intento <= 5; intento++) {
        await app.enviarNotificaciones.ejecutar();
        // En lugar de esperar 10 s, 1 min, 5 min y 30 min, se adelanta el reloj de espera en la base.
        await prisma.notificacionDb.updateMany({
          where: { tenantId: tenant, estado: "PENDIENTE" },
          data: { proximoIntento: new Date() },
        });
      }
      const extra = await app.enviarNotificaciones.ejecutar();

      const fila = await prisma.notificacionDb.findFirstOrThrow({ where: { tenantId: tenant } });
      expect(fila).toMatchObject({ estado: "FALLIDA", intentos: 5 });
      expect(extra.procesadas).toBe(0);
      expect(receptor.recibidas).toHaveLength(5);
    });
  });
});
