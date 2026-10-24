// Pruebas de la firma HMAC de los avisos.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { calcularFirma, verificarFirma } from "../../../src/infrastructure/webhook/firma";

const SECRETO = "whsec_secreto-de-prueba";
const TIMESTAMP = 1_793_000_000;
const CUERPO = '{"eventId":"7c9e6679-7425-40de-944b-e07fc1f90ae7","estado":"CREADA"}';

describe("calcularFirma", () => {
  it('tiene el formato "sha256=" seguido de 64 caracteres hexadecimales', () => {
    expect(calcularFirma(SECRETO, TIMESTAMP, CUERPO)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("coincide con el HMAC-SHA256 estándar de '<hora>.<cuerpo>'", () => {
    // Cálculo independiente, hecho directamente con la librería de Node.
    const esperado = createHmac("sha256", SECRETO).update(`${TIMESTAMP}.${CUERPO}`).digest("hex");

    expect(calcularFirma(SECRETO, TIMESTAMP, CUERPO)).toBe(`sha256=${esperado}`);
  });

  it("es reproducible: mismos datos, misma firma", () => {
    expect(calcularFirma(SECRETO, TIMESTAMP, CUERPO)).toBe(calcularFirma(SECRETO, TIMESTAMP, CUERPO));
  });

  it("cambia si cambia un solo carácter del cuerpo", () => {
    const original = calcularFirma(SECRETO, TIMESTAMP, CUERPO);

    expect(calcularFirma(SECRETO, TIMESTAMP, CUERPO.replace("CREADA", "CREADB"))).not.toBe(original);
  });

  it("cambia si cambia la hora", () => {
    expect(calcularFirma(SECRETO, TIMESTAMP + 1, CUERPO)).not.toBe(
      calcularFirma(SECRETO, TIMESTAMP, CUERPO),
    );
  });

  it("cambia si cambia el secreto", () => {
    expect(calcularFirma("otro-secreto", TIMESTAMP, CUERPO)).not.toBe(
      calcularFirma(SECRETO, TIMESTAMP, CUERPO),
    );
  });

  it("no se puede mover la hora al cuerpo para obtener la misma firma", () => {
    // Si se firmara sin separador, "12" + "3.cuerpo" y "123" + ".cuerpo" serían ambiguos.
    expect(calcularFirma(SECRETO, 12, "3.x")).not.toBe(calcularFirma(SECRETO, 123, "x"));
  });
});

describe("verificarFirma", () => {
  const firma = calcularFirma(SECRETO, TIMESTAMP, CUERPO);

  it("acepta una firma correcta", () => {
    expect(verificarFirma(SECRETO, TIMESTAMP, CUERPO, firma)).toBe(true);
  });

  it("rechaza si el cuerpo fue alterado", () => {
    expect(verificarFirma(SECRETO, TIMESTAMP, CUERPO + " ", firma)).toBe(false);
  });

  it("rechaza si la hora fue alterada", () => {
    expect(verificarFirma(SECRETO, TIMESTAMP + 1, CUERPO, firma)).toBe(false);
  });

  it("rechaza si el secreto es otro", () => {
    expect(verificarFirma("otro-secreto", TIMESTAMP, CUERPO, firma)).toBe(false);
  });

  it("rechaza firmas mal formadas sin lanzar error", () => {
    expect(verificarFirma(SECRETO, TIMESTAMP, CUERPO, "")).toBe(false);
    expect(verificarFirma(SECRETO, TIMESTAMP, CUERPO, "sha256=abc")).toBe(false);
    expect(verificarFirma(SECRETO, TIMESTAMP, CUERPO, firma + "00")).toBe(false);
    expect(verificarFirma(SECRETO, TIMESTAMP, CUERPO, "x".repeat(firma.length))).toBe(false);
  });
});
