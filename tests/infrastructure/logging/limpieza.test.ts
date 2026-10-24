// Pruebas de la limpieza de textos antes de escribirlos en los logs.

import { describe, expect, it } from "vitest";
import { limpiarTexto } from "../../../src/infrastructure/logging/limpieza";

describe("limpiarTexto", () => {
  it("oculta los secretos de firma", () => {
    const secreto = "whsec_" + "a1".repeat(32);

    const limpio = limpiarTexto(`falló con el secreto ${secreto} al firmar`);

    expect(limpio).not.toContain(secreto);
    expect(limpio).toContain("whsec_[oculto]");
  });

  it("oculta URLs completas, con ruta, query y credenciales", () => {
    const texto =
      "no se pudo llamar a https://usuario:clave@cliente.example/avisos/token-secreto?firma=abc y a http://127.0.0.1:4000/hook";

    const limpio = limpiarTexto(texto);

    expect(limpio).not.toContain("cliente.example");
    expect(limpio).not.toContain("token-secreto");
    expect(limpio).not.toContain("clave");
    expect(limpio).not.toContain("127.0.0.1");
    expect(limpio.match(/\[url-oculta\]/g)).toHaveLength(2);
  });

  it("oculta las cadenas de conexión a la base de datos, con su contraseña", () => {
    const limpio = limpiarTexto(
      "no conecta a postgresql://postgres:mi-clave@localhost:5433/tracking_notifier?schema=public",
    );

    expect(limpio).not.toContain("mi-clave");
    expect(limpio).not.toContain("localhost");
    expect(limpio).toContain("[conexion-oculta]");
  });

  it("deja intacto un texto sin datos sensibles", () => {
    const texto = "Unique constraint failed on the fields: (tenant_id, guia_id)";

    expect(limpiarTexto(texto)).toBe(texto);
  });
});
