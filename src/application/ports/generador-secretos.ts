// Puerto de salida: generador de secretos.
//
// La aplicación necesita secretos aleatorios (para firmar los avisos) pero no sabe
// cómo se generan: eso lo decide la infraestructura. Así los casos de uso se pueden
// probar con secretos conocidos.

export interface GeneradorSecretos {
  /** Genera un secreto nuevo, aleatorio e impredecible. */
  generar(): string;
}
