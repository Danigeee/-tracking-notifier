// Pruebas de la API HTTP con Supertest.
// Usan los casos de uso reales con repositorios en memoria: así se comprueba
// la validación, los códigos HTTP y el formato de error sin necesitar base de datos.

import request from "supertest";
import { Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsultarHistorial } from "../../../src/application/use-cases/consultar-historial";
import { RegistrarEvento } from "../../../src/application/use-cases/registrar-evento";
import { crearApp } from "../../../src/infrastructure/http/app";
import {
  GuiaRepositoryEnMemoria,
  UnidadDeTrabajoEnMemoria,
} from "../../support/guias-en-memoria";

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
  let registrarError: Mock<(error: unknown) => void>;

  // Cada prueba arranca con una aplicación y un repositorio vacíos.
  beforeEach(() => {
    const guias = new GuiaRepositoryEnMemoria();
    comprobarSalud = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    registrarError = vi.fn<(error: unknown) => void>();
    app = crearApp({
      registrarEvento: new RegistrarEvento(new UnidadDeTrabajoEnMemoria({ guias })),
      consultarHistorial: new ConsultarHistorial(guias),
      comprobarSalud,
      registrarError,
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
      expect(registrarError).toHaveBeenCalledTimes(1);
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
        comprobarSalud,
        registrarError,
      });

      const res = await request(appRota)
        .post("/guias/GUIA-001/eventos")
        .set("X-Tenant-Id", TENANT_A)
        .send(cuerpo(EVENTO_1, "CREADA", 0));

      expect(res.status).toBe(500);
      expect(res.body.error.codigo).toBe("ERROR_INTERNO");
      expect(JSON.stringify(res.body)).not.toContain("secreta");
      expect(registrarError).toHaveBeenCalledTimes(1);
    });
  });
});
