// Pruebas unitarias de la entidad Notificación y su política de reintentos.

import { describe, expect, it } from "vitest";
import { EventoGuia } from "../../src/domain/evento-guia";
import {
  ESTADOS_NOTIFICACION,
  Notificacion,
  NotificacionNoPendienteError,
} from "../../src/domain/notificacion";
import { POLITICA_REINTENTOS_POR_DEFECTO } from "../../src/domain/politica-reintentos";

const AHORA = new Date("2026-10-24T12:00:00.000Z");
const EVENTO: EventoGuia = {
  eventId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  estado: "CREADA",
  fechaEvento: new Date("2026-10-24T10:00:00.000Z"),
  observacion: "Recibida",
};
const POLITICA = POLITICA_REINTENTOS_POR_DEFECTO;

/** Notificación recién creada. */
const nueva = () => Notificacion.crear("tenant-a", "GUIA-001", EVENTO, AHORA);

/** Segundos de diferencia entre dos fechas. */
const segundosEntre = (desde: Date, hasta: Date) => (hasta.getTime() - desde.getTime()) / 1000;

describe("Notificacion.crear", () => {
  it("nace pendiente, sin intentos y lista para enviarse de inmediato", () => {
    const n = nueva();

    expect(n.estado).toBe("PENDIENTE");
    expect(n.intentos).toBe(0);
    expect(n.proximoIntento).toEqual(AHORA);
    expect(n.creadaEn).toEqual(AHORA);
    expect(n.ultimoError).toBeNull();
    expect(n.ultimoCodigoHttp).toBeNull();
  });

  it("conserva el tenant, la guía y el evento a notificar", () => {
    const n = nueva();

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

describe("política por defecto", () => {
  it("son 5 intentos en total con esperas de 10 s, 1 min, 5 min y 30 min", () => {
    expect(POLITICA.maxIntentos).toBe(5);
    expect(POLITICA.esperasSegundos).toEqual([10, 60, 300, 1800]);
  });
});

describe("Notificacion.registrarEnvio", () => {
  it("pasa a ENVIADA, cuenta el intento y guarda el código de respuesta", () => {
    const enviada = nueva().registrarEnvio(200);

    expect(enviada.estado).toBe("ENVIADA");
    expect(enviada.intentos).toBe(1);
    expect(enviada.ultimoCodigoHttp).toBe(200);
    expect(enviada.ultimoError).toBeNull();
  });

  it("limpia el error de un intento fallido anterior", () => {
    const fallida = nueva().registrarFallo(AHORA, "error de conexión", null, POLITICA);

    const enviada = fallida.registrarEnvio(204);

    expect(enviada.estado).toBe("ENVIADA");
    expect(enviada.intentos).toBe(2);
    expect(enviada.ultimoError).toBeNull();
  });

  it("no modifica la notificación original", () => {
    const original = nueva();

    original.registrarEnvio(200);

    expect(original.estado).toBe("PENDIENTE");
    expect(original.intentos).toBe(0);
  });
});

describe("Notificacion.registrarFallo", () => {
  it("el primer fallo la deja PENDIENTE y reprograma 10 segundos después", () => {
    const fallo = nueva().registrarFallo(AHORA, "tiempo de espera agotado", null, POLITICA);

    expect(fallo.estado).toBe("PENDIENTE");
    expect(fallo.intentos).toBe(1);
    expect(segundosEntre(AHORA, fallo.proximoIntento)).toBe(10);
    expect(fallo.ultimoError).toBe("tiempo de espera agotado");
    expect(fallo.ultimoCodigoHttp).toBeNull();
  });

  it("guarda el código HTTP cuando el cliente respondió con error", () => {
    const fallo = nueva().registrarFallo(AHORA, "el webhook respondió 500", 500, POLITICA);

    expect(fallo.ultimoCodigoHttp).toBe(500);
  });

  it("la espera crece en cada intento: 10 s, 1 min, 5 min y 30 min", () => {
    let n = nueva();
    const esperas: number[] = [];

    // Los 4 primeros fallos dejan la notificación pendiente.
    for (let i = 0; i < 4; i++) {
      n = n.registrarFallo(AHORA, "fallo", 500, POLITICA);
      expect(n.estado).toBe("PENDIENTE");
      esperas.push(segundosEntre(AHORA, n.proximoIntento));
    }

    expect(esperas).toEqual([10, 60, 300, 1800]);
  });

  it("el quinto fallo la deja FALLIDA", () => {
    let n = nueva();
    for (let i = 0; i < 5; i++) {
      n = n.registrarFallo(AHORA, "fallo", 500, POLITICA);
    }

    expect(n.estado).toBe("FALLIDA");
    expect(n.intentos).toBe(5);
    expect(n.ultimoError).toBe("fallo");
  });

  it("puede tener éxito en un reintento antes de agotar los intentos", () => {
    const n = nueva()
      .registrarFallo(AHORA, "fallo", 500, POLITICA)
      .registrarFallo(AHORA, "fallo", 500, POLITICA)
      .registrarEnvio(200);

    expect(n.estado).toBe("ENVIADA");
    expect(n.intentos).toBe(3);
  });

  it("repite la última espera si la política tiene menos esperas que intentos", () => {
    const politicaCorta = { maxIntentos: 4, esperasSegundos: [5] };
    let n = nueva();

    n = n.registrarFallo(AHORA, "fallo", 500, politicaCorta);
    n = n.registrarFallo(AHORA, "fallo", 500, politicaCorta);

    expect(segundosEntre(AHORA, n.proximoIntento)).toBe(5);
  });

  it("no modifica la notificación original", () => {
    const original = nueva();

    original.registrarFallo(AHORA, "fallo", 500, POLITICA);

    expect(original.intentos).toBe(0);
    expect(original.ultimoError).toBeNull();
  });
});

describe("notificaciones que ya no están pendientes", () => {
  it("una ENVIADA no admite más resultados", () => {
    const enviada = nueva().registrarEnvio(200);

    expect(() => enviada.registrarEnvio(200)).toThrow(NotificacionNoPendienteError);
    expect(() => enviada.registrarFallo(AHORA, "fallo", 500, POLITICA)).toThrow(
      NotificacionNoPendienteError,
    );
  });

  it("una FALLIDA no admite más resultados", () => {
    let n = nueva();
    for (let i = 0; i < 5; i++) {
      n = n.registrarFallo(AHORA, "fallo", 500, POLITICA);
    }

    expect(() => n.registrarEnvio(200)).toThrow(NotificacionNoPendienteError);
  });
});
