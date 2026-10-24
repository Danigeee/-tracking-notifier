// Limpieza de textos antes de escribirlos en los logs.
//
// Los textos de errores que vienen de librerías (base de datos, red) no los controlamos:
// podrían incluir, sin que lo sepamos, una URL con credenciales o un secreto. Como última
// barrera, estos patrones se ocultan antes de que el texto llegue al log.

/** Secretos de firma de los webhooks: "whsec_" y su valor. */
const PATRON_SECRETO = /whsec_[0-9a-zA-Z]+/g;

/** Cualquier URL http o https, que puede llevar usuario, contraseña, tokens en la ruta o en la query. */
const PATRON_URL = /https?:\/\/[^\s"'<>)]+/gi;

/** Cadenas de conexión a bases de datos, que incluyen la contraseña. */
const PATRON_CONEXION_BD = /postgres(?:ql)?:\/\/[^\s"'<>)]+/gi;

/**
 * Oculta secretos, URLs y cadenas de conexión dentro de un texto.
 * Se aplica a mensajes y trazas de errores.
 */
export function limpiarTexto(texto: string): string {
  return texto
    .replace(PATRON_SECRETO, "whsec_[oculto]")
    .replace(PATRON_CONEXION_BD, "[conexion-oculta]")
    .replace(PATRON_URL, "[url-oculta]");
}
