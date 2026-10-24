// Caso de uso: enviar las notificaciones que toca enviar.
//
// Lo invoca el worker de forma periódica. Cada llamada procesa un lote:
//   1. Reclama de forma exclusiva las notificaciones vencidas.
//   2. Las entrega al webhook de cada cliente.
//   3. Guarda el resultado: enviada, reprogramada con espera creciente o fallida.

import { Notificacion } from "../../domain/notificacion";
import {
  POLITICA_REINTENTOS_POR_DEFECTO,
  PoliticaReintentos,
} from "../../domain/politica-reintentos";
import { ClienteWebhook, PayloadWebhook, ResultadoEnvio } from "../ports/cliente-webhook";
import { NotificacionPorEnviar, NotificacionRepository } from "../ports/notificacion-repository";
import { Reloj } from "../ports/reloj";

/** Opciones del caso de uso. */
export interface OpcionesEnvio {
  /** Cuántas notificaciones se procesan por pasada. */
  readonly tamanoLote: number;
  /**
   * Segundos que una notificación queda reservada mientras se envía. Debe ser
   * mayor que el tiempo máximo de un envío (el timeout del cliente de webhook).
   */
  readonly reservaSegundos: number;
  readonly politica: PoliticaReintentos;
}

const OPCIONES_POR_DEFECTO: OpcionesEnvio = {
  tamanoLote: 10,
  reservaSegundos: 60,
  politica: POLITICA_REINTENTOS_POR_DEFECTO,
};

/** Resumen de una pasada. */
export interface ResumenEnvio {
  /** Notificaciones reclamadas en esta pasada. */
  readonly procesadas: number;
  /** Cuántas se entregaron con éxito. */
  readonly enviadas: number;
  /** Cuántas fallaron pero quedan pendientes para reintentar. */
  readonly reintentos: number;
  /** Cuántas agotaron sus intentos y quedaron FALLIDAS. */
  readonly fallidas: number;
  /** Errores al guardar resultados (por ejemplo, base de datos caída). Esas notificaciones se reintentan al vencer su reserva. */
  readonly errores: readonly unknown[];
}

export class EnviarNotificacionesPendientes {
  private readonly opciones: OpcionesEnvio;

  constructor(
    private readonly notificaciones: NotificacionRepository,
    private readonly clienteWebhook: ClienteWebhook,
    private readonly reloj: Reloj,
    opciones: Partial<OpcionesEnvio> = {},
  ) {
    this.opciones = { ...OPCIONES_POR_DEFECTO, ...opciones };
  }

  /** Procesa un lote de notificaciones vencidas. */
  async ejecutar(): Promise<ResumenEnvio> {
    const ahora = this.reloj.ahora();
    const lote = await this.notificaciones.reclamarPorEnviar({
      ahora,
      limite: this.opciones.tamanoLote,
      reservarHasta: new Date(ahora.getTime() + this.opciones.reservaSegundos * 1000),
    });

    // Se procesan en paralelo; el fallo de una no afecta a las demás.
    const resultados = await Promise.allSettled(lote.map((item) => this.procesar(item)));

    const resumen = { procesadas: lote.length, enviadas: 0, reintentos: 0, fallidas: 0 };
    const errores: unknown[] = [];
    for (const resultado of resultados) {
      if (resultado.status === "rejected") {
        errores.push(resultado.reason);
      } else if (resultado.value.estado === "ENVIADA") {
        resumen.enviadas++;
      } else if (resultado.value.estado === "FALLIDA") {
        resumen.fallidas++;
      } else {
        resumen.reintentos++;
      }
    }
    return { ...resumen, errores };
  }

  /** Entrega una notificación y guarda su nuevo estado. */
  private async procesar({
    notificacion,
    webhookUrl,
    webhookSecreto,
  }: NotificacionPorEnviar): Promise<Notificacion> {
    const resultado = await this.entregar(notificacion, webhookUrl, webhookSecreto);

    // La hora se toma después del envío: la espera del reintento cuenta desde que terminó.
    const actualizada = resultado.exito
      ? notificacion.registrarEnvio(resultado.codigoHttp)
      : notificacion.registrarFallo(
          this.reloj.ahora(),
          resultado.motivo,
          resultado.codigoHttp,
          this.opciones.politica,
        );

    await this.notificaciones.guardar(actualizada);
    return actualizada;
  }

  /** Llama al cliente de webhook. Un error inesperado se trata como un intento fallido más. */
  private async entregar(
    notificacion: Notificacion,
    webhookUrl: string,
    webhookSecreto: string,
  ): Promise<ResultadoEnvio> {
    try {
      return await this.clienteWebhook.enviar(
        webhookUrl,
        this.construirPayload(notificacion),
        webhookSecreto,
      );
    } catch {
      return { exito: false, motivo: "error inesperado al enviar", codigoHttp: null };
    }
  }

  /** Mensaje que recibe el cliente. */
  private construirPayload(notificacion: Notificacion): PayloadWebhook {
    const { evento } = notificacion;
    return {
      eventId: evento.eventId,
      guiaId: notificacion.guiaId,
      estado: evento.estado,
      fechaEvento: evento.fechaEvento.toISOString(),
      ...(evento.observacion !== undefined && { observacion: evento.observacion }),
    };
  }
}
