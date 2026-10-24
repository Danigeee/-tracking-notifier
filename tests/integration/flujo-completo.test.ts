// Prueba de integración de extremo a extremo: API HTTP real + PostgreSQL real + receptor de webhook real.
//
// Recorre lo que haría un cliente de verdad:
//   configura su webhook → se registran eventos → el worker envía los avisos firmados →
//   el cliente verifica la firma → consulta el estado de sus avisos.

import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { crearApp } from "../../src/infrastructure/http/app";
import { verificarFirma } from "../../src/infrastructure/webhook/firma";
import {
  Receptor,
  crearPrisma,
  crearReceptor,
  ensamblar,
  tenantUnico,
} from "./support/entorno";

const EVENTO_1 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const EVENTO_2 = "0b2f8d5e-3c1a-4f6b-9a7d-1e2f3a4b5c6d";
const EVENTO_3 = "d2719a3c-8f4e-4b1a-8c6d-5e7f9a0b1c2d";

/** Cuerpo de un evento; `minuto` desplaza la fecha. */
const cuerpo = (eventId: string, estado: string, minuto: number, extra: object = {}) => ({
  eventId,
  estado,
  fechaEvento: new Date(Date.UTC(2026, 9, 24, 10, minuto)).toISOString(),
  ...extra,
});

