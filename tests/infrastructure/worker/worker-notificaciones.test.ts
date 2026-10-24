// Pruebas del worker de notificaciones con un caso de uso falso.
// Se usan intervalos muy cortos con temporizadores reales y `vi.waitFor` para esperar.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ResumenEnvio } from "../../../src/application/use-cases/enviar-notificaciones-pendientes";
import { WorkerNotificaciones } from "../../../src/infrastructure/worker/worker-notificaciones";
import { RegistradorEnMemoria } from "../../support/registrador-en-memoria";

/** Resumen de una pasada que procesó `n` notificaciones. */
const resumen = (n: number, errores: unknown[] = []): ResumenEnvio => ({
  procesadas: n,
  enviadas: n,
  reintentos: 0,
  fallidas: 0,
  errores,
});

describe("WorkerNotificaciones", () => {
  let worker: WorkerNotificaciones | undefined;

  // Cada prueba debe dejar el worker detenido para no filtrar temporizadores a las demás.
  afterEach(async () => {
    await worker?.detener();
    worker = undefined;
  });

  it("ejecuta pasadas de forma periódica", async () => {
    const ejecutar = vi.fn().mockResolvedValue(resumen(0));
    worker = new WorkerNotificaciones({ ejecutar }, 10, 10, new RegistradorEnMemoria());

    worker.iniciar();

    await vi.waitFor(() => expect(ejecutar.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it("no ejecuta nada antes de iniciar", async () => {
    const ejecutar = vi.fn().mockResolvedValue(resumen(0));
    worker = new WorkerNotificaciones({ ejecutar }, 10, 10, new RegistradorEnMemoria());

    await new Promise((resolver) => setTimeout(resolver, 50));

    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("detener() impide nuevas pasadas", async () => {
    const ejecutar = vi.fn().mockResolvedValue(resumen(0));
    worker = new WorkerNotificaciones({ ejecutar }, 10, 10, new RegistradorEnMemoria());
    worker.iniciar();
    await vi.waitFor(() => expect(ejecutar).toHaveBeenCalled());

    await worker.detener();
    const llamadasAlDetener = ejecutar.mock.calls.length;
    await new Promise((resolver) => setTimeout(resolver, 60));

    expect(ejecutar.mock.calls.length).toBe(llamadasAlDetener);
  });

  it("detener() espera a que termine la pasada en curso", async () => {
    let terminada = false;
    const ejecutar = vi.fn().mockImplementation(
      () =>
        new Promise<ResumenEnvio>((resolver) =>
          setTimeout(() => {
            terminada = true;
            resolver(resumen(1));
          }, 80),
        ),
    );
    worker = new WorkerNotificaciones({ ejecutar }, 10, 10, new RegistradorEnMemoria());
    worker.iniciar();
    await vi.waitFor(() => expect(ejecutar).toHaveBeenCalled());

    await worker.detener();

    // Al volver, el envío que estaba en marcha ya terminó: no se corta a la mitad.
    expect(terminada).toBe(true);
  });

  it("nunca solapa dos pasadas", async () => {
    let simultaneas = 0;
    let maximo = 0;
    const ejecutar = vi.fn().mockImplementation(async () => {
      simultaneas++;
      maximo = Math.max(maximo, simultaneas);
      await new Promise((resolver) => setTimeout(resolver, 30));
      simultaneas--;
      return resumen(0);
    });
    // Intervalo (5 ms) mucho menor que lo que tarda cada pasada (30 ms).
    worker = new WorkerNotificaciones({ ejecutar }, 5, 10, new RegistradorEnMemoria());

    worker.iniciar();
    await vi.waitFor(() => expect(ejecutar.mock.calls.length).toBeGreaterThanOrEqual(3));

    expect(maximo).toBe(1);
  });

  it("si una pasada falla, informa el error y sigue con las siguientes", async () => {
    const registrador = new RegistradorEnMemoria();
    const ejecutar = vi
      .fn()
      .mockRejectedValueOnce(new Error("base de datos caída"))
      .mockResolvedValue(resumen(0));
    worker = new WorkerNotificaciones({ ejecutar }, 10, 10, registrador);

    worker.iniciar();

    await vi.waitFor(() => expect(ejecutar.mock.calls.length).toBeGreaterThanOrEqual(3));
    const errores = registrador.con("falló una pasada del envío de notificaciones");
    expect(errores).toHaveLength(1);
    expect(errores[0]?.error).toEqual(new Error("base de datos caída"));
  });

  it("informa los errores que el caso de uso devuelve en el resumen", async () => {
    const registrador = new RegistradorEnMemoria();
    const ejecutar = vi
      .fn()
      .mockResolvedValueOnce(resumen(2, ["error al guardar 1", "error al guardar 2"]))
      .mockResolvedValue(resumen(0));
    worker = new WorkerNotificaciones({ ejecutar }, 10, 10, registrador);

    worker.iniciar();

    await vi.waitFor(() =>
      expect(registrador.con("no se pudo guardar el resultado de un envío")).toHaveLength(2),
    );
  });

  it("si una pasada llena el lote, la siguiente es inmediata", async () => {
    // Intervalo largo (10 s): solo habrá una segunda pasada pronto si no espera el intervalo.
    const ejecutar = vi.fn().mockResolvedValueOnce(resumen(10)).mockResolvedValue(resumen(0));
    worker = new WorkerNotificaciones({ ejecutar }, 10_000, 10, new RegistradorEnMemoria());

    worker.iniciar();

    await vi.waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(2), { timeout: 1000 });
  });

  it("si el lote no se llena, espera el intervalo antes de la siguiente pasada", async () => {
    const ejecutar = vi.fn().mockResolvedValue(resumen(3));
    worker = new WorkerNotificaciones({ ejecutar }, 10_000, 10, new RegistradorEnMemoria());

    worker.iniciar();
    await vi.waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(1));
    await new Promise((resolver) => setTimeout(resolver, 100));

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("iniciar() dos veces no duplica el bucle", async () => {
    const ejecutar = vi.fn().mockResolvedValue(resumen(0));
    worker = new WorkerNotificaciones({ ejecutar }, 10_000, 10, new RegistradorEnMemoria());

    worker.iniciar();
    worker.iniciar();
    await new Promise((resolver) => setTimeout(resolver, 60));

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});
