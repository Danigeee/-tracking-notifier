// Pruebas del cliente de webhook HTTP contra un servidor real levantado en local.
// No hay red externa: el "cliente" es un servidor de Node en un puerto libre.

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PayloadWebhook } from "../../../src/application/ports/cliente-webhook";
import { ClienteWebhookHttp } from "../../../src/infrastructure/webhook/cliente-webhook-http";
import { calcularFirma, verificarFirma } from "../../../src/infrastructure/webhook/firma";
import { RelojFijo } from "../../support/reloj-fijo";

// Secreto ficticio del cliente y reloj fijo para que la firma sea reproducible.
const SECRETO = "whsec_secreto-de-prueba";
const RELOJ = new RelojFijo(new Date("2026-10-24T12:00:00.000Z"));
const TIMESTAMP_ESPERADO = Math.floor(new Date("2026-10-24T12:00:00.000Z").getTime() / 1000);

/** Cliente de webhook con el reloj fijo de las pruebas. */
const crearCliente = (timeoutMs: number) => new ClienteWebhookHttp(timeoutMs, RELOJ);

const PAYLOAD: PayloadWebhook = {
  eventId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  guiaId: "GUIA-001",
  estado: "EN_RUTA",
  fechaEvento: "2026-10-24T10:00:00.000Z",
  observacion: "Salió de la bodega",
};

/** Lo que recibió el servidor en la última petición. */
interface Recibida {
  metodo?: string;
  cabeceras: IncomingMessage["headers"];
  cuerpo: string;
}

describe("ClienteWebhookHttp", () => {
  let servidor: Server;
  let baseUrl: string;
  let recibida: Recibida | undefined;
  /** Cómo responde el servidor de prueba; cada test lo reemplaza. */
  let comportamiento: (req: IncomingMessage, res: ServerResponse) => void;

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      let cuerpo = "";
      req.on("data", (trozo) => (cuerpo += trozo));
      req.on("end", () => {
        recibida = { metodo: req.method, cabeceras: req.headers, cuerpo };
        comportamiento(req, res);
      });
    });
    // El puerto 0 pide al sistema operativo uno libre.
    await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
    baseUrl = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    servidor.closeAllConnections();
    await new Promise((resolver) => servidor.close(resolver));
  });

  beforeEach(() => {
    recibida = undefined;
    comportamiento = (_req, res) => res.writeHead(200).end("ok");
  });

  it("devuelve éxito con el código cuando el cliente responde 2xx", async () => {
    comportamiento = (_req, res) => res.writeHead(204).end();

    const resultado = await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

    expect(resultado).toEqual({ exito: true, codigoHttp: 204 });
  });

  it("envía un POST con el mensaje en JSON", async () => {
    await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

    expect(recibida?.metodo).toBe("POST");
    expect(recibida?.cabeceras["content-type"]).toBe("application/json");
    expect(JSON.parse(recibida?.cuerpo ?? "")).toEqual(PAYLOAD);
  });

  it("envía el eventId en la cabecera X-Event-Id", async () => {
    await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

    expect(recibida?.cabeceras["x-event-id"]).toBe(PAYLOAD.eventId);
  });

  describe("firma", () => {
    it("envía la hora del envío en X-Timestamp (segundos)", async () => {
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

      expect(recibida?.cabeceras["x-timestamp"]).toBe(String(TIMESTAMP_ESPERADO));
    });

    it("envía en X-Signature una firma que el cliente puede verificar con su secreto", async () => {
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

      const firma = String(recibida?.cabeceras["x-signature"]);
      // El cliente verifica con lo que recibió: la hora, el cuerpo exacto y su secreto.
      expect(verificarFirma(SECRETO, Number(recibida?.cabeceras["x-timestamp"]), recibida!.cuerpo, firma)).toBe(true);
      expect(firma).toBe(calcularFirma(SECRETO, TIMESTAMP_ESPERADO, recibida!.cuerpo));
    });

    it("la firma NO se verifica con otro secreto", async () => {
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

      const firma = String(recibida?.cabeceras["x-signature"]);
      expect(verificarFirma("otro-secreto", TIMESTAMP_ESPERADO, recibida!.cuerpo, firma)).toBe(false);
    });

    it("cada tenant firma con su secreto: dos secretos dan firmas distintas", async () => {
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, "secreto-a");
      const firmaA = recibida?.cabeceras["x-signature"];
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, "secreto-b");
      const firmaB = recibida?.cabeceras["x-signature"];

      expect(firmaA).not.toBe(firmaB);
    });

    it("el secreto no viaja en ninguna cabecera ni en el cuerpo", async () => {
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

      expect(JSON.stringify(recibida?.cabeceras)).not.toContain(SECRETO);
      expect(recibida?.cuerpo).not.toContain(SECRETO);
    });

    it("un reintento lleva la hora del momento y por eso una firma nueva", async () => {
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);
      const primera = recibida?.cabeceras["x-signature"];

      RELOJ.avanzar(10);
      await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);
      const segunda = recibida?.cabeceras["x-signature"];

      expect(segunda).not.toBe(primera);
      expect(recibida?.cabeceras["x-timestamp"]).toBe(String(TIMESTAMP_ESPERADO + 10));
      // El identificador del evento no cambia entre intentos.
      expect(recibida?.cabeceras["x-event-id"]).toBe(PAYLOAD.eventId);
    });
  });

  it.each([400, 404, 500, 503])("un %i es un fallo con su código", async (codigo) => {
    comportamiento = (_req, res) => res.writeHead(codigo).end("detalle interno del cliente");

    const resultado = await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

    expect(resultado).toEqual({
      exito: false,
      motivo: `el webhook respondió ${codigo}`,
      codigoHttp: codigo,
    });
  });

  it("no incluye el cuerpo de la respuesta del cliente en el motivo", async () => {
    comportamiento = (_req, res) => res.writeHead(500).end("dato-privado-del-cliente");

    const resultado = await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

    expect(JSON.stringify(resultado)).not.toContain("dato-privado-del-cliente");
  });

  it("una redirección cuenta como fallo y no se sigue", async () => {
    comportamiento = (_req, res) => res.writeHead(302, { Location: "http://127.0.0.1:1/otro" }).end();

    const resultado = await crearCliente(2000).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);

    expect(resultado).toEqual({
      exito: false,
      motivo: "el webhook respondió 302",
      codigoHttp: 302,
    });
  });

  it("si el cliente tarda más que el timeout, falla por tiempo de espera", async () => {
    // El servidor nunca responde.
    comportamiento = () => {};

    const inicio = Date.now();
    const resultado = await crearCliente(150).enviar(`${baseUrl}/hook`, PAYLOAD, SECRETO);
    const duracion = Date.now() - inicio;

    expect(resultado).toEqual({
      exito: false,
      motivo: "tiempo de espera agotado",
      codigoHttp: null,
    });
    // Corta cerca del límite, no espera indefinidamente.
    expect(duracion).toBeGreaterThanOrEqual(140);
    expect(duracion).toBeLessThan(1500);
  });

  it("si no se puede conectar, falla sin lanzar error ni exponer detalles", async () => {
    // Puerto 1: nadie escucha.
    const resultado = await crearCliente(2000).enviar("http://127.0.0.1:1/hook", PAYLOAD, SECRETO);

    expect(resultado).toEqual({
      exito: false,
      motivo: "no se pudo conectar con el webhook",
      codigoHttp: null,
    });
  });

  it("una URL inválida falla sin lanzar error", async () => {
    const resultado = await crearCliente(2000).enviar("no-es-una-url", PAYLOAD, SECRETO);

    expect(resultado.exito).toBe(false);
  });
});
