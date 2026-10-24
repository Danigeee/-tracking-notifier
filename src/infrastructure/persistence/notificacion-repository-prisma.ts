// Adaptador de salida: implementa el puerto NotificacionRepository con PostgreSQL (Prisma).

import {
  ConsultaNotificaciones,
  NotificacionRepository,
} from "../../application/ports/notificacion-repository";
import { Notificacion } from "../../domain/notificacion";
import { ClientePrisma } from "./guia-repository-prisma";

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

    return filas.map((fila) =>
      Notificacion.reconstruir({
        tenantId: fila.tenantId,
        guiaId: fila.guiaId,
        evento: {
          eventId: fila.evento.eventId,
          estado: fila.evento.estado,
          fechaEvento: fila.evento.fechaEvento,
          observacion: fila.evento.observacion ?? undefined,
        },
        estado: fila.estado,
        intentos: fila.intentos,
        proximoIntento: fila.proximoIntento,
        ultimoError: fila.ultimoError,
        ultimoCodigoHttp: fila.ultimoCodigoHttp,
        creadaEn: fila.createdAt,
      }),
    );
  }
}
