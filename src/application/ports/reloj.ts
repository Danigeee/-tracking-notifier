// Puerto de salida: reloj.
//
// El dominio y los casos de uso no leen la hora del sistema directamente: la
// piden a través de este puerto. Así las pruebas pueden fijar la hora y no
// dependen de cuándo se ejecutan.

export interface Reloj {
  /** Momento actual. */
  ahora(): Date;
}
