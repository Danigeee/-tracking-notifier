// Política de reintentos del envío de notificaciones.

/** Reglas de reintento: cuántos intentos se hacen y cuánto se espera entre ellos. */
export interface PoliticaReintentos {
  /** Intentos totales (el inicial más los reintentos). Al agotarlos la notificación queda FALLIDA. */
  readonly maxIntentos: number;
  /**
   * Espera, en segundos, antes del siguiente intento. La posición 0 es la espera
   * después del primer intento fallido, la 1 después del segundo, y así sucesivamente.
   * Debe tener `maxIntentos - 1` elementos.
   */
  readonly esperasSegundos: readonly number[];
}

/**
 * Política por defecto: 5 intentos en total, con espera creciente de
 * 10 segundos, 1 minuto, 5 minutos y 30 minutos entre ellos.
 */
export const POLITICA_REINTENTOS_POR_DEFECTO: PoliticaReintentos = {
  maxIntentos: 5,
  esperasSegundos: [10, 60, 300, 1800],
};
