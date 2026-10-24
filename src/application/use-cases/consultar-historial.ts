// Caso de uso: consultar el estado actual y el historial de una guía.

import { EstadoGuia } from "../../domain/estado-guia";
import { EventoGuia } from "../../domain/evento-guia";
import { GuiaNoEncontradaError } from "../errores";
import { GuiaRepository } from "../ports/guia-repository";

/** Datos de la consulta. */
export interface ConsultarHistorialConsulta {
  /** Cliente que consulta (viene de la cabecera X-Tenant-Id). */
  readonly tenantId: string;
  readonly guiaId: string;
}

/** Vista de la guía que se devuelve a quien consulta. */
export interface HistorialGuia {
  readonly guiaId: string;
  readonly estadoActual: EstadoGuia;
  /** Eventos en orden cronológico. */
  readonly eventos: readonly EventoGuia[];
}

export class ConsultarHistorial {
  constructor(private readonly guias: GuiaRepository) {}

  /**
   * Devuelve el estado actual y los eventos en orden cronológico.
   * La búsqueda es por tenant, así que un cliente nunca ve guías de otro.
   *
   * @throws GuiaNoEncontradaError si la guía no existe para ese tenant.
   */
  async ejecutar(consulta: ConsultarHistorialConsulta): Promise<HistorialGuia> {
    const guia = await this.guias.buscar(consulta.tenantId, consulta.guiaId);
    if (!guia) {
      throw new GuiaNoEncontradaError(consulta.guiaId);
    }
    return {
      guiaId: guia.id,
      estadoActual: guia.estadoActual,
      eventos: guia.eventos,
    };
  }
}
