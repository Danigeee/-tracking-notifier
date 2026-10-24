// Pruebas del generador de secretos real.

import { describe, expect, it } from "vitest";
import { GeneradorSecretosCrypto } from "../../../src/infrastructure/webhook/generador-secretos-crypto";

describe("GeneradorSecretosCrypto", () => {
  const generador = new GeneradorSecretosCrypto();

  it('empieza con "whsec_" y sigue con 64 caracteres hexadecimales', () => {
    expect(generador.generar()).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it("genera un valor distinto en cada llamada", () => {
    const secretos = new Set(Array.from({ length: 1000 }, () => generador.generar()));

    expect(secretos.size).toBe(1000);
  });
});
