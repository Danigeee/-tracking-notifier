// Reloj de pruebas: la hora solo cambia cuando la prueba lo indica.

import { Reloj } from "../../src/application/ports/reloj";

export class RelojFijo implements Reloj {
  constructor(private actual: Date = new Date("2026-10-24T12:00:00.000Z")) {}

  ahora(): Date {
    return this.actual;
  }

  /** Avanza el reloj la cantidad de segundos indicada. */
  avanzar(segundos: number): void {
    this.actual = new Date(this.actual.getTime() + segundos * 1000);
  }
}
