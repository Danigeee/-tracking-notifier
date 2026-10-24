// Pruebas del caso de uso EnviarNotificacionesPendientes.
// Usan repositorios en memoria, un reloj controlable y un cliente de webhook falso:
// así se prueba el éxito, los fallos y los reintentos sin red ni base de datos.

import { beforeEach, describe, expect, it } from "vitest";
import { EnviarNotificacionesPendientes } from "../../src/application/use-cases/enviar-notificaciones-pendientes";
import { Notificacion } from "../../src/domain/notificacion";
import {
  ClienteWebhookFalso,
  ERROR_500,
  OK,
} from "../support/cliente-webhook-falso";
import { NotificacionRepositoryEnMemoria } from "../support/notificaciones-en-memoria";
import { RegistradorEnMemoria } from "../support/registrador-en-memoria";
import { RelojFijo } from "../support/reloj-fijo";
import { WebhookConfigRepositoryEnMemoria } from "../support/webhooks-en-memoria";

// Datos ficticios.
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const URL_A = "https://cliente-a.example/webhook";
const URL_B = "https://cliente-b.example/hook";
const SECRETO_A = "secreto-del-tenant-a";
const SECRETO_B = "secreto-del-tenant-b";

describe("EnviarNotificacionesPendientes", () => {
  let webhooks: WebhookConfigRepositoryEnMemoria;
  let repositorio: NotificacionRepositoryEnMemoria;
  let reloj: RelojFijo;
  let cliente: ClienteWebhookFalso;
  let registrador: RegistradorEnMemoria;
  let enviar: EnviarNotificacionesPendientes;

  /** Crea y guarda una notificación pendiente lista para enviarse ahora. */
  async function crearNotificacion(eventId: string, tenantId = TENANT_A, observacion?: string) {
    await repositorio.crear(
      Notificacion.crear(
        tenantId,
        "GUIA-001",
        { eventId, estado: "CREADA", fechaEvento: new Date("2026-10-24T10:00:00.000Z"), observacion },
        reloj.ahora(),
      ),
    );
  }

  /** La única notificación guardada con ese eventId. */
  const buscar = (eventId: string) => repositorio.todas().find((n) => n.eventId === eventId)!;

  // Cada prueba arranca con el tenant A y el B con webhook, y sin notificaciones.
  beforeEach(async () => {
    webhooks = new WebhookConfigRepositoryEnMemoria();
    await webhooks.guardar(TENANT_A, URL_A, SECRETO_A);
    await webhooks.guardar(TENANT_B, URL_B, SECRETO_B);
    repositorio = new NotificacionRepositoryEnMemoria(webhooks);
    reloj = new RelojFijo();
    cliente = new ClienteWebhookFalso();
    registrador = new RegistradorEnMemoria();
    enviar = new EnviarNotificacionesPendientes(repositorio, cliente, reloj, registrador);
  });

  describe("envío correcto", () => {
    it("envía el evento a la URL del tenant y la marca ENVIADA", async () => {
      await crearNotificacion("e1");

      const resumen = await enviar.ejecutar();

      expect(resumen).toMatchObject({ procesadas: 1, enviadas: 1, reintentos: 0, fallidas: 0 });
      expect(cliente.llamadas).toHaveLength(1);
      expect(cliente.llamadas[0]?.url).toBe(URL_A);
      expect(buscar("e1").estado).toBe("ENVIADA");
      expect(buscar("e1").intentos).toBe(1);
    });

    it("el mensaje contiene el evento y la guía", async () => {
      await crearNotificacion("e1", TENANT_A, "Recibida en bodega");

      await enviar.ejecutar();

      expect(cliente.llamadas[0]?.payload).toEqual({
        eventId: "e1",
        guiaId: "GUIA-001",
        estado: "CREADA",
        fechaEvento: "2026-10-24T10:00:00.000Z",
        observacion: "Recibida en bodega",
      });
    });

    it("no incluye la observación si el evento no la tiene", async () => {
      await crearNotificacion("e1");

      await enviar.ejecutar();

      expect(cliente.llamadas[0]?.payload).not.toHaveProperty("observacion");
    });

    it("una notificación ya enviada no se vuelve a enviar", async () => {
      await crearNotificacion("e1");
      await enviar.ejecutar();

      await enviar.ejecutar();
      reloj.avanzar(3600);
      await enviar.ejecutar();

      expect(cliente.llamadas).toHaveLength(1);
    });

    it("sin notificaciones pendientes no hace nada", async () => {
      const resumen = await enviar.ejecutar();

      expect(resumen).toEqual({ procesadas: 0, enviadas: 0, reintentos: 0, fallidas: 0, errores: [] });
      expect(cliente.llamadas).toHaveLength(0);
    });

    it("cada tenant recibe en su propia URL", async () => {
      await crearNotificacion("a1", TENANT_A);
      await crearNotificacion("b1", TENANT_B);

      await enviar.ejecutar();

      const urls = new Map(cliente.llamadas.map((l) => [l.payload.eventId, l.url]));
      expect(urls.get("a1")).toBe(URL_A);
      expect(urls.get("b1")).toBe(URL_B);
    });

    it("cada aviso se firma con el secreto de su tenant", async () => {
      await crearNotificacion("a1", TENANT_A);
      await crearNotificacion("b1", TENANT_B);

      await enviar.ejecutar();

      const secretos = new Map(cliente.llamadas.map((l) => [l.payload.eventId, l.secreto]));
      expect(secretos.get("a1")).toBe(SECRETO_A);
      expect(secretos.get("b1")).toBe(SECRETO_B);
    });

    it("usa el secreto vigente: tras rotarlo, los avisos nuevos se firman con el nuevo", async () => {
      await crearNotificacion("a1", TENANT_A);
      await enviar.ejecutar();

      await webhooks.rotarSecreto(TENANT_A, "secreto-rotado");
      await crearNotificacion("a2", TENANT_A);
      await enviar.ejecutar();

      expect(cliente.llamadas.map((l) => l.secreto)).toEqual([SECRETO_A, "secreto-rotado"]);
    });

    it("el secreto no forma parte del mensaje que recibe el cliente", async () => {
      await crearNotificacion("a1", TENANT_A);

      await enviar.ejecutar();

      expect(JSON.stringify(cliente.llamadas[0]?.payload)).not.toContain(SECRETO_A);
    });
  });

  describe("fallos y reintentos", () => {
    it("un fallo la deja PENDIENTE, reprogramada 10 segundos después, con el motivo guardado", async () => {
      cliente.responder(ERROR_500);
      await crearNotificacion("e1");
      const momentoDelFallo = reloj.ahora();

      const resumen = await enviar.ejecutar();

      expect(resumen).toMatchObject({ procesadas: 1, enviadas: 0, reintentos: 1, fallidas: 0 });
      const n = buscar("e1");
      expect(n.estado).toBe("PENDIENTE");
      expect(n.intentos).toBe(1);
      expect(n.proximoIntento.getTime()).toBe(momentoDelFallo.getTime() + 10_000);
      expect(n.ultimoError).toBe("el webhook respondió 500");
      expect(n.ultimoCodigoHttp).toBe(500);
    });

    it("no reintenta antes de que venza la espera", async () => {
      cliente.responder(ERROR_500);
      await crearNotificacion("e1");
      await enviar.ejecutar();

      reloj.avanzar(9); // faltan 1 segundo
      await enviar.ejecutar();

      expect(cliente.llamadas).toHaveLength(1);
    });

    it("reintenta cuando vence la espera y puede tener éxito", async () => {
      cliente.responder(ERROR_500, OK);
      await crearNotificacion("e1");
      await enviar.ejecutar();

      reloj.avanzar(10);
      const resumen = await enviar.ejecutar();

      expect(resumen.enviadas).toBe(1);
      expect(cliente.llamadas).toHaveLength(2);
      expect(buscar("e1").estado).toBe("ENVIADA");
      expect(buscar("e1").intentos).toBe(2);
      expect(buscar("e1").ultimoError).toBeNull();
    });

    it("la espera crece: 10 s, 1 min, 5 min, 30 min, y al quinto fallo queda FALLIDA", async () => {
      cliente.responder(ERROR_500, ERROR_500, ERROR_500, ERROR_500, ERROR_500);
      await crearNotificacion("e1");
      const esperasObservadas: number[] = [];

      for (let intento = 1; intento <= 5; intento++) {
        const antes = reloj.ahora();
        await enviar.ejecutar();
        const n = buscar("e1");
        if (n.estado === "PENDIENTE") {
          const espera = (n.proximoIntento.getTime() - antes.getTime()) / 1000;
          esperasObservadas.push(espera);
          reloj.avanzar(espera);
        }
      }

      expect(esperasObservadas).toEqual([10, 60, 300, 1800]);
      expect(buscar("e1").estado).toBe("FALLIDA");
      expect(buscar("e1").intentos).toBe(5);
      expect(cliente.llamadas).toHaveLength(5);
    });

    it("una notificación FALLIDA no se vuelve a intentar", async () => {
      cliente.responder(ERROR_500, ERROR_500, ERROR_500, ERROR_500, ERROR_500);
      await crearNotificacion("e1");
      for (let i = 0; i < 5; i++) {
        await enviar.ejecutar();
        reloj.avanzar(3600);
      }

      const resumen = await enviar.ejecutar();
      reloj.avanzar(86_400);
      await enviar.ejecutar();

      expect(resumen.procesadas).toBe(0);
      expect(cliente.llamadas).toHaveLength(5);
    });

    it("la última pasada informa la notificación como fallida", async () => {
      cliente.responder(ERROR_500, ERROR_500, ERROR_500, ERROR_500, ERROR_500);
      await crearNotificacion("e1");
      let ultimoResumen = await enviar.ejecutar();
      for (let i = 0; i < 4; i++) {
        reloj.avanzar(3600);
        ultimoResumen = await enviar.ejecutar();
      }

      expect(ultimoResumen).toMatchObject({ procesadas: 1, enviadas: 0, reintentos: 0, fallidas: 1 });
    });

    it("guarda el motivo cuando el cliente no responde (sin código HTTP)", async () => {
      cliente.responder({ exito: false, motivo: "tiempo de espera agotado", codigoHttp: null });
      await crearNotificacion("e1");

      await enviar.ejecutar();

      expect(buscar("e1").ultimoError).toBe("tiempo de espera agotado");
      expect(buscar("e1").ultimoCodigoHttp).toBeNull();
    });

    it("un error inesperado del cliente cuenta como un intento fallido y no rompe el proceso", async () => {
      cliente.responder(() => {
        throw new Error("fallo no previsto con datos internos");
      });
      await crearNotificacion("e1");

      const resumen = await enviar.ejecutar();

      expect(resumen).toMatchObject({ reintentos: 1 });
      expect(buscar("e1").estado).toBe("PENDIENTE");
      expect(buscar("e1").intentos).toBe(1);
      // El mensaje del error interno no se guarda ni se expone.
      expect(buscar("e1").ultimoError).toBe("error inesperado al enviar");
    });

    it("el fallo de una notificación no afecta a las demás", async () => {
      cliente.responder(ERROR_500, OK);
      await crearNotificacion("e1");
      await crearNotificacion("e2");

      const resumen = await enviar.ejecutar();

      expect(resumen).toMatchObject({ procesadas: 2, enviadas: 1, reintentos: 1 });
      expect(buscar("e1").estado).toBe("PENDIENTE");
      expect(buscar("e2").estado).toBe("ENVIADA");
    });
  });

  describe("logs", () => {
    it("registra el aviso entregado con sus identificadores, el intento y el código", async () => {
      await crearNotificacion("e1");

      await enviar.ejecutar();

      expect(registrador.con("aviso entregado")).toEqual([
        {
          nivel: "info",
          mensaje: "aviso entregado",
          datos: { tenantId: TENANT_A, guiaId: "GUIA-001", eventId: "e1", intento: 1, codigoHttp: 200 },
        },
      ]);
    });

    it("registra un fallo con el motivo y cuándo se reintentará", async () => {
      cliente.responder(ERROR_500);
      await crearNotificacion("e1");

      await enviar.ejecutar();

      const [fallo] = registrador.con("aviso fallido, se reintentará");
      expect(fallo?.nivel).toBe("warn");
      expect(fallo?.datos).toMatchObject({
        eventId: "e1",
        intento: 1,
        motivo: "el webhook respondió 500",
        codigoHttp: 500,
        proximoIntento: new Date(reloj.ahora().getTime() + 10_000).toISOString(),
      });
    });

    it("registra como error el aviso que agota sus intentos", async () => {
      cliente.responder(ERROR_500, ERROR_500, ERROR_500, ERROR_500, ERROR_500);
      await crearNotificacion("e1");
      for (let i = 0; i < 5; i++) {
        await enviar.ejecutar();
        reloj.avanzar(3600);
      }

      expect(registrador.con("aviso fallido, se reintentará")).toHaveLength(4);
      const [definitivo] = registrador.con("aviso fallido definitivamente");
      expect(definitivo?.nivel).toBe("error");
      expect(definitivo?.datos).toMatchObject({ eventId: "e1", intento: 5 });
    });

    it("no registra la URL del cliente, el secreto ni el contenido del mensaje", async () => {
      cliente.responder(ERROR_500, OK);
      await crearNotificacion("e1", TENANT_A, "observacion privada del cliente");
      await enviar.ejecutar();
      reloj.avanzar(10);
      await enviar.ejecutar();

      const todo = registrador.comoTexto();
      expect(todo).not.toContain(URL_A);
      expect(todo).not.toContain("cliente-a.example");
      expect(todo).not.toContain(SECRETO_A);
      expect(todo).not.toContain("observacion privada");
    });
  });

  describe("tenant sin webhook configurado", () => {
    it("no se envía ni gasta intentos: queda pendiente", async () => {
      await crearNotificacion("e1", "tenant-sin-webhook");

      const resumen = await enviar.ejecutar();

      expect(resumen.procesadas).toBe(0);
      expect(cliente.llamadas).toHaveLength(0);
      expect(buscar("e1").estado).toBe("PENDIENTE");
      expect(buscar("e1").intentos).toBe(0);
    });

    it("se envía en cuanto el tenant configura su webhook: no se pierde", async () => {
      await crearNotificacion("e1", "tenant-nuevo");
      await crearNotificacion("e2", "tenant-nuevo");
      await enviar.ejecutar();
      reloj.avanzar(3600); // pasa mucho tiempo sin webhook

      await webhooks.guardar("tenant-nuevo", "https://nuevo.example/hook", "secreto-nuevo");
      const resumen = await enviar.ejecutar();

      expect(resumen.enviadas).toBe(2);
      expect(cliente.llamadas.map((l) => l.url)).toEqual([
        "https://nuevo.example/hook",
        "https://nuevo.example/hook",
      ]);
      expect(buscar("e1").estado).toBe("ENVIADA");
    });

    it("las notificaciones sin webhook no bloquean las de otros tenants", async () => {
      // El lote es de 1: si las del tenant sin webhook se reclamaran, impedirían enviar la del tenant A.
      enviar = new EnviarNotificacionesPendientes(repositorio, cliente, reloj, registrador, { tamanoLote: 1 });
      await crearNotificacion("sin-webhook-1", "tenant-sin-webhook");
      await crearNotificacion("sin-webhook-2", "tenant-sin-webhook");
      await crearNotificacion("a1", TENANT_A);

      await enviar.ejecutar();

      expect(buscar("a1").estado).toBe("ENVIADA");
    });
  });

  describe("lotes y concurrencia", () => {
    it("procesa como máximo un lote por pasada", async () => {
      enviar = new EnviarNotificacionesPendientes(repositorio, cliente, reloj, registrador, { tamanoLote: 2 });
      for (const id of ["e1", "e2", "e3", "e4", "e5"]) await crearNotificacion(id);

      const primera = await enviar.ejecutar();
      const segunda = await enviar.ejecutar();
      const tercera = await enviar.ejecutar();

      expect([primera.procesadas, segunda.procesadas, tercera.procesadas]).toEqual([2, 2, 1]);
      expect(cliente.llamadas).toHaveLength(5);
    });

    it("dos pasadas simultáneas no envían la misma notificación dos veces", async () => {
      // El cliente tarda en responder: la primera pasada sigue enviando cuando empieza la segunda.
      cliente = new ClienteWebhookFalso(
        () => new Promise((resolver) => setTimeout(() => resolver(OK), 20)),
      );
      enviar = new EnviarNotificacionesPendientes(repositorio, cliente, reloj, registrador);
      await crearNotificacion("e1");

      await Promise.all([enviar.ejecutar(), enviar.ejecutar()]);

      expect(cliente.llamadas).toHaveLength(1);
      expect(buscar("e1").estado).toBe("ENVIADA");
    });

    it("si el proceso se cae a mitad de un envío, la notificación se retoma al vencer la reserva", async () => {
      await crearNotificacion("e1");
      // Se reclama pero nunca se guarda el resultado (como si el proceso hubiera muerto).
      await repositorio.reclamarPorEnviar({
        ahora: reloj.ahora(),
        limite: 10,
        reservarHasta: new Date(reloj.ahora().getTime() + 60_000),
      });

      // Mientras dure la reserva, nadie más la toma.
      reloj.avanzar(30);
      await enviar.ejecutar();
      expect(cliente.llamadas).toHaveLength(0);

      // Al vencer la reserva, vuelve a estar disponible y se envía.
      reloj.avanzar(31);
      await enviar.ejecutar();
      expect(cliente.llamadas).toHaveLength(1);
      expect(buscar("e1").estado).toBe("ENVIADA");
    });

    it("si no se puede guardar el resultado, informa el error y no pierde las demás", async () => {
      await crearNotificacion("e1");
      await crearNotificacion("e2");
      const guardarOriginal = repositorio.guardar.bind(repositorio);
      repositorio.guardar = async (n: Notificacion) => {
        if (n.eventId === "e1") throw new Error("base de datos caída");
        return guardarOriginal(n);
      };

      const resumen = await enviar.ejecutar();

      expect(resumen.errores).toHaveLength(1);
      expect(resumen.enviadas).toBe(1);
      expect(buscar("e2").estado).toBe("ENVIADA");
    });
  });
});
