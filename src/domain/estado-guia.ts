// Estados de una guía de envío y las reglas para pasar de uno a otro.
//
// Este archivo pertenece al dominio: no importa ningún framework, ORM ni
// librería externa. Solo lógica de negocio pura.

import { TransicionInvalidaError } from "./errores";

/**
 * Lista de todos los estados posibles de una guía.
 * Se declara como constante para poder usarla tanto como tipo (más abajo)
 * como valor en tiempo de ejecución (por ejemplo, para validar la entrada).
 */
export const ESTADOS_GUIA = ["CREADA", "EN_RUTA", "ENTREGADA", "DEVUELTA"] as const;

/** Tipo unión de los estados válidos: "CREADA" | "EN_RUTA" | "ENTREGADA" | "DEVUELTA". */
export type EstadoGuia = (typeof ESTADOS_GUIA)[number];

/**
 * Tabla de transiciones permitidas: para cada estado, a qué estados se puede pasar.
 *
 *   CREADA ──► EN_RUTA ──► ENTREGADA   (final)
 *      │          │
 *      │          └──────► DEVUELTA    (final)
 *      └─────────────────► DEVUELTA    (final)
 *
 * Decisiones:
 *  - ENTREGADA y DEVUELTA son estados finales: no admiten ningún cambio posterior.
 *  - No se puede repetir el mismo estado (EN_RUTA → EN_RUTA).
 *  - No se puede saltar pasos (CREADA → ENTREGADA).
 */
const TRANSICIONES_PERMITIDAS: Readonly<Record<EstadoGuia, readonly EstadoGuia[]>> = {
  CREADA: ["EN_RUTA", "DEVUELTA"],
  EN_RUTA: ["ENTREGADA", "DEVUELTA"],
  ENTREGADA: [],
  DEVUELTA: [],
};

/**
 * Indica si un valor cualquiera es un estado de guía válido.
 * Sirve como "type guard": tras llamarla, TypeScript sabe que `valor` es un EstadoGuia.
 */
export function esEstadoGuia(valor: unknown): valor is EstadoGuia {
  return typeof valor === "string" && (ESTADOS_GUIA as readonly string[]).includes(valor);
}

/**
 * Indica si un estado es final, es decir, si la guía ya no puede cambiar.
 */
export function esEstadoFinal(estado: EstadoGuia): boolean {
  return TRANSICIONES_PERMITIDAS[estado].length === 0;
}

/**
 * Indica si las reglas permiten pasar de `actual` a `nuevo`.
 * No lanza errores: solo responde sí o no.
 */
export function puedeTransicionar(actual: EstadoGuia, nuevo: EstadoGuia): boolean {
  return TRANSICIONES_PERMITIDAS[actual].includes(nuevo);
}

/**
 * Verifica que la transición sea válida y, si no lo es, lanza TransicionInvalidaError.
 * Es la función que usará la entidad Guía antes de aceptar un nuevo evento.
 */
export function validarTransicion(actual: EstadoGuia, nuevo: EstadoGuia): void {
  if (!puedeTransicionar(actual, nuevo)) {
    throw new TransicionInvalidaError(actual, nuevo);
  }
}
