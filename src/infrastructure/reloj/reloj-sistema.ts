// Adaptador de salida: reloj real basado en la hora del sistema.

import { Reloj } from "../../application/ports/reloj";

export class RelojSistema implements Reloj {
  ahora(): Date {
    return new Date();
  }
}
