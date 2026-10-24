// Adaptador de salida: implementa el puerto GeneradorSecretos con el generador
// criptográfico del sistema operativo.

import { randomBytes } from "node:crypto";
import { GeneradorSecretos } from "../../application/ports/generador-secretos";

export class GeneradorSecretosCrypto implements GeneradorSecretos {
  /**
   * Devuelve "whsec_" seguido de 64 caracteres hexadecimales (32 bytes aleatorios,
   * 256 bits). El prefijo permite reconocer a simple vista qué es el valor.
   */
  generar(): string {
    return `whsec_${randomBytes(32).toString("hex")}`;
  }
}
