// Generador de secretos de pruebas: devuelve valores predecibles y distintos en cada llamada.

import { GeneradorSecretos } from "../../src/application/ports/generador-secretos";

export class GeneradorSecretosFalso implements GeneradorSecretos {
  private contador = 0;

  /** Devuelve "secreto-1", "secreto-2", y así sucesivamente. */
  generar(): string {
    this.contador++;
    return `secreto-${this.contador}`;
  }
}
