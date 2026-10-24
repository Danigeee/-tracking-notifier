// Apoyos compartidos por las pruebas de integración.
// Aquí se ensamblan las piezas REALES (repositorios de PostgreSQL, cliente HTTP, reloj
// del sistema), sin dobles de prueba salvo el registrador de logs.

import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { inject } from "vitest";
import { ConfigurarWebhook } from "../../../src/application/use-cases/configurar-webhook";
import { ConsultarHistorial } from "../../../src/application/use-cases/consultar-historial";
import { ConsultarNotificaciones } from "../../../src/application/use-cases/consultar-notificaciones";
import { ConsultarWebhook } from "../../../src/application/use-cases/consultar-webhook";
import {
  EnviarNotificacionesPendientes,
  OpcionesEnvio,
} from "../../../src/application/use-cases/enviar-notificaciones-pendientes";
import { RegistrarEvento } from "../../../src/application/use-cases/registrar-evento";
import { RotarSecretoWebhook } from "../../../src/application/use-cases/rotar-secreto-webhook";
import { EstadoGuia } from "../../../src/domain/estado-guia";
import { EventoGuia } from "../../../src/domain/evento-guia";
import { Guia } from "../../../src/domain/guia";
import { Notificacion } from "../../../src/domain/notificacion";
import { GuiaRepositoryPrisma } from "../../../src/infrastructure/persistence/guia-repository-prisma";
import { NotificacionRepositoryPrisma } from "../../../src/infrastructure/persistence/notificacion-repository-prisma";
import { UnidadDeTrabajoPrisma } from "../../../src/infrastructure/persistence/unidad-de-trabajo-prisma";
import { WebhookConfigRepositoryPrisma } from "../../../src/infrastructure/persistence/webhook-config-repository-prisma";
import { RelojSistema } from "../../../src/infrastructure/reloj/reloj-sistema";
import { ClienteWebhookHttp } from "../../../src/infrastructure/webhook/cliente-webhook-http";
import { GeneradorSecretosCrypto } from "../../../src/infrastructure/webhook/generador-secretos-crypto";
import { RegistradorEnMemoria } from "../../support/registrador-en-memoria";

/** Cliente de Prisma conectado a la base temporal de esta ejecución. */
export function crearPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: inject("databaseUrl") });
}

/** Identificador único, para que cada prueba use sus propios tenants y no se mezclen. */
export function tenantUnico(prefijo = "tenant"): string {
  return `${prefijo}-${randomBytes(4).toString("hex")}`;
}

/** Evento de prueba; `minuto` desplaza la fecha para ordenarlos. */
export function evento(
  eventId: string,
  estado: EstadoGuia,
  minuto: number,
  observacion?: string,
): EventoGuia {
  return {
    eventId,
    estado,
    fechaEvento: new Date(Date.UTC(2026, 9, 24, 10, minuto)),
    observacion,
  };
}

/** Todas las piezas reales de la aplicación, conectadas a una base de datos. */
export function ensamblar(prisma: PrismaClient, opcionesEnvio: Partial<OpcionesEnvio> = {}) {
  const registrador = new RegistradorEnMemoria();
  const reloj = new RelojSistema();
  const unidadDeTrabajo = new UnidadDeTrabajoPrisma(prisma);
  const guias = new GuiaRepositoryPrisma(prisma);
  const notificaciones = new NotificacionRepositoryPrisma(prisma);
  const webhooks = new WebhookConfigRepositoryPrisma(prisma);
  const generadorSecretos = new GeneradorSecretosCrypto();

  return {
    registrador,
    reloj,
    unidadDeTrabajo,
    guias,
    notificaciones,
    webhooks,
    registrarEvento: new RegistrarEvento(unidadDeTrabajo, reloj, registrador),
    consultarHistorial: new ConsultarHistorial(guias),
    consultarNotificaciones: new ConsultarNotificaciones(notificaciones),
    configurarWebhook: new ConfigurarWebhook(webhooks, generadorSecretos),
    consultarWebhook: new ConsultarWebhook(webhooks),
    rotarSecretoWebhook: new RotarSecretoWebhook(webhooks, generadorSecretos),
    enviarNotificaciones: new EnviarNotificacionesPendientes(
      notificaciones,
      new ClienteWebhookHttp(2000, reloj),
      reloj,
      registrador,
      opcionesEnvio,
    ),
  };
}

/** Cuántas filas hay de una guía en cada tabla. */
export async function contar(prisma: PrismaClient, tenantId: string, guiaId: string) {
  const [guias, eventos, notificaciones] = await Promise.all([
    prisma.guiaDb.count({ where: { tenantId, id: guiaId } }),
    prisma.eventoGuiaDb.count({ where: { tenantId, guiaId } }),
    prisma.notificacionDb.count({ where: { tenantId, guiaId } }),
  ]);
  return { guias, eventos, notificaciones };
}

/**
 * Crea `cantidad` guías con un evento CREADA y su notificación pendiente, directamente
 * en la base. `venceEn` fija desde cuándo está lista para enviarse (por defecto, ya).
 */
export async function sembrarNotificaciones(
  prisma: PrismaClient,
  tenantId: string,
  cantidad: number,
  prefijo: string,
  venceEn: Date = new Date(),
): Promise<string[]> {
  const unidadDeTrabajo = new UnidadDeTrabajoPrisma(prisma);
  const eventIds: string[] = [];
  for (let i = 0; i < cantidad; i++) {
    const e = evento(`${prefijo}-${i}`, "CREADA", 0);
    eventIds.push(e.eventId);
    await unidadDeTrabajo.ejecutar(async ({ guias, notificaciones }) => {
      await guias.guardar(Guia.iniciar(`G-${prefijo}-${i}`, tenantId, e));
      await notificaciones.crear(Notificacion.crear(tenantId, `G-${prefijo}-${i}`, e, venceEn));
    });
  }
  return eventIds;
}

/** Una petición recibida por el receptor de prueba. */
export interface PeticionRecibida {
  readonly cabeceras: IncomingMessage["headers"];
  readonly cuerpo: string;
}

/** Servidor HTTP local que hace de "sistema del cliente" y registra lo que recibe. */
export interface Receptor {
  /** Dirección a la que apuntar el webhook. */
  readonly url: string;
  readonly recibidas: PeticionRecibida[];
  /** Cuántas veces llegó cada evento (por X-Event-Id). */
  llegadasPorEvento(): Map<string, number>;
  cerrar(): Promise<void>;
}

/**
 * Levanta un receptor en un puerto libre.
 * @param responder decide el código de respuesta de cada petición (por defecto, 200)
 */
export async function crearReceptor(
  responder: (numeroDePeticion: number, req: IncomingMessage) => number = () => 200,
): Promise<Receptor> {
  const recibidas: PeticionRecibida[] = [];
  const servidor: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let cuerpo = "";
    req.on("data", (trozo) => (cuerpo += trozo));
    req.on("end", () => {
      recibidas.push({ cabeceras: req.headers, cuerpo });
      res.writeHead(responder(recibidas.length, req)).end();
    });
  });
  // El puerto 0 pide al sistema operativo uno libre.
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const puerto = (servidor.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${puerto}/hook`,
    recibidas,
    llegadasPorEvento() {
      const conteo = new Map<string, number>();
      for (const r of recibidas) {
        const id = String(r.cabeceras["x-event-id"]);
        conteo.set(id, (conteo.get(id) ?? 0) + 1);
      }
      return conteo;
    },
    async cerrar() {
      servidor.closeAllConnections();
      await new Promise((resolver) => servidor.close(resolver));
    },
  };
}