describe("flujo completo (API + PostgreSQL + webhook reales)", () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof ensamblar>;
  let api: ReturnType<typeof crearApp>;
  let receptor: Receptor | undefined;

  beforeAll(() => {
    prisma = crearPrisma();
    app = ensamblar(prisma);
    api = crearApp({
      registrarEvento: app.registrarEvento,
      consultarHistorial: app.consultarHistorial,
      consultarNotificaciones: app.consultarNotificaciones,
      configurarWebhook: app.configurarWebhook,
      consultarWebhook: app.consultarWebhook,
      rotarSecretoWebhook: app.rotarSecretoWebhook,
      comprobarSalud: async () => {
        await prisma.$queryRaw`SELECT 1`;
      },
      registrador: app.registrador,
    });
  });

  afterEach(async () => {
    await receptor?.cerrar();
    receptor = undefined;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** El cliente configura su webhook y guarda el secreto que se le muestra. */
  async function configurarWebhook(tenant: string): Promise<string> {
    const res = await request(api).put("/webhook").set("X-Tenant-Id", tenant).send({ url: receptor!.url });
    expect(res.status).toBe(200);
    return res.body.secreto as string;
  }

  const registrar = (tenant: string, guia: string, body: object) =>
    request(api).post(`/guias/${guia}/eventos`).set("X-Tenant-Id", tenant).send(body);

  const notificaciones = async (tenant: string, query = "") =>
    (await request(api).get(`/notificaciones${query}`).set("X-Tenant-Id", tenant)).body.notificaciones;

  it("un evento registrado llega firmado al webhook del cliente y la notificación queda ENVIADA", async () => {
    receptor = await crearReceptor();
    const tenant = tenantUnico();
    const secreto = await configurarWebhook(tenant);

    const res = await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0, { observacion: "Recibida" }));
    expect(res.status).toBe(201);
    // La respuesta no espera al webhook: la notificación todavía está pendiente.
    expect((await notificaciones(tenant))[0]).toMatchObject({ estado: "PENDIENTE", intentos: 0 });

    await app.enviarNotificaciones.ejecutar();

    // El cliente recibió exactamente un aviso, con el contenido del evento.
    expect(receptor.recibidas).toHaveLength(1);
    const recibida = receptor.recibidas[0]!;
    expect(JSON.parse(recibida.cuerpo)).toEqual({
      eventId: EVENTO_1,
      guiaId: "GUIA-1",
      estado: "CREADA",
      fechaEvento: "2026-10-24T10:00:00.000Z",
      observacion: "Recibida",
    });
    // La firma se verifica con el secreto que el cliente recibió al configurar el webhook.
    expect(
      verificarFirma(
        secreto,
        Number(recibida.cabeceras["x-timestamp"]),
        recibida.cuerpo,
        String(recibida.cabeceras["x-signature"]),
      ),
    ).toBe(true);
    expect(recibida.cabeceras["x-event-id"]).toBe(EVENTO_1);
    // Y la API informa que se envió.
    expect((await notificaciones(tenant))[0]).toMatchObject({
      estado: "ENVIADA",
      intentos: 1,
      ultimoCodigoHttp: 200,
    });
  });

  it("recorre todo el ciclo de una guía y cada cambio de estado se notifica en orden", async () => {
    receptor = await crearReceptor();
    const tenant = tenantUnico();
    await configurarWebhook(tenant);

    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_2, "EN_RUTA", 5));
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_3, "ENTREGADA", 10));
    await app.enviarNotificaciones.ejecutar();

    const historial = await request(api).get("/guias/GUIA-1").set("X-Tenant-Id", tenant);
    expect(historial.body.estadoActual).toBe("ENTREGADA");
    expect(historial.body.eventos.map((e: { estado: string }) => e.estado)).toEqual([
      "CREADA",
      "EN_RUTA",
      "ENTREGADA",
    ]);
    expect(receptor.recibidas.map((r) => JSON.parse(r.cuerpo).estado).sort()).toEqual([
      "CREADA",
      "ENTREGADA",
      "EN_RUTA",
    ]);
    expect(await notificaciones(tenant, "?estado=ENVIADA")).toHaveLength(3);
  });

  it("reglas de negocio: una guía entregada no cambia y el rechazo no genera aviso", async () => {
    receptor = await crearReceptor();
    const tenant = tenantUnico();
    await configurarWebhook(tenant);
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_2, "EN_RUTA", 5));
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_3, "ENTREGADA", 10));

    const rechazo = await registrar(
      tenant,
      "GUIA-1",
      cuerpo("a1b2c3d4-0000-4000-8000-000000000001", "DEVUELTA", 15),
    );
    await app.enviarNotificaciones.ejecutar();

    expect(rechazo.status).toBe(409);
    expect(receptor.recibidas).toHaveLength(3);
  });

  it("un evento duplicado responde 200 y no se avisa dos veces", async () => {
    receptor = await crearReceptor();
    const tenant = tenantUnico();
    await configurarWebhook(tenant);

    const primero = await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));
    const segundo = await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));
    await app.enviarNotificaciones.ejecutar();
    await app.enviarNotificaciones.ejecutar();

    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(200);
    expect(segundo.body.duplicado).toBe(true);
    expect(receptor.recibidas).toHaveLength(1);
  });

  it("si el cliente falla, se reintenta y al final el aviso llega", async () => {
    // El cliente responde 500 al primer intento y 200 al segundo.
    receptor = await crearReceptor((numero) => (numero === 1 ? 500 : 200));
    const tenant = tenantUnico();
    await configurarWebhook(tenant);
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));

    await app.enviarNotificaciones.ejecutar();
    const trasElFallo = (await notificaciones(tenant))[0];
    expect(trasElFallo).toMatchObject({
      estado: "PENDIENTE",
      intentos: 1,
      ultimoError: "el webhook respondió 500",
    });

    // Se adelanta el reloj de espera de 10 s en la base.
    await prisma.notificacionDb.updateMany({ where: { tenantId: tenant }, data: { proximoIntento: new Date() } });
    await app.enviarNotificaciones.ejecutar();

    expect((await notificaciones(tenant))[0]).toMatchObject({ estado: "ENVIADA", intentos: 2, ultimoError: null });
    // El cliente vio el mismo evento dos veces, con el mismo X-Event-Id para poder deduplicar.
    expect(receptor.llegadasPorEvento().get(EVENTO_1)).toBe(2);
  });

  it("una notificación que agota sus intentos queda FALLIDA y se puede consultar", async () => {
    receptor = await crearReceptor(() => 503);
    const tenant = tenantUnico();
    await configurarWebhook(tenant);
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));

    for (let i = 0; i < 5; i++) {
      await app.enviarNotificaciones.ejecutar();
      await prisma.notificacionDb.updateMany({ where: { tenantId: tenant, estado: "PENDIENTE" }, data: { proximoIntento: new Date() } });
    }

    const fallidas = await notificaciones(tenant, "?estado=FALLIDA");
    expect(fallidas).toHaveLength(1);
    expect(fallidas[0]).toMatchObject({
      eventId: EVENTO_1,
      intentos: 5,
      ultimoError: "el webhook respondió 503",
      ultimoCodigoHttp: 503,
    });
  });

  it("los eventos de antes de configurar el webhook se avisan cuando se configura", async () => {
    receptor = await crearReceptor();
    const tenant = tenantUnico();
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_2, "EN_RUTA", 5));
    await app.enviarNotificaciones.ejecutar();
    expect(receptor.recibidas).toHaveLength(0);
    expect(await notificaciones(tenant, "?estado=PENDIENTE")).toHaveLength(2);

    await configurarWebhook(tenant);
    await app.enviarNotificaciones.ejecutar();

    expect(receptor.recibidas).toHaveLength(2);
    expect(await notificaciones(tenant, "?estado=ENVIADA")).toHaveLength(2);
  });

  it("al rotar el secreto, los avisos nuevos se firman con el nuevo y el viejo deja de servir", async () => {
    receptor = await crearReceptor();
    const tenant = tenantUnico();
    const viejo = await configurarWebhook(tenant);
    const rotacion = await request(api).post("/webhook/secreto").set("X-Tenant-Id", tenant);
    const nuevo = rotacion.body.secreto as string;
    await registrar(tenant, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));

    await app.enviarNotificaciones.ejecutar();

    const r = receptor.recibidas[0]!;
    const verificar = (secreto: string) =>
      verificarFirma(secreto, Number(r.cabeceras["x-timestamp"]), r.cuerpo, String(r.cabeceras["x-signature"]));
    expect(nuevo).not.toBe(viejo);
    expect(verificar(nuevo)).toBe(true);
    expect(verificar(viejo)).toBe(false);
  });

  it("aislamiento: un cliente no ve las guías, el webhook ni los avisos de otro", async () => {
    receptor = await crearReceptor();
    const a = tenantUnico("a");
    const b = tenantUnico("b");
    await configurarWebhook(a);
    await registrar(a, "GUIA-1", cuerpo(EVENTO_1, "CREADA", 0));

    expect((await request(api).get("/guias/GUIA-1").set("X-Tenant-Id", b)).status).toBe(404);
    expect((await request(api).get("/webhook").set("X-Tenant-Id", b)).status).toBe(404);
    expect(await notificaciones(b)).toEqual([]);
    // El otro cliente no puede cambiar ni adivinar el estado de la guía de A.
    expect((await registrar(b, "GUIA-1", cuerpo(EVENTO_2, "EN_RUTA", 5))).status).toBe(422);
    expect((await request(api).get("/guias/GUIA-1").set("X-Tenant-Id", a)).body.estadoActual).toBe("CREADA");
  });

  it("el health check comprueba la base de datos real", async () => {
    const res = await request(api).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: "ok" });
  });
});
