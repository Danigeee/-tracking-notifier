// Implementación en memoria del puerto NotificacionRepository, solo para pruebas.

import {
  ConsultaNotificaciones,
  NotificacionPorEnviar,
  NotificacionRepository,
  ReclamoNotificaciones,
} from "../../src/application/ports/notificacion-repository";
import { Notificacion } from "../../src/domain/notificacion";
import { WebhookConfigRepositoryEnMemoria } from "./webhooks-en-memoria";

export class NotificacionRepositoryEnMemoria implements NotificacionRepository {
  /** Notificaciones en orden de creación. */
  private almacen: Notificacion[] = [];

  /**
   * @param webhooks de dónde salen la URL y el secreto de cada tenant; sin ellos, ningún
   *        tenant tiene webhook y `reclamarPorEnviar` no reclama nada.
   */
  constructor(private readonly webhooks?: WebhookConfigRepositoryEnMemoria) {}

  async crear(notificacion: Notificacion): Promise<void> {
    this.almacen.push(notificacion);
  }

  async listar(consulta: ConsultaNotificaciones): Promise<Notificacion[]> {
    return this.almacen
      .filter((n) => n.tenantId === consulta.tenantId)
      .filter((n) => !consulta.estado || n.estado === consulta.estado)
      .reverse() // la más reciente primero
      .slice(0, consulta.limite);
  }

  async reclamarPorEnviar(reclamo: ReclamoNotificaciones): Promise<NotificacionPorEnviar[]> {
    // Primero se consultan las URL (aquí hay esperas); después, sin ninguna espera de
    // por medio, se eligen y reservan las notificaciones. Así la reserva es atómica,
    // igual que la sentencia UPDATE de la base de datos real.
    const destinos = new Map<string, { url: string; secreto: string } | null>();
    for (const tenantId of new Set(this.almacen.map((n) => n.tenantId))) {
      const url = await this.webhooks?.obtener(tenantId);
      const secreto = this.webhooks?.secretoDe(tenantId);
      destinos.set(tenantId, url && secreto ? { url, secreto } : null);
    }

    const reclamadas: NotificacionPorEnviar[] = [];

    for (const n of this.almacen) {
      if (reclamadas.length >= reclamo.limite) break;
      if (n.estado !== "PENDIENTE" || n.proximoIntento > reclamo.ahora) continue;

      // Sin webhook configurado la notificación se deja como está.
      const destino = destinos.get(n.tenantId);
      if (!destino) continue;

      // Se reserva: su próximo intento pasa al final de la reserva.
      const reservada = Notificacion.reconstruir({
        tenantId: n.tenantId,
        guiaId: n.guiaId,
        evento: n.evento,
        estado: n.estado,
        intentos: n.intentos,
        proximoIntento: reclamo.reservarHasta,
        ultimoError: n.ultimoError,
        ultimoCodigoHttp: n.ultimoCodigoHttp,
        creadaEn: n.creadaEn,
      });
      this.reemplazar(reservada);
      reclamadas.push({
        notificacion: reservada,
        webhookUrl: destino.url,
        webhookSecreto: destino.secreto,
      });
    }
    return reclamadas;
  }

  async guardar(notificacion: Notificacion): Promise<void> {
    this.reemplazar(notificacion);
  }

  /** Todas las notificaciones guardadas, de cualquier tenant. Solo para comprobar en las pruebas. */
  todas(): readonly Notificacion[] {
    return [...this.almacen];
  }

  /** Reemplaza la notificación que tiene la misma clave (tenant, guía y evento). */
  private reemplazar(nueva: Notificacion): void {
    this.almacen = this.almacen.map((n) =>
      n.tenantId === nueva.tenantId && n.guiaId === nueva.guiaId && n.eventId === nueva.eventId
        ? nueva
        : n,
    );
  }
}
