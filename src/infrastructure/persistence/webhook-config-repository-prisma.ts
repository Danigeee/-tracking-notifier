// Adaptador de salida: implementa el puerto WebhookConfigRepository con PostgreSQL (Prisma).

import { WebhookConfigRepository } from "../../application/ports/webhook-config-repository";
import { ClientePrisma } from "./guia-repository-prisma";

export class WebhookConfigRepositoryPrisma implements WebhookConfigRepository {
  constructor(private readonly cliente: ClientePrisma) {}

  async obtener(tenantId: string): Promise<string | null> {
    const tenant = await this.cliente.tenantDb.findUnique({
      where: { id: tenantId },
      select: { webhookUrl: true },
    });
    // Un tenant inexistente y uno sin URL son lo mismo para quien consulta: sin configurar.
    return tenant?.webhookUrl ?? null;
  }

  async guardar(tenantId: string, url: string, secretoInicial: string): Promise<string> {
    // Una sola sentencia atómica:
    //  - Si el tenant no existe, lo crea con la URL y el secreto.
    //  - Si existe, actualiza la URL y conserva su secreto (COALESCE usa el que ya tenía
    //    y solo recurre al nuevo si no tenía ninguno).
    // Devuelve el secreto que quedó, para saber si este llamado fue quien lo creó.
    const filas = await this.cliente.$queryRaw<{ webhook_secret: string }[]>`
      INSERT INTO tenants (id, webhook_url, webhook_secret, created_at)
      VALUES (${tenantId}, ${url}, ${secretoInicial}, now())
      ON CONFLICT (id) DO UPDATE
        SET webhook_url = EXCLUDED.webhook_url,
            webhook_secret = COALESCE(tenants.webhook_secret, EXCLUDED.webhook_secret)
      RETURNING webhook_secret`;
    return filas[0]!.webhook_secret;
  }

  async rotarSecreto(tenantId: string, secretoNuevo: string): Promise<boolean> {
    // Solo se rota si el tenant ya configuró su webhook. Devuelve cuántas filas cambió.
    const cambiadas = await this.cliente.$executeRaw`
      UPDATE tenants
      SET webhook_secret = ${secretoNuevo}
      WHERE id = ${tenantId} AND webhook_url IS NOT NULL`;
    return cambiadas > 0;
  }
}
