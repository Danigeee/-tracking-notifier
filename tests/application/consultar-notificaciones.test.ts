// Pruebas del caso de uso ConsultarNotificaciones con repositorio en memoria.

import { beforeEach, describe, expect, it } from "vitest";
import { ConsultarNotificaciones } from "../../src/application/use-cases/consultar-notificaciones";
import { EstadoNotificacion, Notificacion } from "../../src/domain/notificacion";
import { NotificacionRepositoryEnMemoria } from "../support/notificaciones-en-memoria";

// Datos ficticios.
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const AHORA = new Date("2026-10-24T12:00:00.000Z");

/** Crea una notificación en el estado indicado, para poblar el repositorio. */
function notificacion(tenantId: string, eventId: string, estado: EstadoNotificacion): Notificacion {
  return Notificacion.reconstruir({
    tenantId,
    guiaId: "GUIA-001",
    evento: { eventId, estado: "CREADA", fechaEvento: AHORA },
    estado,
    intentos: estado === "FALLIDA" ? 5 : 0,
    proximoIntento: AHORA,
    ultimoError: estado === "FALLIDA" ? "tiempo de espera agotado" : null,
    ultimoCodigoHttp: null,
    creadaEn: AHORA,
  });
}

describe("ConsultarNotificaciones", () => {
  let repositorio: NotificacionRepositoryEnMemoria;
  let consultar: ConsultarNotificaciones;

  // Cada prueba parte de: A tiene una pendiente, una enviada y dos fallidas; B tiene una fallida.
  beforeEach(async () => {
    repositorio = new NotificacionRepositoryEnMemoria();
    consultar = new ConsultarNotificaciones(repositorio);
    await repositorio.crear(notificacion(TENANT_A, "a1", "PENDIENTE"));
    await repositorio.crear(notificacion(TENANT_A, "a2", "ENVIADA"));
    await repositorio.crear(notificacion(TENANT_A, "a3", "FALLIDA"));
    await repositorio.crear(notificacion(TENANT_A, "a4", "FALLIDA"));
    await repositorio.crear(notificacion(TENANT_B, "b1", "FALLIDA"));
  });

  it("sin filtro devuelve todas las del tenant, la más reciente primero", async () => {
    const resultado = await consultar.ejecutar({ tenantId: TENANT_A, limite: 50 });

    expect(resultado.map((n) => n.eventId)).toEqual(["a4", "a3", "a2", "a1"]);
  });

  it("filtra por estado FALLIDA", async () => {
    const resultado = await consultar.ejecutar({
      tenantId: TENANT_A,
      estado: "FALLIDA",
      limite: 50,
    });

    expect(resultado.map((n) => n.eventId)).toEqual(["a4", "a3"]);
  });

  it("no devuelve nunca las notificaciones de otro tenant", async () => {
    const resultado = await consultar.ejecutar({
      tenantId: TENANT_B,
      estado: "FALLIDA",
      limite: 50,
    });

    expect(resultado.map((n) => n.eventId)).toEqual(["b1"]);
  });

  it("respeta el límite de resultados", async () => {
    const resultado = await consultar.ejecutar({ tenantId: TENANT_A, limite: 2 });

    expect(resultado).toHaveLength(2);
  });

  it("devuelve una lista vacía si el tenant no tiene notificaciones", async () => {
    const resultado = await consultar.ejecutar({ tenantId: "sin-datos", limite: 50 });

    expect(resultado).toEqual([]);
  });
});
