// Raíz de composición de la aplicación.
//
// Es el único lugar que conoce todas las piezas: crea los adaptadores
// concretos (PostgreSQL, HTTP) y los conecta con los casos de uso.

import { PrismaClient } from "@prisma/client";
import { ConfigurarWebhook } from "./application/use-cases/configurar-webhook";
import { ConsultarHistorial } from "./application/use-cases/consultar-historial";
import { ConsultarWebhook } from "./application/use-cases/consultar-webhook";
import { RegistrarEvento } from "./application/use-cases/registrar-evento";
import { cargarConfig } from "./config/config";
import { crearApp } from "./infrastructure/http/app";
import { GuiaRepositoryPrisma } from "./infrastructure/persistence/guia-repository-prisma";
import { UnidadDeTrabajoPrisma } from "./infrastructure/persistence/unidad-de-trabajo-prisma";
import { WebhookConfigRepositoryPrisma } from "./infrastructure/persistence/webhook-config-repository-prisma";

const config = cargarConfig();

// Adaptadores de salida: base de datos.
const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });

// Casos de uso, conectados a sus puertos.
const registrarEvento = new RegistrarEvento(new UnidadDeTrabajoPrisma(prisma));
const consultarHistorial = new ConsultarHistorial(new GuiaRepositoryPrisma(prisma));
const webhooks = new WebhookConfigRepositoryPrisma(prisma);
const configurarWebhook = new ConfigurarWebhook(webhooks);
const consultarWebhook = new ConsultarWebhook(webhooks);

// Adaptador de entrada: API HTTP.
const app = crearApp({
  registrarEvento,
  consultarHistorial,
  configurarWebhook,
  consultarWebhook,
  comprobarSalud: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  // Provisional: en una fase posterior se reemplaza por logs estructurados.
  registrarError: (error) => console.error("Error inesperado", error),
});

const servidor = app.listen(config.puerto, () => {
  console.log(`tracking-notifier escuchando en el puerto ${config.puerto}`);
});

// Apagado ordenado: deja de aceptar peticiones y cierra la conexión a la base.
async function apagar(): Promise<void> {
  servidor.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);
