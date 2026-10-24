// Pruebas unitarias de la entidad Notificación.

import { describe, expect, it } from "vitest";
import { EventoGuia } from "../../src/domain/evento-guia";
import { ESTADOS_NOTIFICACION, Notificacion } from "../../src/domain/notificacion";

const AHORA = new Date("2026-10-24T12:00:00.000Z");
const EVENTO: EventoGuia = {
  eventId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  estado: "CREADA",
  fechaEvento: new Date("2026-10-24T10:00:00.000Z"),
  observacion: "Recibida",
};

describe("Notificacion.crear", () => {
  it("nace pendiente, sin intentos y lista para enviarse de inmediato", () => {
    const n = Notificacion.crear("tenant-a", "GUIA-001", EVENTO, AHORA);

    expect(n.estado).toBe("PENDIENTE");
    expect(n.intentos).toBe(0);
    expect(n.proximoIntento).toEqual(AHORA);
    expect(n.creadaEn).toEqual(AHORA);
    expect(n.ultimoError).toBeNull();
    expect(n.ultimoCodigoHttp).toBeNull();
  });

  it("conserva el tenant, la guía y el evento a notificar", () => {
    const n = Notificacion.crear("tenant-a", "GUIA-001", EVENTO, AHORA);

    expect(n.tenantId).toBe("tenant-a");
    expect(n.guiaId).toBe("GUIA-001");
    expect(n.evento).toBe(EVENTO);
    expect(n.eventId).toBe(EVENTO.eventId);
  });
});

describe("estados de notificación", () => {
  it("son PENDIENTE, ENVIADA y FALLIDA", () => {
    expect([...ESTADOS_NOTIFICACION]).toEqual(["PENDIENTE", "ENVIADA", "FALLIDA"]);
  });
});
