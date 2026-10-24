// Registrador de pruebas: guarda los logs en una lista para poder comprobarlos.

import { DatosLog, Registrador } from "../../src/application/ports/registrador";

/** Una línea de log capturada. */
export interface EntradaLog {
  readonly nivel: "debug" | "info" | "warn" | "error";
  readonly mensaje: string;
  readonly datos: DatosLog;
  /** Error asociado, si se pasó uno. */
  readonly error?: unknown;
}

export class RegistradorEnMemoria implements Registrador {
  /** Todas las entradas, en orden. */
  readonly entradas: EntradaLog[] = [];

  debug(mensaje: string, datos: DatosLog = {}): void {
    this.entradas.push({ nivel: "debug", mensaje, datos });
  }

  info(mensaje: string, datos: DatosLog = {}): void {
    this.entradas.push({ nivel: "info", mensaje, datos });
  }

  warn(mensaje: string, datos: DatosLog = {}): void {
    this.entradas.push({ nivel: "warn", mensaje, datos });
  }

  error(mensaje: string, datos: DatosLog = {}, error?: unknown): void {
    this.entradas.push({ nivel: "error", mensaje, datos, error });
  }

  /** Entradas con ese mensaje exacto. */
  con(mensaje: string): EntradaLog[] {
    return this.entradas.filter((e) => e.mensaje === mensaje);
  }

  /** Todo lo registrado, como un único texto. Sirve para comprobar que algo NO aparece. */
  comoTexto(): string {
    return JSON.stringify(this.entradas, (_clave, valor) =>
      valor instanceof Error ? { name: valor.name, message: valor.message, stack: valor.stack } : valor,
    );
  }
}
