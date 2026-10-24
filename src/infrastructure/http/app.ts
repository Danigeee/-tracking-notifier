// Adaptador de entrada: API HTTP con Express.
// Recibe peticiones, las valida y llama a los casos de uso. No contiene reglas de negocio.

import express, { Express, NextFunction, Request, Response } from "express";
import { ConfigurarWebhook } from "../../application/use-cases/configurar-webhook";
import { ConsultarHistorial } from "../../application/use-cases/consultar-historial";
import { ConsultarNotificaciones } from "../../application/use-cases/consultar-notificaciones";
import { ConsultarWebhook } from "../../application/use-cases/consultar-webhook";
import { RegistrarEvento } from "../../application/use-cases/registrar-evento";
import { RotarSecretoWebhook } from "../../application/use-cases/rotar-secreto-webhook";
import { respuestaNoEncontrada, traducirError } from "./errores-http";
import {
  esquemaConsultaNotificaciones,
  esquemaEvento,
  esquemaGuiaId,
  esquemaTenantId,
  esquemaWebhook,
  validar,
} from "./esquemas";

/** Lo que necesita la API para funcionar. Se inyecta desde fuera (ver main.ts). */
export interface DependenciasApp {
  readonly registrarEvento: Pick<RegistrarEvento, "ejecutar">;
  readonly consultarHistorial: Pick<ConsultarHistorial, "ejecutar">;
  readonly consultarNotificaciones: Pick<ConsultarNotificaciones, "ejecutar">;
  readonly configurarWebhook: Pick<ConfigurarWebhook, "ejecutar">;
  readonly consultarWebhook: Pick<ConsultarWebhook, "ejecutar">;
  readonly rotarSecretoWebhook: Pick<RotarSecretoWebhook, "ejecutar">;
  /** Comprueba que las dependencias externas (base de datos) responden; lanza error si no. */
  readonly comprobarSalud: () => Promise<void>;
  /** Se llama con los errores inesperados (500) para registrarlos. */
  readonly registrarError: (error: unknown) => void;
}

/** Lee y valida la cabecera X-Tenant-Id. Falta o es inválida → ErrorValidacion (400). */
function leerTenantId(req: Request): string {
  return validar(esquemaTenantId, req.header("X-Tenant-Id"), "cabecera X-Tenant-Id");
}

/** Construye la aplicación Express con todas sus rutas. */
export function crearApp(dependencias: DependenciasApp): Express {
  const app = express();
  app.disable("x-powered-by"); // No anunciar la tecnología del servidor.
  app.use(express.json({ limit: "100kb" }));

  // Estado del servicio: verifica la conexión con la base de datos.
  app.get("/health", async (_req, res) => {
    try {
      await dependencias.comprobarSalud();
      res.json({ estado: "ok" });
    } catch (error) {
      dependencias.registrarError(error);
      res.status(503).json({ estado: "no disponible" });
    }
  });

  // Registrar un evento de estado de una guía.
  app.post("/guias/:guiaId/eventos", async (req, res) => {
    const tenantId = leerTenantId(req);
    const guiaId = validar(esquemaGuiaId, req.params["guiaId"], "parámetro guiaId");
    const cuerpo = validar(esquemaEvento, req.body, "cuerpo");

    const { resultado, estadoActual } = await dependencias.registrarEvento.ejecutar({
      tenantId,
      guiaId,
      eventId: cuerpo.eventId,
      estado: cuerpo.estado,
      fechaEvento: new Date(cuerpo.fechaEvento),
      observacion: cuerpo.observacion,
    });

    // 201 si el evento era nuevo; 200 si ya se había recibido (idempotencia).
    const duplicado = resultado === "DUPLICADO";
    res.status(duplicado ? 200 : 201).json({
      eventId: cuerpo.eventId,
      guiaId,
      estadoActual,
      duplicado,
    });
  });

  // Estado actual e historial de una guía.
  app.get("/guias/:guiaId", async (req, res) => {
    const tenantId = leerTenantId(req);
    const guiaId = validar(esquemaGuiaId, req.params["guiaId"], "parámetro guiaId");

    const historial = await dependencias.consultarHistorial.ejecutar({ tenantId, guiaId });

    res.json({
      guiaId: historial.guiaId,
      estadoActual: historial.estadoActual,
      eventos: historial.eventos.map((evento) => ({
        eventId: evento.eventId,
        estado: evento.estado,
        fechaEvento: evento.fechaEvento.toISOString(),
        ...(evento.observacion !== undefined && { observacion: evento.observacion }),
      })),
    });
  });

  // Configurar la URL del webhook del cliente.
  // La primera vez, la respuesta incluye además el secreto de firma: es la única ocasión
  // en que se muestra. En las siguientes configuraciones solo se actualiza la URL.
  app.put("/webhook", async (req, res) => {
    const tenantId = leerTenantId(req);
    const { url } = validar(esquemaWebhook, req.body, "cuerpo");

    const { url: guardada, secreto } = await dependencias.configurarWebhook.ejecutar({
      tenantId,
      url,
    });

    res.json({ url: guardada, ...(secreto !== null && { secreto }) });
  });

  // Consultar la URL del webhook del cliente.
  app.get("/webhook", async (req, res) => {
    const tenantId = leerTenantId(req);

    const url = await dependencias.consultarWebhook.ejecutar({ tenantId });

    res.json({ url });
  });

  // Genera un secreto de firma nuevo. El anterior deja de servir. Se muestra una sola vez.
  app.post("/webhook/secreto", async (req, res) => {
    const tenantId = leerTenantId(req);

    const secreto = await dependencias.rotarSecretoWebhook.ejecutar({ tenantId });

    res.json({ secreto });
  });

  // Notificaciones del cliente, con filtro opcional por estado (por ejemplo ?estado=FALLIDA).
  app.get("/notificaciones", async (req, res) => {
    const tenantId = leerTenantId(req);
    const { estado, limite } = validar(esquemaConsultaNotificaciones, req.query, "parámetro");

    const notificaciones = await dependencias.consultarNotificaciones.ejecutar({
      tenantId,
      estado,
      limite,
    });

    res.json({
      notificaciones: notificaciones.map((n) => ({
        guiaId: n.guiaId,
        eventId: n.eventId,
        estadoGuia: n.evento.estado,
        estado: n.estado,
        intentos: n.intentos,
        proximoIntento: n.proximoIntento.toISOString(),
        ultimoError: n.ultimoError,
        ultimoCodigoHttp: n.ultimoCodigoHttp,
        creadaEn: n.creadaEn.toISOString(),
      })),
    });
  });

  // Cualquier otra ruta: 404 con el formato de error único.
  app.use((_req, res) => {
    const { status, cuerpo } = respuestaNoEncontrada();
    res.status(status).json(cuerpo);
  });

  // Manejador global de errores: Express 5 envía aquí también los errores de los
  // manejadores asíncronos. Debe declararse con 4 parámetros para ser reconocido.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const { status, cuerpo } = traducirError(error);
    if (status === 500) {
      dependencias.registrarError(error);
    }
    res.status(status).json(cuerpo);
  });

  return app;
}
