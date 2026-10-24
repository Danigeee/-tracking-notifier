// Adaptador de salida: implementa el puerto NotificacionRepository con PostgreSQL (Prisma).

import {
  ConsultaNotificaciones,
  NotificacionPorEnviar,
  NotificacionRepository,
  ReclamoNotificaciones,
} from "../../application/ports/notificacion-repository";
import { Notificacion } from "../../domain/notificacion";
import { Prisma } from "@prisma/client";
import { ClientePrisma } from "./guia-repository-prisma";

/** Fila de notificación leída junto con su evento. */
type NotificacionConEvento = Prisma.NotificacionDbGetPayload<{ include: { evento: true } }>;

export class NotificacionRepositoryPrisma implements NotificacionRepository {
  constructor(private readonly cliente: ClientePrisma) {}

  async crear(notificacion: Notificacion): Promise<void> {
    await this.cliente.notificacionDb.create({
      data: {
        tenantId: notificacion.tenantId,
        guiaId: notificacion.guiaId,
        eventId: notificacion.eventId,
        estado: notificacion.estado,
        intentos: notificacion.intentos,
        proximoIntento: notificacion.proximoIntento,
        ultimoError: notificacion.ultimoError,
        ultimoCodigoHttp: notificacion.ultimoCodigoHttp,
        createdAt: notificacion.creadaEn,
      },
    });
  }

  async listar(consulta: ConsultaNotificaciones): Promise<Notificacion[]> {
    const filas = await this.cliente.notificacionDb.findMany({
      // Siempre se filtra por tenant: nunca se devuelven notificaciones de otro cliente.
      where: {
        tenantId: consulta.tenantId,
        ...(consulta.estado && { estado: consulta.estado }),
      },
      orderBy: { createdAt: "desc" },
      take: consulta.limite,
      include: { evento: true },
    });

    return filas.map(aNotificacion);
  }

  async reclamarPorEnviar(reclamo: ReclamoNotificaciones): Promise<NotificacionPorEnviar[]> {
    // Una sola sentencia atómica: elige las notificaciones vencidas y las reserva moviendo
    // su próximo intento al final de la reserva.
    //  - FOR UPDATE SKIP LOCKED: si otra instancia está reclamando a la vez, se salta las
    //    filas que ya tiene bloqueadas, así nunca se entrega la misma a dos instancias.
    //  - El JOIN con tenants descarta a los clientes sin webhook dentro de la propia
    //    subconsulta; si se filtrara después, esas filas ocuparían el LIMIT y bloquearían
    //    a los demás clientes.
    const reclamadas = await this.cliente.$queryRaw<
      {
        tenant_id: string;
        guia_id: string;
        event_id: string;
        webhook_url: string;
        webhook_secret: string;
      }[]
    >`
      UPDATE notificaciones AS n
      SET proximo_intento = ${reclamo.reservarHasta}::timestamptz,
          updated_at = ${reclamo.ahora}::timestamptz
      FROM tenants AS t
      WHERE t.id = n.tenant_id
        AND (n.tenant_id, n.guia_id, n.event_id) IN (
          SELECT n2.tenant_id, n2.guia_id, n2.event_id
          FROM notificaciones AS n2
          JOIN tenants AS t2 ON t2.id = n2.tenant_id
          WHERE n2.estado = 'PENDIENTE'
            AND n2.proximo_intento <= ${reclamo.ahora}::timestamptz
            AND t2.webhook_url IS NOT NULL
            AND t2.webhook_secret IS NOT NULL
          ORDER BY n2.proximo_intento
          LIMIT ${reclamo.limite}
          FOR UPDATE OF n2 SKIP LOCKED
        )
      RETURNING n.tenant_id, n.guia_id, n.event_id, t.webhook_url, t.webhook_secret`;

    if (reclamadas.length === 0) {
      return [];
    }

    // Se leen los datos completos de las reclamadas (incluido el evento a notificar).
    const filas = await this.cliente.notificacionDb.findMany({
      where: {
        OR: reclamadas.map((r) => ({ tenantId: r.tenant_id, guiaId: r.guia_id, eventId: r.event_id })),
      },
      include: { evento: true },
    });
    const destinos = new Map(
      reclamadas.map((r) => [
        `${r.tenant_id}|${r.guia_id}|${r.event_id}`,
        { url: r.webhook_url, secreto: r.webhook_secret },
      ]),
    );

    return filas.map((fila) => {
      const destino = destinos.get(`${fila.tenantId}|${fila.guiaId}|${fila.eventId}`)!;
      return {
        notificacion: aNotificacion(fila),
        webhookUrl: destino.url,
        webhookSecreto: destino.secreto,
      };
    });
  }

  async guardar(notificacion: Notificacion): Promise<void> {
    await this.cliente.notificacionDb.update({
      where: {
        tenantId_guiaId_eventId: {
          tenantId: notificacion.tenantId,
          guiaId: notificacion.guiaId,
          eventId: notificacion.eventId,
        },
      },
      data: {
        estado: notificacion.estado,
        intentos: notificacion.intentos,
        proximoIntento: notificacion.proximoIntento,
        ultimoError: notificacion.ultimoError,
        ultimoCodigoHttp: notificacion.ultimoCodigoHttp,
      },
    });
  }
}

/** Fila de la base de datos (con su evento) → entidad del dominio. */
function aNotificacion(fila: NotificacionConEvento): Notificacion {
  return Notificacion.reconstruir({
    tenantId: fila.tenantId,
    guiaId: fila.guiaId,
    evento: {
      eventId: fila.evento.eventId,
      estado: fila.evento.estado,
      fechaEvento: fila.evento.fechaEvento,
      // La base guarda null cuando no hay observación; el dominio usa "ausente".
      observacion: fila.evento.observacion ?? undefined,
    },
    estado: fila.estado,
    intentos: fila.intentos,
    proximoIntento: fila.proximoIntento,
    ultimoError: fila.ultimoError,
    ultimoCodigoHttp: fila.ultimoCodigoHttp,
    creadaEn: fila.createdAt,
  });
}
