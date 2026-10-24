// Raíz de composición de la aplicación.
//
// Es el único lugar que conoce todas las piezas: crea los adaptadores
// concretos (PostgreSQL, HTTP) y los conecta con los casos de uso.

import { PrismaClient } from "@prisma/client";
import { ConfigurarWebhook } from "./application/use-cases/configurar-webhook";
import { ConsultarHistorial } from "./application/use-cases/consultar-historial";
import { ConsultarNotificaciones } from "./application/use-cases/consultar-notificaciones";
import { ConsultarWebhook } from "./application/use-cases/consultar-webhook";
import { EnviarNotificacionesPendientes } from "./application/use-cases/enviar-notificaciones-pendientes";
import { RegistrarEvento } from "./application/use-cases/registrar-evento";
import { RotarSecretoWebhook } from "./application/use-cases/rotar-secreto-webhook";
import { cargarConfig } from "./config/config";
import { crearApp } from "./infrastructure/http/app";
import { RegistradorPino } from "./infrastructure/logging/registrador-pino";
import { GuiaRepositoryPrisma } from "./infrastructure/persistence/guia-repository-prisma";
import { NotificacionRepositoryPrisma } from "./infrastructure/persistence/notificacion-repository-prisma";
import { UnidadDeTrabajoPrisma } from "./infrastructure/persistence/unidad-de-trabajo-prisma";
import { WebhookConfigRepositoryPrisma } from "./infrastructure/persistence/webhook-config-repository-prisma";
import { RelojSistema } from "./infrastructure/reloj/reloj-sistema";
import { ClienteWebhookHttp } from "./infrastructure/webhook/cliente-webhook-http";
import { GeneradorSecretosCrypto } from "./infrastructure/webhook/generador-secretos-crypto";
import { WorkerNotificaciones } from "./infrastructure/worker/worker-notificaciones";

const config = cargarConfig();

// Adaptadores de salida: logs, base de datos y reloj.
const registrador = new RegistradorPino(config.nivelLog);
const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
const reloj = new RelojSistema();

// Casos de uso, conectados a sus puertos.
const registrarEvento = new RegistrarEvento(new UnidadDeTrabajoPrisma(prisma), reloj, registrador);
const consultarHistorial = new ConsultarHistorial(new GuiaRepositoryPrisma(prisma));
const notificaciones = new NotificacionRepositoryPrisma(prisma);
const consultarNotificaciones = new ConsultarNotificaciones(notificaciones);
const enviarNotificaciones = new EnviarNotificacionesPendientes(
  notificaciones,
  new ClienteWebhookHttp(config.webhookTimeoutMs, reloj),
  reloj,
  registrador,
  { tamanoLote: config.workerTamanoLote },
);
const webhooks = new WebhookConfigRepositoryPrisma(prisma);
const generadorSecretos = new GeneradorSecretosCrypto();
const configurarWebhook = new ConfigurarWebhook(webhooks, generadorSecretos);
const rotarSecretoWebhook = new RotarSecretoWebhook(webhooks, generadorSecretos);
const consultarWebhook = new ConsultarWebhook(webhooks);

// Adaptador de entrada: API HTTP.
const app = crearApp({
  registrarEvento,
  consultarHistorial,
  consultarNotificaciones,
  configurarWebhook,
  consultarWebhook,
  rotarSecretoWebhook,
  comprobarSalud: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  registrador,
});

// Adaptador de entrada: worker que envía las notificaciones pendientes.
const worker = new WorkerNotificaciones(
  enviarNotificaciones,
  config.workerIntervaloMs,
  config.workerTamanoLote,
  registrador,
);

const servidor = app.listen(config.puerto, () => {
  registrador.info("servicio iniciado", {
    puerto: config.puerto,
    nivelLog: config.nivelLog,
    workerIntervaloMs: config.workerIntervaloMs,
  });
});
worker.iniciar();

// Apagado ordenado: deja de aceptar peticiones, deja que el worker termine el envío
// en curso y cierra la conexión a la base.
async function apagar(): Promise<void> {
  registrador.info("servicio deteniéndose");
  servidor.close();
  await worker.detener();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", apagar);
process.on("SIGTERM", apagar);
