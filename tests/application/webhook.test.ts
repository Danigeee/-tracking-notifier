// Pruebas de los casos de uso del webhook: configurar, consultar y rotar el secreto.

import { beforeEach, describe, expect, it } from "vitest";
import { WebhookNoConfiguradoError } from "../../src/application/errores";
import { ConfigurarWebhook } from "../../src/application/use-cases/configurar-webhook";
import { ConsultarWebhook } from "../../src/application/use-cases/consultar-webhook";
import { RotarSecretoWebhook } from "../../src/application/use-cases/rotar-secreto-webhook";
import { GeneradorSecretosFalso } from "../support/generador-secretos-falso";
import { WebhookConfigRepositoryEnMemoria } from "../support/webhooks-en-memoria";

// Datos ficticios.
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const URL_1 = "https://cliente-a.example/webhook";
const URL_2 = "https://cliente-a.example/nuevo-webhook";

describe("webhook por tenant", () => {
  let repositorio: WebhookConfigRepositoryEnMemoria;
  let configurar: ConfigurarWebhook;
  let consultar: ConsultarWebhook;
  let rotar: RotarSecretoWebhook;

  // Cada prueba arranca sin ninguna URL configurada.
  beforeEach(() => {
    repositorio = new WebhookConfigRepositoryEnMemoria();
    const generador = new GeneradorSecretosFalso();
    configurar = new ConfigurarWebhook(repositorio, generador);
    consultar = new ConsultarWebhook(repositorio);
    rotar = new RotarSecretoWebhook(repositorio, generador);
  });

  describe("configurar y consultar", () => {
    it("guarda la URL y permite consultarla", async () => {
      const resultado = await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });

      expect(resultado.url).toBe(URL_1);
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

  describe("secreto de firma al configurar", () => {
    it("la primera vez devuelve el secreto y lo deja guardado", async () => {
      const resultado = await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });

      expect(resultado.secreto).toBe("secreto-1");
      expect(repositorio.secretoDe(TENANT_A)).toBe("secreto-1");
    });

    it("las siguientes veces NO devuelve el secreto y conserva el que tenía", async () => {
      await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });

      const segunda = await configurar.ejecutar({ tenantId: TENANT_A, url: URL_2 });

      expect(segunda.secreto).toBeNull();
      expect(repositorio.secretoDe(TENANT_A)).toBe("secreto-1");
    });

    it("cada tenant tiene un secreto distinto", async () => {
      await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });
      await configurar.ejecutar({ tenantId: TENANT_B, url: URL_1 });

      expect(repositorio.secretoDe(TENANT_A)).not.toBe(repositorio.secretoDe(TENANT_B));
    });
  });

  describe("rotar el secreto", () => {
    it("reemplaza el secreto y devuelve el nuevo", async () => {
      await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });

      const nuevo = await rotar.ejecutar({ tenantId: TENANT_A });

      // "secreto-1" se generó al configurar; el de la rotación es el siguiente.
      expect(nuevo).toBe("secreto-2");
      expect(repositorio.secretoDe(TENANT_A)).toBe("secreto-2");
    });

    it("no cambia la URL", async () => {
      await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });

      await rotar.ejecutar({ tenantId: TENANT_A });

      expect(await consultar.ejecutar({ tenantId: TENANT_A })).toBe(URL_1);
    });

    it("falla con WebhookNoConfiguradoError si el tenant no configuró su webhook", async () => {
      await expect(rotar.ejecutar({ tenantId: TENANT_A })).rejects.toThrow(
        WebhookNoConfiguradoError,
      );
    });

    it("solo rota el secreto del tenant indicado", async () => {
      await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });
      await configurar.ejecutar({ tenantId: TENANT_B, url: URL_1 });
      const secretoB = repositorio.secretoDe(TENANT_B);

      await rotar.ejecutar({ tenantId: TENANT_A });

      expect(repositorio.secretoDe(TENANT_B)).toBe(secretoB);
    });

    it("tras rotar, volver a configurar la URL no devuelve ni cambia el secreto", async () => {
      await configurar.ejecutar({ tenantId: TENANT_A, url: URL_1 });
      const rotado = await rotar.ejecutar({ tenantId: TENANT_A });

      const resultado = await configurar.ejecutar({ tenantId: TENANT_A, url: URL_2 });

      expect(resultado.secreto).toBeNull();
      expect(repositorio.secretoDe(TENANT_A)).toBe(rotado);
    });
  });
});
