// Pruebas de la API HTTP con Supertest.
// Usan los casos de uso reales con repositorios en memoria: así se comprueba
// la validación, los códigos HTTP y el formato de error sin necesitar base de datos.

import request from "supertest";
import { Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurarWebhook } from "../../../src/application/use-cases/configurar-webhook";
import { ConsultarHistorial } from "../../../src/application/use-cases/consultar-historial";
import { ConsultarNotificaciones } from "../../../src/application/use-cases/consultar-notificaciones";
import { ConsultarWebhook } from "../../../src/application/use-cases/consultar-webhook";
import { RegistrarEvento } from "../../../src/application/use-cases/registrar-evento";
import { RotarSecretoWebhook } from "../../../src/application/use-cases/rotar-secreto-webhook";
import { crearApp } from "../../../src/infrastructure/http/app";
import {
  GuiaRepositoryEnMemoria,
  UnidadDeTrabajoEnMemoria,
} from "../../support/guias-en-memoria";
import { GeneradorSecretosFalso } from "../../support/generador-secretos-falso";
import { NotificacionRepositoryEnMemoria } from "../../support/notificaciones-en-memoria";
import { RegistradorEnMemoria } from "../../support/registrador-en-memoria";
import { RelojFijo } from "../../support/reloj-fijo";
import { WebhookConfigRepositoryEnMemoria } from "../../support/webhooks-en-memoria";

// Datos ficticios.
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const EVENTO_1 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const EVENTO_2 = "0b2f8d5e-3c1a-4f6b-9a7d-1e2f3a4b5c6d";
const EVENTO_3 = "d2719a3c-8f4e-4b1a-8c6d-5e7f9a0b1c2d";

/** Cuerpo de evento válido; `minuto` desplaza la fecha. */
function cuerpo(eventId: string, estado: string, minuto: number, extra: object = {}) {
  const fecha = new Date(Date.UTC(2026, 9, 24, 10, minuto)).toISOString();
  return { eventId, estado, fechaEvento: fecha, ...extra };
}

