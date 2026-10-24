// Adaptador de entrada: worker que envía las notificaciones pendientes cada cierto tiempo.
//
// Es un bucle dentro del mismo proceso de la API. Funciona igual que la API: llama a
// un caso de uso. Está pensado para que se puedan ejecutar varias instancias a la vez
// sin enviar la misma notificación dos veces (lo garantiza el repositorio).

import { EnviarNotificacionesPendientes } from "../../application/use-cases/enviar-notificaciones-pendientes";

export class WorkerNotificaciones {
  private temporizador: NodeJS.Timeout | undefined;
  /** Pasada en curso, para poder esperarla al detener el worker. */
  private enCurso: Promise<void> = Promise.resolve();
  private detenido = true;

  /**
   * @param enviar caso de uso que procesa un lote
   * @param intervaloMs espera entre pasadas cuando no hay trabajo acumulado
   * @param tamanoLote tamaño de lote del caso de uso; si una pasada lo llena, hay más
   *        trabajo esperando y la siguiente pasada se hace de inmediato
   * @param registrarError se llama con los errores, para que no se pierdan en silencio
   */
  constructor(
    private readonly enviar: Pick<EnviarNotificacionesPendientes, "ejecutar">,
    private readonly intervaloMs: number,
    private readonly tamanoLote: number,
    private readonly registrarError: (error: unknown) => void,
  ) {}

  /** Arranca el bucle. Si ya estaba arrancado no hace nada. */
  iniciar(): void {
    if (!this.detenido) return;
    this.detenido = false;
    this.programar(0);
  }

  /** Detiene el bucle y espera a que termine la pasada en curso, sin cortarla a la mitad. */
  async detener(): Promise<void> {
    this.detenido = true;
    clearTimeout(this.temporizador);
    await this.enCurso;
  }

  /** Programa la siguiente pasada. */
  private programar(esperaMs: number): void {
    if (this.detenido) return;
    this.temporizador = setTimeout(() => {
      this.enCurso = this.pasada();
    }, esperaMs);
  }

  /** Una pasada: procesa un lote y programa la siguiente. Nunca lanza errores. */
  private async pasada(): Promise<void> {
    let hayMasTrabajo = false;
    try {
      const resumen = await this.enviar.ejecutar();
      resumen.errores.forEach((error) => this.registrarError(error));
      // Un lote lleno indica que puede haber más pendientes: no se espera el intervalo.
      hayMasTrabajo = resumen.procesadas >= this.tamanoLote;
    } catch (error) {
      this.registrarError(error);
    }
    // El siguiente turno se programa al terminar, así dos pasadas nunca se solapan.
    this.programar(hayMasTrabajo ? 0 : this.intervaloMs);
  }
}
