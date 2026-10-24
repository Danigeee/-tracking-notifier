// Implementación en memoria del puerto NotificacionRepository, solo para pruebas.

import {
  ConsultaNotificaciones,
  NotificacionPorEnviar,
  NotificacionRepository,
  ReclamoNotificaciones,
} from "../../src/application/ports/notificacion-repository";
import { WebhookConfigRepository } from "../../src/application/ports/webhook-config-repository";
import { Notificacion } from "../../src/domain/notificacion";

export class NotificacionRepositoryEnMemoria implements NotificacionRepository {
  /** Notificaciones en orden de creación. */
  private almacen: Notificacion[] = [];

  /**
   * @param webhooks de dónde sale la URL de cada tenant; sin ellos, ningún tenant
   *        tiene webhook y `reclamarPorEnviar` no reclama nada.
   */
  constructor(private readonly webhooks?: WebhookConfigRepository) {}

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
    const urls = new Map<string, string | null>();
    for (const tenantId of new Set(this.almacen.map((n) => n.tenantId))) {
      urls.set(tenantId, (await this.webhooks?.obtener(tenantId)) ?? null);
    }

    const reclamadas: NotificacionPorEnviar[] = [];

    for (const n of this.almacen) {
      if (reclamadas.length >= reclamo.limite) break;
      if (n.estado !== "PENDIENTE" || n.proximoIntento > reclamo.ahora) continue;

      // Sin webhook configurado la notificación se deja como está.
      const webhookUrl = urls.get(n.tenantId);
      if (!webhookUrl) continue;

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
      reclamadas.push({ notificacion: reservada, webhookUrl });
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
