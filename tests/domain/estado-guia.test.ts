// Pruebas unitarias de los estados de guía y sus reglas de transición.
// No necesitan base de datos ni servidor: el dominio es lógica pura.

import { describe, expect, it } from "vitest";
import { TransicionInvalidaError } from "../../src/domain/errores";
import {
  ESTADOS_GUIA,
  EstadoGuia,
  esEstadoFinal,
  esEstadoGuia,
  puedeTransicionar,
  validarTransicion,
} from "../../src/domain/estado-guia";

// Transiciones que el negocio permite: [estado actual, estado nuevo].
const TRANSICIONES_VALIDAS: [EstadoGuia, EstadoGuia][] = [
  ["CREADA", "EN_RUTA"],
  ["CREADA", "DEVUELTA"],
  ["EN_RUTA", "ENTREGADA"],
  ["EN_RUTA", "DEVUELTA"],
];

describe("transiciones de estado", () => {
  it.each(TRANSICIONES_VALIDAS)("permite pasar de %s a %s", (actual, nuevo) => {
    expect(puedeTransicionar(actual, nuevo)).toBe(true);
    // validarTransicion no debe lanzar nada cuando la transición es válida.
    expect(() => validarTransicion(actual, nuevo)).not.toThrow();
  });

  it("rechaza todas las demás combinaciones", () => {
    // Se recorre el producto cartesiano completo (4 x 4) y se descartan las válidas.
    // Así, si alguien agrega una transición sin actualizar estas pruebas, falla.
    for (const actual of ESTADOS_GUIA) {
      for (const nuevo of ESTADOS_GUIA) {
        const esValida = TRANSICIONES_VALIDAS.some(([a, n]) => a === actual && n === nuevo);
        expect(puedeTransicionar(actual, nuevo), `${actual} → ${nuevo}`).toBe(esValida);
      }
    }
  });

  it("no permite repetir el mismo estado", () => {
    for (const estado of ESTADOS_GUIA) {
      expect(puedeTransicionar(estado, estado)).toBe(false);
    }
  });

  it("no permite saltar de CREADA a ENTREGADA", () => {
    expect(puedeTransicionar("CREADA", "ENTREGADA")).toBe(false);
  });

  it.each(["ENTREGADA", "DEVUELTA"] as const)("una guía %s ya no cambia de estado", (final) => {
    for (const nuevo of ESTADOS_GUIA) {
      expect(puedeTransicionar(final, nuevo)).toBe(false);
    }
  });

  it("lanza TransicionInvalidaError con los estados involucrados", () => {
    const intento = () => validarTransicion("ENTREGADA", "EN_RUTA");

    expect(intento).toThrow(TransicionInvalidaError);
    try {
      intento();
    } catch (error) {
      const e = error as TransicionInvalidaError;
      expect(e.codigo).toBe("TRANSICION_INVALIDA");
      expect(e.estadoActual).toBe("ENTREGADA");
      expect(e.estadoNuevo).toBe("EN_RUTA");
    }
  });
});

describe("estados finales", () => {
  it("ENTREGADA y DEVUELTA son finales", () => {
    expect(esEstadoFinal("ENTREGADA")).toBe(true);
    expect(esEstadoFinal("DEVUELTA")).toBe(true);
  });

  it("CREADA y EN_RUTA no son finales", () => {
    expect(esEstadoFinal("CREADA")).toBe(false);
    expect(esEstadoFinal("EN_RUTA")).toBe(false);
  });
});

describe("esEstadoGuia", () => {
  it("acepta los cuatro estados definidos", () => {
    for (const estado of ESTADOS_GUIA) {
      expect(esEstadoGuia(estado)).toBe(true);
    }
  });

  it("rechaza valores desconocidos, en minúscula o que no son texto", () => {
    expect(esEstadoGuia("PERDIDA")).toBe(false);
    expect(esEstadoGuia("creada")).toBe(false);
    expect(esEstadoGuia("")).toBe(false);
    expect(esEstadoGuia(null)).toBe(false);
    expect(esEstadoGuia(undefined)).toBe(false);
    expect(esEstadoGuia(1)).toBe(false);
  });
});
