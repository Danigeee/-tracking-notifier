// Pruebas unitarias de la entidad Guía.
// Verifican las reglas de negocio sin base de datos ni servidor.

import { describe, expect, it } from "vitest";
import {
  EventoFueraDeOrdenError,
  PrimerEventoInvalidoError,
  TransicionInvalidaError,
} from "../../src/domain/errores";
import { EstadoGuia } from "../../src/domain/estado-guia";
import { EventoGuia } from "../../src/domain/evento-guia";
import { Guia } from "../../src/domain/guia";

// Datos ficticios usados en todas las pruebas.
const GUIA_ID = "GUIA-001";
const TENANT_ID = "tenant-a";

/** Construye un evento de prueba; `minuto` desplaza la fecha para ordenarlos fácilmente. */
function evento(eventId: string, estado: EstadoGuia, minuto: number, observacion?: string): EventoGuia {
  return {
    eventId,
    estado,
    fechaEvento: new Date(Date.UTC(2026, 9, 24, 10, minuto)),
    observacion,
  };
}

/** Guía recién creada con un evento CREADA a las 10:00. */
function guiaCreada(): Guia {
  return Guia.iniciar(GUIA_ID, TENANT_ID, evento("e1", "CREADA", 0));
}

describe("Guia.iniciar", () => {
  it("crea una guía en estado CREADA con su primer evento", () => {
    const guia = guiaCreada();

    expect(guia.id).toBe(GUIA_ID);
    expect(guia.tenantId).toBe(TENANT_ID);
    expect(guia.estadoActual).toBe("CREADA");
    expect(guia.eventos).toHaveLength(1);
  });

  it.each(["EN_RUTA", "ENTREGADA", "DEVUELTA"] as const)(
    "rechaza que el primer evento sea %s",
    (estado) => {
      expect(() => Guia.iniciar(GUIA_ID, TENANT_ID, evento("e1", estado, 0))).toThrow(
        PrimerEventoInvalidoError,
      );
    },
  );
});

describe("Guia.registrarEvento", () => {
  it("registra un evento válido y actualiza el estado actual", () => {
    const guia = guiaCreada();

    const resultado = guia.registrarEvento(evento("e2", "EN_RUTA", 5));

    expect(resultado).toBe("REGISTRADO");
    expect(guia.estadoActual).toBe("EN_RUTA");
    expect(guia.eventos.map((e) => e.eventId)).toEqual(["e1", "e2"]);
  });

  it("recorre el camino completo hasta ENTREGADA", () => {
    const guia = guiaCreada();

    guia.registrarEvento(evento("e2", "EN_RUTA", 5));
    guia.registrarEvento(evento("e3", "ENTREGADA", 10));

    expect(guia.estadoActual).toBe("ENTREGADA");
  });

  it("conserva la observación del evento", () => {
    const guia = guiaCreada();

    guia.registrarEvento(evento("e2", "EN_RUTA", 5, "Salió de la bodega"));

    expect(guia.eventos[1]?.observacion).toBe("Salió de la bodega");
  });

  describe("idempotencia", () => {
    it("ignora un eventId repetido y no duplica el historial", () => {
      const guia = guiaCreada();
      guia.registrarEvento(evento("e2", "EN_RUTA", 5));

      const resultado = guia.registrarEvento(evento("e2", "EN_RUTA", 5));

      expect(resultado).toBe("DUPLICADO");
      expect(guia.eventos).toHaveLength(2);
    });

    it("trata como duplicado un eventId repetido aunque el estado actual ya no permita ese evento", () => {
      // Caso real: el emisor reintenta el evento e2 después de que la guía avanzó.
      // Debe responder "duplicado" y no un error de transición.
      const guia = guiaCreada();
      guia.registrarEvento(evento("e2", "EN_RUTA", 5));
      guia.registrarEvento(evento("e3", "ENTREGADA", 10));

      expect(guia.registrarEvento(evento("e2", "EN_RUTA", 5))).toBe("DUPLICADO");
      expect(guia.estadoActual).toBe("ENTREGADA");
    });
  });

  describe("transiciones", () => {
    it("rechaza saltar de CREADA a ENTREGADA", () => {
      const guia = guiaCreada();

      expect(() => guia.registrarEvento(evento("e2", "ENTREGADA", 5))).toThrow(
        TransicionInvalidaError,
      );
      // El rechazo no deja rastro en el historial.
      expect(guia.eventos).toHaveLength(1);
    });

    it("rechaza repetir el mismo estado con otro eventId", () => {
      const guia = guiaCreada();
      guia.registrarEvento(evento("e2", "EN_RUTA", 5));

      expect(() => guia.registrarEvento(evento("e3", "EN_RUTA", 6))).toThrow(
        TransicionInvalidaError,
      );
    });

    it.each(["ENTREGADA", "DEVUELTA"] as const)("una guía %s ya no cambia de estado", (final) => {
      const guia = guiaCreada();
      guia.registrarEvento(evento("e2", "EN_RUTA", 5));
      guia.registrarEvento(evento("e3", final, 10));

      expect(() => guia.registrarEvento(evento("e4", "EN_RUTA", 15))).toThrow(
        TransicionInvalidaError,
      );
      expect(guia.estadoActual).toBe(final);
    });

    it("permite devolver una guía recién creada", () => {
      const guia = guiaCreada();

      guia.registrarEvento(evento("e2", "DEVUELTA", 5));

      expect(guia.estadoActual).toBe("DEVUELTA");
    });
  });

  describe("orden cronológico", () => {
    it("rechaza un evento con fecha anterior al último", () => {
      const guia = guiaCreada();
      guia.registrarEvento(evento("e2", "EN_RUTA", 10));

      // El evento ENTREGADA lleva fecha de las 10:05, anterior al EN_RUTA de las 10:10.
      expect(() => guia.registrarEvento(evento("e3", "ENTREGADA", 5))).toThrow(
        EventoFueraDeOrdenError,
      );
      expect(guia.eventos).toHaveLength(2);
    });

    it("acepta un evento con exactamente la misma fecha que el último", () => {
      const guia = guiaCreada();

      guia.registrarEvento(evento("e2", "EN_RUTA", 0));

      expect(guia.estadoActual).toBe("EN_RUTA");
    });
  });
});

describe("Guia.reconstruir", () => {
  it("restaura el historial y el estado actual", () => {
    const guia = Guia.reconstruir(GUIA_ID, TENANT_ID, [
      evento("e1", "CREADA", 0),
      evento("e2", "EN_RUTA", 5),
    ]);

    expect(guia.estadoActual).toBe("EN_RUTA");
    expect(guia.eventos).toHaveLength(2);
  });

  it("falla si no hay eventos", () => {
    expect(() => Guia.reconstruir(GUIA_ID, TENANT_ID, [])).toThrow();
  });
});

describe("encapsulamiento", () => {
  it("modificar la lista devuelta no altera el historial de la guía", () => {
    const guia = guiaCreada();

    // `eventos` devuelve una copia; vaciarla no debe afectar a la guía.
    (guia.eventos as EventoGuia[]).length = 0;

    expect(guia.eventos).toHaveLength(1);
  });
});
