// Firma HMAC de los avisos enviados al webhook del cliente.
//
// Qué resuelve: el cliente recibe una petición en una URL pública y necesita saber
// que de verdad la envió tracking-notifier y que nadie cambió el contenido por el
// camino. Para eso comparten un secreto: nosotros calculamos con él una firma del
// mensaje y el cliente la recalcula y la compara.
//
// Se firma "<timestamp>.<cuerpo>" y no solo el cuerpo. Con la hora incluida, un
// atacante que capture un aviso no puede reenviarlo más tarde: el cliente puede
// rechazar los que traen una hora demasiado antigua.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Prefijo de la firma: indica el algoritmo usado. */
const PREFIJO = "sha256=";

/**
 * Calcula la firma de un aviso.
 * @param secreto secreto compartido con el cliente
 * @param timestamp momento del envío, en segundos desde 1970 (el mismo que va en X-Timestamp)
 * @param cuerpo texto exacto que se envía (los mismos bytes que recibirá el cliente)
 * @returns la firma en el formato "sha256=<64 caracteres hexadecimales>"
 */
export function calcularFirma(secreto: string, timestamp: number, cuerpo: string): string {
  const hmac = createHmac("sha256", secreto).update(`${timestamp}.${cuerpo}`).digest("hex");
  return `${PREFIJO}${hmac}`;
}

/**
 * Comprueba si una firma recibida es válida. Es lo que hace el sistema del cliente.
 * La comparación es de tiempo constante: no tarda más o menos según cuántos caracteres
 * coincidan, para que no se pueda adivinar la firma probando poco a poco.
 */
export function verificarFirma(
  secreto: string,
  timestamp: number,
  cuerpo: string,
  firmaRecibida: string,
): boolean {
  const esperada = Buffer.from(calcularFirma(secreto, timestamp, cuerpo));
  const recibida = Buffer.from(firmaRecibida);
  // timingSafeEqual exige igual longitud; si difiere, la firma no puede ser válida.
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
