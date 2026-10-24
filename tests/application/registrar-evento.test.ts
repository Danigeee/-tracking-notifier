// Pruebas del caso de uso RegistrarEvento con repositorios en memoria.

import { beforeEach, describe, expect, it } from "vitest";
import {
  RegistrarEvento,
  RegistrarEventoComando,
} from "../../src/application/use-cases/registrar-evento";
import {
  EventoFueraDeOrdenError,
  PrimerEventoInvalidoError,
  TransicionInvalidaError,
} from "../../src/domain/errores";
import { EstadoGuia } from "../../src/domain/estado-guia";
import { GuiaRepositoryEnMemoria, UnidadDeTrabajoEnMemoria } from "../support/guias-en-memoria";
import { NotificacionRepositoryEnMemoria } from "../support/notificaciones-en-memoria";
import { RegistradorEnMemoria } from "../support/registrador-en-memoria";
import { RelojFijo } from "../support/reloj-fijo";

// Datos ficticios.
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const GUIA = "GUIA-001";

/** Construye un comando; `minuto` desplaza la fecha para ordenar los eventos. */
function comando(
  eventId: string,
  estado: EstadoGuia,
  minuto: number,
  tenantId = TENANT_A,
): RegistrarEventoComando {
  return {
    tenantId,
    guiaId: GUIA,
    eventId,
    estado,
    fechaEvento: new Date(Date.UTC(2026, 9, 24, 10, minuto)),
  };
}

