// Adaptador de salida: implementa el puerto GuiaRepository con PostgreSQL (Prisma).
// Es la única parte del sistema que conoce cómo se guardan las guías.

import { Prisma } from "@prisma/client";
import { GuiaRepository } from "../../application/ports/guia-repository";
import { EventoGuia } from "../../domain/evento-guia";
import { Guia } from "../../domain/guia";

/** Cliente de Prisma, ya sea el normal o el de una transacción en curso. */
export type ClientePrisma = Prisma.TransactionClient;

export class GuiaRepositoryPrisma implements GuiaRepository {
  /**
   * @param cliente cliente de Prisma o de la transacción en curso
   * @param bloquearGuia si es true, `buscar` toma un bloqueo exclusivo sobre la guía
   *        hasta que termine la transacción. Se usa al registrar eventos para que
   *        dos peticiones simultáneas de la misma guía se ejecuten una tras otra.
   */
  constructor(
    private readonly cliente: ClientePrisma,
    private readonly bloquearGuia = false,
  ) {}

  async buscar(tenantId: string, guiaId: string): Promise<Guia | null> {
    if (this.bloquearGuia) {
      // Bloqueo de aviso de PostgreSQL asociado a (tenant, guía). Se libera solo al
      // confirmar o descartar la transacción. Funciona aunque la guía aún no exista,
      // algo que un bloqueo de fila (FOR UPDATE) no puede hacer.
      await this.cliente.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${guiaId}`}, 0))`;
    }

    const fila = await this.cliente.guiaDb.findUnique({
      where: { tenantId_id: { tenantId, id: guiaId } },
      // Los eventos se leen en orden de llegada (= orden cronológico).
      include: { eventos: { orderBy: { secuencia: "asc" } } },
    });
    if (!fila) {
      return null;
    }

    const eventos: EventoGuia[] = fila.eventos.map((e) => ({
      eventId: e.eventId,
      estado: e.estado,
      fechaEvento: e.fechaEvento,
      // La base guarda null cuando no hay observación; el dominio usa "ausente".
      observacion: e.observacion ?? undefined,
    }));
    return Guia.reconstruir(fila.id, fila.tenantId, eventos);
  }

  async guardar(guia: Guia): Promise<void> {
    // El tenant y la guía se crean si no existen. `skipDuplicates` hace que, si ya
    // existen, no pase nada (INSERT ... ON CONFLICT DO NOTHING).
    await this.cliente.tenantDb.createMany({
      data: [{ id: guia.tenantId }],
      skipDuplicates: true,
    });
    await this.cliente.guiaDb.createMany({
      data: [{ tenantId: guia.tenantId, id: guia.id }],
      skipDuplicates: true,
    });

    // Solo se insertan los eventos que todavía no están guardados.
    const guardados = await this.cliente.eventoGuiaDb.findMany({
      where: { tenantId: guia.tenantId, guiaId: guia.id },
      select: { eventId: true },
    });
    const idsGuardados = new Set(guardados.map((e) => e.eventId));
    const nuevos = guia.eventos.filter((e) => !idsGuardados.has(e.eventId));

    if (nuevos.length > 0) {
      await this.cliente.eventoGuiaDb.createMany({
        data: nuevos.map((e) => ({
          tenantId: guia.tenantId,
          guiaId: guia.id,
          eventId: e.eventId,
          estado: e.estado,
          fechaEvento: e.fechaEvento,
          observacion: e.observacion,
        })),
      });
    }
  }
}
