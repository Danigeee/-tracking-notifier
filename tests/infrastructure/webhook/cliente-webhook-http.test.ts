// Pruebas del cliente de webhook HTTP contra un servidor real levantado en local.
// No hay red externa: el "cliente" es un servidor de Node en un puerto libre.

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PayloadWebhook } from "../../../src/application/ports/cliente-webhook";
import { ClienteWebhookHttp } from "../../../src/infrastructure/webhook/cliente-webhook-http";

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

    const resultado = await new ClienteWebhookHttp(2000).enviar(`${baseUrl}/hook`, PAYLOAD);

    expect(resultado).toEqual({ exito: true, codigoHttp: 204 });
  });

  it("envía un POST con el mensaje en JSON", async () => {
    await new ClienteWebhookHttp(2000).enviar(`${baseUrl}/hook`, PAYLOAD);

    expect(recibida?.metodo).toBe("POST");
    expect(recibida?.cabeceras["content-type"]).toBe("application/json");
    expect(JSON.parse(recibida?.cuerpo ?? "")).toEqual(PAYLOAD);
  });

  it("envía el eventId en la cabecera X-Event-Id", async () => {
    await new ClienteWebhookHttp(2000).enviar(`${baseUrl}/hook`, PAYLOAD);

    expect(recibida?.cabeceras["x-event-id"]).toBe(PAYLOAD.eventId);
  });

  it.each([400, 404, 500, 503])("un %i es un fallo con su código", async (codigo) => {
    comportamiento = (_req, res) => res.writeHead(codigo).end("detalle interno del cliente");

    const resultado = await new ClienteWebhookHttp(2000).enviar(`${baseUrl}/hook`, PAYLOAD);

    expect(resultado).toEqual({
      exito: false,
      motivo: `el webhook respondió ${codigo}`,
      codigoHttp: codigo,
    });
  });

  it("no incluye el cuerpo de la respuesta del cliente en el motivo", async () => {
    comportamiento = (_req, res) => res.writeHead(500).end("dato-privado-del-cliente");

    const resultado = await new ClienteWebhookHttp(2000).enviar(`${baseUrl}/hook`, PAYLOAD);

    expect(JSON.stringify(resultado)).not.toContain("dato-privado-del-cliente");
  });

  it("una redirección cuenta como fallo y no se sigue", async () => {
    comportamiento = (_req, res) => res.writeHead(302, { Location: "http://127.0.0.1:1/otro" }).end();

    const resultado = await new ClienteWebhookHttp(2000).enviar(`${baseUrl}/hook`, PAYLOAD);

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
    const resultado = await new ClienteWebhookHttp(150).enviar(`${baseUrl}/hook`, PAYLOAD);
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
    const resultado = await new ClienteWebhookHttp(2000).enviar("http://127.0.0.1:1/hook", PAYLOAD);

    expect(resultado).toEqual({
      exito: false,
      motivo: "no se pudo conectar con el webhook",
      codigoHttp: null,
    });
  });

  it("una URL inválida falla sin lanzar error", async () => {
    const resultado = await new ClienteWebhookHttp(2000).enviar("no-es-una-url", PAYLOAD);

    expect(resultado.exito).toBe(false);
  });
});
