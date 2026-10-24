// Pruebas de los casos de uso ConfigurarWebhook y ConsultarWebhook.

import { beforeEach, describe, expect, it } from "vitest";
import { WebhookNoConfiguradoError } from "../../src/application/errores";
import { ConfigurarWebhook } from "../../src/application/use-cases/configurar-webhook";
import { ConsultarWebhook } from "../../src/application/use-cases/consultar-webhook";
import { WebhookConfigRepositoryEnMemoria } from "../support/webhooks-en-memoria";

// Datos ficticios.
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const URL_1 = "https://cliente-a.example/webhook";
const URL_2 = "https://cliente-a.example/nuevo-webhook";

describe("webhook por tenant", () => {
  let configurar: ConfigurarWebhook;
  let consultar: ConsultarWebhook;

  // Cada prueba arranca sin ninguna URL configurada.
  beforeEach(() => {
    const repositorio = new WebhookConfigRepositoryEnMemoria();
    configurar = new ConfigurarWebhook(repositorio);
    consultar = new ConsultarWebhook(repositorio);
  });

  it("guarda la URL y permite consultarla", async () => {
    const guardada = await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });

    expect(guardada).toBe(URL_1);
    expect(await consultar.ejecutar({ tenantId: TENANT_A })).toBe(URL_1);
  });

  it("reemplaza la URL anterior al configurar de nuevo", async () => {
    await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });
    await configurar.ejecutar({ tenantId: TENANT_A, url: URL_2 });

    expect(await consultar.ejecutar({ tenantId: TENANT_A })).toBe(URL_2);
  });

  it("falla con WebhookNoConfiguradoError si el tenant no configuró ninguna", async () => {
    await expect(consultar.ejecutar({ tenantId: TENANT_A })).rejects.toThrow(
      WebhookNoConfiguradoError,
    );
  });

  it("cada tenant tiene su propia URL", async () => {
    await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });

    // El tenant B no ve la URL del tenant A.
    await expect(consultar.ejecutar({ tenantId: TENANT_B })).rejects.toThrow(
      WebhookNoConfiguradoError,
    );
  });
});
