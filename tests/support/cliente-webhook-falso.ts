// Cliente de webhook de pruebas: registra las llamadas y responde lo que la prueba indique.

import {
  ClienteWebhook,
  PayloadWebhook,
  ResultadoEnvio,
} from "../../src/application/ports/cliente-webhook";

/** Una llamada recibida por el cliente falso. */
export interface LlamadaWebhook {
  readonly url: string;
  readonly payload: PayloadWebhook;
}

/** Cómo responde el cliente falso: un resultado, o una función que lo calcula (puede ser asíncrona o lanzar). */
export type RespuestaFalsa =
  | ResultadoEnvio
  | ((llamada: LlamadaWebhook) => ResultadoEnvio | Promise<ResultadoEnvio>);

export const OK: ResultadoEnvio = { exito: true, codigoHttp: 200 };
export const ERROR_500: ResultadoEnvio = {
  exito: false,
  motivo: "el webhook respondió 500",
  codigoHttp: 500,
};

export class ClienteWebhookFalso implements ClienteWebhook {
  /** Todas las llamadas recibidas, en orden. */
  readonly llamadas: LlamadaWebhook[] = [];

  /** Respuestas programadas, una por llamada. Cuando se acaban se usa `porDefecto`. */
  private readonly cola: RespuestaFalsa[] = [];

  constructor(private readonly porDefecto: RespuestaFalsa = OK) {}

  /** Programa las respuestas de las próximas llamadas, en orden. */
  responder(...respuestas: RespuestaFalsa[]): this {
    this.cola.push(...respuestas);
    return this;
  }

  async enviar(url: string, payload: PayloadWebhook): Promise<ResultadoEnvio> {
    const llamada = { url, payload };
    this.llamadas.push(llamada);
    const respuesta = this.cola.shift() ?? this.porDefecto;
    return typeof respuesta === "function" ? respuesta(llamada) : respuesta;
  }
}
