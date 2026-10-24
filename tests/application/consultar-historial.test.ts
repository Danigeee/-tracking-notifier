// Pruebas del caso de uso ConsultarHistorial con repositorio en memoria.

import { beforeEach, describe, expect, it } from "vitest";
import { GuiaNoEncontradaError } from "../../src/application/errores";
import { ConsultarHistorial } from "../../src/application/use-cases/consultar-historial";
import { EventoGuia } from "../../src/domain/evento-guia";
import { Guia } from "../../src/domain/guia";
import { GuiaRepositoryEnMemoria } from "../support/guias-en-memoria";

// Datos ficticios.
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const GUIA = "GUIA-001";

function evento(eventId: string, estado: EventoGuia["estado"], minuto: number): EventoGuia {
  return { eventId, estado, fechaEvento: new Date(Date.UTC(2026, 9, 24, 10, minuto)) };
}

describe("ConsultarHistorial", () => {
  let guias: GuiaRepositoryEnMemoria;
  let consultarHistorial: ConsultarHistorial;

  // Cada prueba arranca con la guía GUIA-001 del tenant A, ya EN_RUTA.
  beforeEach(async () => {
    guias = new GuiaRepositoryEnMemoria();
    consultarHistorial = new ConsultarHistorial(guias);
    await guias.guardar(
      Guia.reconstruir(GUIA, TENANT_A, [evento("e1", "CREADA", 0), evento("e2", "EN_RUTA", 5)]),
    );
  });

  it("devuelve el estado actual y los eventos en orden cronológico", async () => {
    const historial = await consultarHistorial.ejecutar({ tenantId: TENANT_A, guiaId: GUIA });

    expect(historial.guiaId).toBe(GUIA);
    expect(historial.estadoActual).toBe("EN_RUTA");
    expect(historial.eventos.map((e) => e.eventId)).toEqual(["e1", "e2"]);
  });

  it("falla con GuiaNoEncontradaError si la guía no existe", async () => {
    await expect(
      consultarHistorial.ejecutar({ tenantId: TENANT_A, guiaId: "NO-EXISTE" }),
    ).rejects.toThrow(GuiaNoEncontradaError);
  });

  it("un tenant no puede ver la guía de otro tenant", async () => {
    await expect(
      consultarHistorial.ejecutar({ tenantId: TENANT_B, guiaId: GUIA }),
    ).rejects.toThrow(GuiaNoEncontradaError);
  });
});