describe("RegistrarEvento", () => {
  let guias: GuiaRepositoryEnMemoria;
  let notificaciones: NotificacionRepositoryEnMemoria;
  let reloj: RelojFijo;
  let registrador: RegistradorEnMemoria;
  let registrarEvento: RegistrarEvento;

  // Cada prueba arranca con repositorios vacíos.
  beforeEach(() => {
    guias = new GuiaRepositoryEnMemoria();
    notificaciones = new NotificacionRepositoryEnMemoria();
    reloj = new RelojFijo();
    registrador = new RegistradorEnMemoria();
    registrarEvento = new RegistrarEvento(
      new UnidadDeTrabajoEnMemoria({ guias, notificaciones }),
      reloj,
      registrador,
    );
  });

  it("crea la guía con un primer evento CREADA", async () => {
    const resultado = await registrarEvento.ejecutar(comando("e1", "CREADA", 0));

    expect(resultado).toEqual({ resultado: "REGISTRADO", estadoActual: "CREADA" });
    expect(await guias.buscar(TENANT_A, GUIA)).not.toBeNull();
  });

  it("rechaza un primer evento distinto de CREADA y no guarda nada", async () => {
    await expect(registrarEvento.ejecutar(comando("e1", "EN_RUTA", 0))).rejects.toThrow(
      PrimerEventoInvalidoError,
    );

    expect(guias.vecesGuardado).toBe(0);
    expect(notificaciones.todas()).toHaveLength(0);
  });

  it("agrega un evento válido a una guía existente", async () => {
    await registrarEvento.ejecutar(comando("e1", "CREADA", 0));

    const resultado = await registrarEvento.ejecutar(comando("e2", "EN_RUTA", 5));

    expect(resultado).toEqual({ resultado: "REGISTRADO", estadoActual: "EN_RUTA" });
    const guia = await guias.buscar(TENANT_A, GUIA);
    expect(guia?.eventos.map((e) => e.eventId)).toEqual(["e1", "e2"]);
  });

  it("un eventId repetido devuelve DUPLICADO y no vuelve a guardar", async () => {
    await registrarEvento.ejecutar(comando("e1", "CREADA", 0));
    await registrarEvento.ejecutar(comando("e2", "EN_RUTA", 5));
    const guardadosAntes = guias.vecesGuardado;

    const resultado = await registrarEvento.ejecutar(comando("e2", "EN_RUTA", 5));

    expect(resultado).toEqual({ resultado: "DUPLICADO", estadoActual: "EN_RUTA" });
    expect(guias.vecesGuardado).toBe(guardadosAntes);
  });

  it("propaga el error de una transición inválida y no guarda", async () => {
    await registrarEvento.ejecutar(comando("e1", "CREADA", 0));
    const guardadosAntes = guias.vecesGuardado;

    await expect(registrarEvento.ejecutar(comando("e2", "ENTREGADA", 5))).rejects.toThrow(
      TransicionInvalidaError,
    );

    expect(guias.vecesGuardado).toBe(guardadosAntes);
  });

  it("propaga el error de un evento fuera de orden", async () => {
    await registrarEvento.ejecutar(comando("e1", "CREADA", 10));

    await expect(registrarEvento.ejecutar(comando("e2", "EN_RUTA", 5))).rejects.toThrow(
      EventoFueraDeOrdenError,
    );
  });

  it("separa las guías por tenant aunque tengan el mismo id", async () => {
    await registrarEvento.ejecutar(comando("e1", "CREADA", 0, TENANT_A));
    await registrarEvento.ejecutar(comando("e2", "EN_RUTA", 5, TENANT_A));

    // El tenant B no tiene esa guía: para él es nueva y debe empezar en CREADA.
    await expect(
      registrarEvento.ejecutar(comando("e3", "EN_RUTA", 6, TENANT_B)),
    ).rejects.toThrow(PrimerEventoInvalidoError);

    // La guía del tenant A no se alteró.
    const guiaA = await guias.buscar(TENANT_A, GUIA);
    expect(guiaA?.estadoActual).toBe("EN_RUTA");
  });

  describe("logs", () => {
    it("registra el evento aceptado con tenant, guía, evento y estado", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));

      expect(registrador.con("evento registrado")).toEqual([
        {
          nivel: "info",
          mensaje: "evento registrado",
          datos: { tenantId: TENANT_A, guiaId: GUIA, eventId: "e1", estado: "CREADA" },
        },
      ]);
    });

    it("registra un duplicado con un mensaje distinto", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));

      expect(registrador.con("evento registrado")).toHaveLength(1);
      expect(registrador.con("evento duplicado ignorado")).toHaveLength(1);
    });

    it("un evento rechazado no deja un log de que se aceptó", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));
      registrador.entradas.length = 0;

      await expect(registrarEvento.ejecutar(comando("e2", "ENTREGADA", 5))).rejects.toThrow();

      expect(registrador.entradas).toHaveLength(0);
    });

    it("no registra la observación del evento", async () => {
      await registrarEvento.ejecutar({ ...comando("e1", "CREADA", 0), observacion: "texto libre privado" });

      expect(registrador.comoTexto()).not.toContain("texto libre privado");
    });
  });

  describe("notificaciones", () => {
    it("crea una notificación pendiente por cada evento aceptado", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));
      await registrarEvento.ejecutar(comando("e2", "EN_RUTA", 5));

      const creadas = notificaciones.todas();
      expect(creadas.map((n) => n.eventId)).toEqual(["e1", "e2"]);
      expect(creadas.every((n) => n.estado === "PENDIENTE" && n.intentos === 0)).toBe(true);
    });

    it("deja la notificación asociada al tenant y a la guía del evento", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0, TENANT_B));

      const [notificacion] = notificaciones.todas();
      expect(notificacion?.tenantId).toBe(TENANT_B);
      expect(notificacion?.guiaId).toBe(GUIA);
    });

    it("la deja lista para enviarse en el momento actual del reloj", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));

      const [notificacion] = notificaciones.todas();
      expect(notificacion?.proximoIntento).toEqual(reloj.ahora());
      expect(notificacion?.creadaEn).toEqual(reloj.ahora());
    });

    it("un evento duplicado NO crea otra notificación", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));

      expect(notificaciones.todas()).toHaveLength(1);
    });

    it("un evento rechazado NO crea notificación", async () => {
      await registrarEvento.ejecutar(comando("e1", "CREADA", 0));

      await expect(registrarEvento.ejecutar(comando("e2", "ENTREGADA", 5))).rejects.toThrow(
        TransicionInvalidaError,
      );
      await expect(registrarEvento.ejecutar(comando("e3", "EN_RUTA", -5))).rejects.toThrow(
        EventoFueraDeOrdenError,
      );

      // Solo existe la del primer evento.
      expect(notificaciones.todas().map((n) => n.eventId)).toEqual(["e1"]);
    });
  });
});