describe("API HTTP", () => {
  let app: ReturnType<typeof crearApp>;
  let comprobarSalud: Mock<() => Promise<void>>;
  let registrador: RegistradorEnMemoria;

  // Cada prueba arranca con una aplicación y un repositorio vacíos.
  beforeEach(() => {
    const guias = new GuiaRepositoryEnMemoria();
    const webhooks = new WebhookConfigRepositoryEnMemoria();
    const generadorSecretos = new GeneradorSecretosFalso();
    const notificaciones = new NotificacionRepositoryEnMemoria();
    comprobarSalud = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    registrador = new RegistradorEnMemoria();
    app = crearApp({
      registrarEvento: new RegistrarEvento(
        new UnidadDeTrabajoEnMemoria({ guias, notificaciones }),
        new RelojFijo(),
        registrador,
      ),
      consultarHistorial: new ConsultarHistorial(guias),
      consultarNotificaciones: new ConsultarNotificaciones(notificaciones),
      configurarWebhook: new ConfigurarWebhook(webhooks, generadorSecretos),
      consultarWebhook: new ConsultarWebhook(webhooks),
      rotarSecretoWebhook: new RotarSecretoWebhook(webhooks, generadorSecretos),
      comprobarSalud,
      registrador,
    });
  });

  /** Registra un evento como un cliente. */
  const registrar = (tenant: string | null, guia: string, body: unknown) => {
    const peticion = request(app).post(`/guias/${guia}/eventos`);
    if (tenant) peticion.set("X-Tenant-Id", tenant);
    return peticion.send(body as object);
  };

  describe("POST /guias/:guiaId/eventos", () => {
    it("responde 201 al registrar un evento nuevo", async () => {
      const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        eventId: EVENTO_1,
        guiaId: "GUIA-001",
        estadoActual: "CREADA",
        duplicado: false,
      });
    });

    describe("eventId en mayúsculas o minúsculas", () => {
      // Un UUID es el mismo valor escrito en mayúsculas o en minúsculas.
      const EVENTO_1_MAYUSCULAS = EVENTO_1.toUpperCase();

      it("el mismo UUID en mayúsculas se reconoce como el mismo evento (duplicado)", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1_MAYUSCULAS, "CREADA", 0));

        expect(res.status).toBe(200);
        expect(res.body.duplicado).toBe(true);
      });

      it("también al revés: primero en mayúsculas y luego en minúsculas", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1_MAYUSCULAS, "CREADA", 0));

        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        expect(res.status).toBe(200);
        expect(res.body.duplicado).toBe(true);
      });

      it("el eventId se devuelve y se guarda siempre en minúsculas", async () => {
        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1_MAYUSCULAS, "CREADA", 0));

        expect(res.body.eventId).toBe(EVENTO_1);
        const historial = await request(app).get("/guias/GUIA-001").set("X-Tenant-Id", TENANT_A);
        expect(historial.body.eventos[0].eventId).toBe(EVENTO_1);
      });

      it("el repetido en mayúsculas no genera otra notificación", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1_MAYUSCULAS, "CREADA", 0));

        const res = await request(app).get("/notificaciones").set("X-Tenant-Id", TENANT_A);

        expect(res.body.notificaciones).toHaveLength(1);
      });

      it("mezclar mayúsculas y minúsculas dentro del mismo UUID también cuenta como el mismo", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
        const mezclado = EVENTO_1.slice(0, 10).toUpperCase() + EVENTO_1.slice(10);

        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(mezclado, "CREADA", 0));

        expect(res.body.duplicado).toBe(true);
      });
    });

    it("responde 200 con duplicado=true si el eventId ya se recibió", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      expect(res.status).toBe(200);
      expect(res.body.duplicado).toBe(true);
    });

    it("acepta la observación opcional", async () => {
      const res = await registrar(
        TENANT_A,
        "GUIA-001",
        cuerpo(EVENTO_1, "CREADA", 0, { observacion: "Recibido en bodega" }),
      );

      expect(res.status).toBe(201);
    });

    describe("errores de validación (400)", () => {
      it("sin cabecera X-Tenant-Id", async () => {
        const res = await registrar(null, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        expect(res.status).toBe(400);
        expect(res.body.error.codigo).toBe("PETICION_INVALIDA");
        expect(res.body.error.detalles[0].campo).toContain("X-Tenant-Id");
      });

      it("con un eventId que no es UUID", async () => {
        const res = await registrar(TENANT_A, "GUIA-001", cuerpo("no-es-uuid", "CREADA", 0));

        expect(res.status).toBe(400);
        expect(res.body.error.detalles[0].campo).toContain("eventId");
      });

      it("con un estado desconocido", async () => {
        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "PERDIDA", 0));

        expect(res.status).toBe(400);
        expect(res.body.error.detalles[0].campo).toContain("estado");
      });

      it("con una fecha que no es ISO 8601", async () => {
        const res = await registrar(TENANT_A, "GUIA-001", {
          ...cuerpo(EVENTO_1, "CREADA", 0),
          fechaEvento: "24/10/2026",
        });

        expect(res.status).toBe(400);
        expect(res.body.error.detalles[0].campo).toContain("fechaEvento");
      });

      it("con una fecha sin zona horaria", async () => {
        const res = await registrar(TENANT_A, "GUIA-001", {
          ...cuerpo(EVENTO_1, "CREADA", 0),
          fechaEvento: "2026-10-24T10:00:00",
        });

        expect(res.status).toBe(400);
      });

      it("con un guiaId de caracteres no permitidos", async () => {
        const res = await registrar(TENANT_A, "GUIA%20%3Cx%3E", cuerpo(EVENTO_1, "CREADA", 0));

        expect(res.status).toBe(400);
        expect(res.body.error.detalles[0].campo).toContain("guiaId");
      });

      it("con una observación demasiado larga", async () => {
        const res = await registrar(
          TENANT_A,
          "GUIA-001",
          cuerpo(EVENTO_1, "CREADA", 0, { observacion: "x".repeat(501) }),
        );

        expect(res.status).toBe(400);
      });

      it("con un cuerpo que no es JSON válido", async () => {
        const res = await request(app)
          .post("/guias/GUIA-001/eventos")
          .set("X-Tenant-Id", TENANT_A)
          .set("Content-Type", "application/json")
          .send("{esto no es json");

        expect(res.status).toBe(400);
        expect(res.body.error.codigo).toBe("JSON_INVALIDO");
      });

      it("sin cuerpo", async () => {
        const res = await request(app)
          .post("/guias/GUIA-001/eventos")
          .set("X-Tenant-Id", TENANT_A);

        expect(res.status).toBe(400);
      });
    });

    describe("errores de negocio", () => {
      it("422 si el primer evento no es CREADA", async () => {
        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "EN_RUTA", 0));

        expect(res.status).toBe(422);
        expect(res.body.error.codigo).toBe("PRIMER_EVENTO_INVALIDO");
      });

      it("409 ante una transición inválida", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_2, "ENTREGADA", 5));

        expect(res.status).toBe(409);
        expect(res.body.error.codigo).toBe("TRANSICION_INVALIDA");
      });

      it("409 si una guía ENTREGADA recibe otro cambio", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_2, "EN_RUTA", 5));
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_3, "ENTREGADA", 10));

        const res = await registrar(
          TENANT_A,
          "GUIA-001",
          cuerpo("a1b2c3d4-0000-4000-8000-000000000001", "DEVUELTA", 15),
        );

        expect(res.status).toBe(409);
      });

      it("409 si el eventId ya se usó en otra guía del mismo cliente", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        const res = await registrar(TENANT_A, "GUIA-002", cuerpo(EVENTO_1, "CREADA", 0));

        expect(res.status).toBe(409);
        expect(res.body.error.codigo).toBe("EVENT_ID_YA_USADO");
        // La otra guía no se creó.
        const consulta = await request(app).get("/guias/GUIA-002").set("X-Tenant-Id", TENANT_A);
        expect(consulta.status).toBe(404);
      });

      it("el eventId reutilizado tampoco genera un segundo aviso", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
        await registrar(TENANT_A, "GUIA-002", cuerpo(EVENTO_1, "CREADA", 0));

        const res = await request(app).get("/notificaciones").set("X-Tenant-Id", TENANT_A);

        expect(res.body.notificaciones).toHaveLength(1);
      });

      it("otro cliente puede usar el mismo eventId sin problema", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        const res = await registrar(TENANT_B, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        expect(res.status).toBe(201);
      });

      it("el eventId reutilizado en otra guía en mayúsculas también se rechaza", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

        const res = await registrar(TENANT_A, "GUIA-002", cuerpo(EVENTO_1.toUpperCase(), "CREADA", 0));

        expect(res.status).toBe(409);
      });

      it("409 si el evento llega fuera de orden", async () => {
        await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 10));

        const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_2, "EN_RUTA", 5));

        expect(res.status).toBe(409);
        expect(res.body.error.codigo).toBe("EVENTO_FUERA_DE_ORDEN");
      });
    });
  });

  describe("GET /guias/:guiaId", () => {
    it("devuelve el estado actual y los eventos en orden cronológico", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
      await registrar(
        TENANT_A,
        "GUIA-001",
        cuerpo(EVENTO_2, "EN_RUTA", 5, { observacion: "Salió de bodega" }),
      );

      const res = await request(app).get("/guias/GUIA-001").set("X-Tenant-Id", TENANT_A);

      expect(res.status).toBe(200);
      expect(res.body.guiaId).toBe("GUIA-001");
      expect(res.body.estadoActual).toBe("EN_RUTA");
      expect(res.body.eventos).toEqual([
        { eventId: EVENTO_1, estado: "CREADA", fechaEvento: "2026-10-24T10:00:00.000Z" },
        {
          eventId: EVENTO_2,
          estado: "EN_RUTA",
          fechaEvento: "2026-10-24T10:05:00.000Z",
          observacion: "Salió de bodega",
        },
      ]);
    });

    it("404 si la guía no existe", async () => {
      const res = await request(app).get("/guias/NO-EXISTE").set("X-Tenant-Id", TENANT_A);

      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("GUIA_NO_ENCONTRADA");
    });

    it("un tenant no ve las guías de otro tenant", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      const res = await request(app).get("/guias/GUIA-001").set("X-Tenant-Id", TENANT_B);

      // Mismo error que una guía inexistente: no se revela que existe en otro tenant.
      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("GUIA_NO_ENCONTRADA");
    });

    it("400 sin cabecera X-Tenant-Id", async () => {
      const res = await request(app).get("/guias/GUIA-001");

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /webhook y GET /webhook", () => {
    const URL_1 = "https://cliente-a.example/webhook";
    const URL_2 = "http://webhook:4000/hook";

    /** Configura el webhook de un tenant. */
    const configurar = (tenant: string | null, body: unknown) => {
      const peticion = request(app).put("/webhook");
      if (tenant) peticion.set("X-Tenant-Id", tenant);
      return peticion.send(body as object);
    };

    it("guarda la URL y responde 200", async () => {
      const res = await configurar(TENANT_A, { url: URL_1 });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe(URL_1);
    });

    it("la primera vez devuelve el secreto de firma", async () => {
      const res = await configurar(TENANT_A, { url: URL_1 });

      expect(res.body).toEqual({ url: URL_1, secreto: "secreto-1" });
    });

    it("las siguientes veces NO devuelve el secreto", async () => {
      await configurar(TENANT_A, { url: URL_1 });

      const res = await configurar(TENANT_A, { url: URL_2 });

      expect(res.body).toEqual({ url: URL_2 });
      expect(res.body).not.toHaveProperty("secreto");
    });

    it("cada tenant recibe su propio secreto", async () => {
      const a = await configurar(TENANT_A, { url: URL_1 });
      const b = await configurar(TENANT_B, { url: URL_1 });

      expect(a.body.secreto).not.toBe(b.body.secreto);
    });

    it("permite consultar la URL guardada", async () => {
      await configurar(TENANT_A, { url: URL_1 });

      const res = await request(app).get("/webhook").set("X-Tenant-Id", TENANT_A);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ url: URL_1 });
    });

    it("la consulta nunca muestra el secreto", async () => {
      await configurar(TENANT_A, { url: URL_1 });

      const res = await request(app).get("/webhook").set("X-Tenant-Id", TENANT_A);

      expect(JSON.stringify(res.body)).not.toContain("secreto");
    });

    it("acepta URLs http y https", async () => {
      expect((await configurar(TENANT_A, { url: URL_1 })).status).toBe(200);
      expect((await configurar(TENANT_A, { url: URL_2 })).status).toBe(200);
    });

    it("reemplaza la URL anterior", async () => {
      await configurar(TENANT_A, { url: URL_1 });
      await configurar(TENANT_A, { url: URL_2 });

      const res = await request(app).get("/webhook").set("X-Tenant-Id", TENANT_A);

      expect(res.body.url).toBe(URL_2);
    });

    it("404 si el tenant no configuró su webhook", async () => {
      const res = await request(app).get("/webhook").set("X-Tenant-Id", TENANT_A);

      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("WEBHOOK_NO_CONFIGURADO");
    });

    it("un tenant no ve el webhook de otro", async () => {
      await configurar(TENANT_A, { url: URL_1 });

      const res = await request(app).get("/webhook").set("X-Tenant-Id", TENANT_B);

      expect(res.status).toBe(404);
    });

    it.each([
      ["una URL sin protocolo", { url: "cliente.example/webhook" }],
      ["un protocolo no permitido", { url: "ftp://cliente.example/webhook" }],
      ["un esquema peligroso", { url: "javascript:alert(1)" }],
      ["un texto que no es URL", { url: "no-es-una-url" }],
      ["una URL demasiado larga", { url: "https://cliente.example/" + "a".repeat(2050) }],
      ["sin el campo url", {}],
      ["una url que no es texto", { url: 123 }],
    ])("400 con %s", async (_descripcion, cuerpoInvalido) => {
      const res = await configurar(TENANT_A, cuerpoInvalido);

      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("PETICION_INVALIDA");
    });

    it("400 sin cabecera X-Tenant-Id", async () => {
      expect((await configurar(null, { url: URL_1 })).status).toBe(400);
      expect((await request(app).get("/webhook")).status).toBe(400);
    });
  });

  describe("GET /notificaciones", () => {
    /** Consulta las notificaciones de un tenant, con query string opcional. */
    const listar = (tenant: string | null, query = "") => {
      const peticion = request(app).get(`/notificaciones${query}`);
      if (tenant) peticion.set("X-Tenant-Id", tenant);
      return peticion;
    };

    it("lista una notificación pendiente por cada evento aceptado", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_2, "EN_RUTA", 5));

      const res = await listar(TENANT_A);

      expect(res.status).toBe(200);
      expect(res.body.notificaciones).toHaveLength(2);
      // La más reciente primero.
      expect(res.body.notificaciones[0]).toMatchObject({
        guiaId: "GUIA-001",
        eventId: EVENTO_2,
        estadoGuia: "EN_RUTA",
        estado: "PENDIENTE",
        intentos: 0,
        ultimoError: null,
        ultimoCodigoHttp: null,
      });
    });

    it("un evento duplicado no agrega otra notificación", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      const res = await listar(TENANT_A);

      expect(res.body.notificaciones).toHaveLength(1);
    });

    it("un evento rechazado no genera notificación", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "EN_RUTA", 0)); // 422

      const res = await listar(TENANT_A);

      expect(res.body.notificaciones).toEqual([]);
    });

    it("filtra por estado", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      expect((await listar(TENANT_A, "?estado=PENDIENTE")).body.notificaciones).toHaveLength(1);
      expect((await listar(TENANT_A, "?estado=FALLIDA")).body.notificaciones).toEqual([]);
    });

    it("respeta el límite", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_2, "EN_RUTA", 5));

      const res = await listar(TENANT_A, "?limite=1");

      expect(res.body.notificaciones).toHaveLength(1);
    });

    it("un tenant no ve las notificaciones de otro", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      const res = await listar(TENANT_B);

      expect(res.status).toBe(200);
      expect(res.body.notificaciones).toEqual([]);
    });

    it.each([
      ["un estado desconocido", "?estado=PERDIDA"],
      ["un límite que no es número", "?limite=abc"],
      ["un límite menor que 1", "?limite=0"],
      ["un límite mayor que 200", "?limite=201"],
    ])("400 con %s", async (_descripcion, query) => {
      const res = await listar(TENANT_A, query);

      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe("PETICION_INVALIDA");
    });

    it("400 sin cabecera X-Tenant-Id", async () => {
      expect((await listar(null)).status).toBe(400);
    });
  });

  describe("POST /webhook/secreto", () => {
    const URL_1 = "https://cliente-a.example/webhook";

    /** Rota el secreto de un tenant. */
    const rotar = (tenant: string | null) => {
      const peticion = request(app).post("/webhook/secreto");
      if (tenant) peticion.set("X-Tenant-Id", tenant);
      return peticion;
    };

    it("genera un secreto nuevo, distinto del anterior, y lo devuelve", async () => {
      const inicial = await request(app)
        .put("/webhook")
        .set("X-Tenant-Id", TENANT_A)
        .send({ url: URL_1 });

      const res = await rotar(TENANT_A);

      expect(res.status).toBe(200);
      expect(res.body.secreto).toBeTypeOf("string");
      expect(res.body.secreto).not.toBe(inicial.body.secreto);
    });

    it("cada rotación da un secreto distinto", async () => {
      await request(app).put("/webhook").set("X-Tenant-Id", TENANT_A).send({ url: URL_1 });

      const primera = await rotar(TENANT_A);
      const segunda = await rotar(TENANT_A);

      expect(primera.body.secreto).not.toBe(segunda.body.secreto);
    });

    it("404 si el tenant no configuró su webhook", async () => {
      const res = await rotar(TENANT_A);

      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("WEBHOOK_NO_CONFIGURADO");
    });

    it("400 sin cabecera X-Tenant-Id", async () => {
      expect((await rotar(null)).status).toBe(400);
    });
  });

  describe("logs de las peticiones", () => {
    /** Líneas de log de peticiones (excluye las de los casos de uso). */
    const deAcceso = () =>
      registrador.entradas.filter(
        (e) =>
          e.mensaje === "petición atendida" ||
          e.mensaje === "petición rechazada" ||
          e.mensaje === "petición con error del servidor",
      );

    it("registra una línea por petición con método, ruta, código, duración, tenant y guía", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      const [linea] = deAcceso();
      expect(linea?.nivel).toBe("info");
      expect(linea?.datos).toMatchObject({
        metodo: "POST",
        // Se registra el patrón de la ruta, no la dirección real.
        ruta: "/guias/:guiaId/eventos",
        status: 201,
        tenantId: TENANT_A,
        guiaId: "GUIA-001",
      });
      expect(linea?.datos["duracionMs"]).toBeTypeOf("number");
      expect(deAcceso()).toHaveLength(1);
    });

    it("devuelve X-Request-Id y es el mismo identificador que queda en el log", async () => {
      const res = await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));

      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(deAcceso()[0]?.datos["requestId"]).toBe(res.headers["x-request-id"]);
    });

    it("cada petición recibe un identificador distinto", async () => {
      const a = await request(app).get("/health");
      const b = await request(app).get("/health");

      expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
    });

    it("conserva el X-Request-Id que envía quien llama si tiene un formato seguro", async () => {
      const res = await request(app).get("/health").set("X-Request-Id", "mi-traza-12345");

      expect(res.headers["x-request-id"]).toBe("mi-traza-12345");
    });

    it("reemplaza un X-Request-Id con formato inseguro", async () => {
      const res = await request(app).get("/health").set("X-Request-Id", "texto con espacios y llaves");

      expect(res.headers["x-request-id"]).not.toContain("espacios");
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("una petición rechazada por reglas de negocio se registra como warn con su código de error", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0));
      registrador.entradas.length = 0;

      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_2, "ENTREGADA", 5)); // 409

      const [linea] = deAcceso();
      expect(linea?.nivel).toBe("warn");
      expect(linea?.datos).toMatchObject({ status: 409, errorCodigo: "TRANSICION_INVALIDA" });
    });

    it("una validación fallida se registra como warn con código 400", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo("no-es-uuid", "CREADA", 0));

      expect(deAcceso()[0]).toMatchObject({
        nivel: "warn",
        datos: { status: 400, errorCodigo: "PETICION_INVALIDA" },
      });
    });

    it("un error del servidor se registra como error", async () => {
      comprobarSalud.mockRejectedValue(new Error("sin conexión"));

      await request(app).get("/health");

      expect(deAcceso()[0]).toMatchObject({ nivel: "error", datos: { status: 503 } });
    });

    it("el health check correcto solo se registra al depurar", async () => {
      await request(app).get("/health");

      expect(deAcceso()[0]?.nivel).toBe("debug");
    });

    it("no registra la dirección pedida cuando la ruta no existe", async () => {
      await request(app).get("/dato-raro-que-no-debe-salir-123");

      expect(deAcceso()[0]?.datos["ruta"]).toBe("(sin ruta)");
      expect(registrador.comoTexto()).not.toContain("dato-raro-que-no-debe-salir-123");
    });

    it("no registra el tenant si no pasó la validación", async () => {
      await request(app).get("/guias/GUIA-001").set("X-Tenant-Id", "tenant invalido!");

      expect(deAcceso()[0]?.datos["tenantId"]).toBeUndefined();
      expect(registrador.comoTexto()).not.toContain("tenant invalido");
    });

    it("registra también las peticiones con JSON inválido", async () => {
      await request(app)
        .post("/guias/GUIA-001/eventos")
        .set("X-Tenant-Id", TENANT_A)
        .set("Content-Type", "application/json")
        .send("{esto no es json");

      expect(deAcceso()[0]?.datos).toMatchObject({ status: 400, errorCodigo: "JSON_INVALIDO" });
    });
  });

  describe("los logs no filtran datos sensibles", () => {
    it("no contienen observaciones, secretos ni URLs de webhook en ningún flujo", async () => {
      // Se recorre un flujo completo con datos que NO deben aparecer en los logs.
      const observacion = { observacion: "Entregar a Juan Perez, cedula 98765" };
      const put = await request(app)
        .put("/webhook")
        .set("X-Tenant-Id", TENANT_A)
        .send({ url: "https://cliente-privado.example/token-que-no-debe-salir" });
      await request(app).post("/webhook/secreto").set("X-Tenant-Id", TENANT_A);
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0, observacion));
      // El mismo evento otra vez: es un duplicado.
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0, observacion));
      await request(app).get("/guias/GUIA-001").set("X-Tenant-Id", TENANT_A);
      await request(app).get("/webhook").set("X-Tenant-Id", TENANT_A);

      const todo = registrador.comoTexto();
      expect(put.body.secreto).toBeTruthy();
      expect(todo).not.toContain(put.body.secreto as string);
      expect(todo).not.toContain("Juan Perez");
      expect(todo).not.toContain("98765");
      expect(todo).not.toContain("cliente-privado");
      expect(todo).not.toContain("token-que-no-debe-salir");
    });

    it("registra el evento aceptado solo con identificadores y estado", async () => {
      await registrar(TENANT_A, "GUIA-001", cuerpo(EVENTO_1, "CREADA", 0, { observacion: "texto libre" }));

      const [linea] = registrador.con("evento registrado");
      expect(linea?.datos).toEqual({
        tenantId: TENANT_A,
        guiaId: "GUIA-001",
        eventId: EVENTO_1,
        estado: "CREADA",
      });
    });
  });

  describe("GET /health", () => {
    it("responde 200 si la base responde", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ estado: "ok" });
    });

    it("responde 503 si la base no responde y registra el error", async () => {
      comprobarSalud.mockRejectedValue(new Error("sin conexión"));

      const res = await request(app).get("/health");

      expect(res.status).toBe(503);
      expect(registrador.con("falló la comprobación de salud")).toHaveLength(1);
    });
  });

  describe("errores generales", () => {
    it("404 con el formato de error único en rutas desconocidas", async () => {
      const res = await request(app).get("/no-existe");

      expect(res.status).toBe(404);
      expect(res.body.error.codigo).toBe("RUTA_NO_ENCONTRADA");
    });

    it("500 genérico, sin filtrar detalles, ante un error inesperado", async () => {
      // Se simula un fallo interno en el caso de uso.
      const appRota = crearApp({
        registrarEvento: { ejecutar: vi.fn().mockRejectedValue(new Error("password=secreta")) },
        consultarHistorial: { ejecutar: vi.fn() },
        consultarNotificaciones: { ejecutar: vi.fn() },
        configurarWebhook: { ejecutar: vi.fn() },
        rotarSecretoWebhook: { ejecutar: vi.fn() },
        consultarWebhook: { ejecutar: vi.fn() },
        comprobarSalud,
        registrador,
      });

      const res = await request(appRota)
        .post("/guias/GUIA-001/eventos")
        .set("X-Tenant-Id", TENANT_A)
        .send(cuerpo(EVENTO_1, "CREADA", 0));

      expect(res.status).toBe(500);
      expect(res.body.error.codigo).toBe("ERROR_INTERNO");
      expect(JSON.stringify(res.body)).not.toContain("secreta");
      // El error real queda en el log, con el identificador que también recibió el cliente.
      const [registro] = registrador.con("error inesperado al atender la petición");
      expect(registro?.error).toEqual(new Error("password=secreta"));
      expect(registro?.datos["requestId"]).toBe(res.headers["x-request-id"]);
    });
  });
});
