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

  async guardar(tenantId: string, url: string): Promise<void> {
    // upsert: si el tenant existe actualiza su URL; si no, lo crea ya con ella.
    await this.cliente.tenantDb.upsert({
      where: { id: tenantId },
      update: { webhookUrl: url },
      create: { id: tenantId, webhookUrl: url },
    });
  }
}
