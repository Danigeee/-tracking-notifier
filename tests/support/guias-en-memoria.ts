// Implementaciones en memoria de los puertos, solo para pruebas.
// Permiten probar los casos de uso sin base de datos.

import { GuiaRepository } from "../../src/application/ports/guia-repository";
import {
  RepositoriosTransaccionales,
  UnidadDeTrabajo,
} from "../../src/application/ports/unidad-de-trabajo";
import { EventoGuia } from "../../src/domain/evento-guia";
import { Guia } from "../../src/domain/guia";

/** Repositorio que guarda las guías en un Map, separadas por tenant. */
export class GuiaRepositoryEnMemoria implements GuiaRepository {
  /** Eventos guardados por guía. La clave combina tenant y guía. */
  private readonly almacen = new Map<string, EventoGuia[]>();

  /** Cuántas veces se llamó a `guardar`; sirve para comprobar que un duplicado no guarda. */
  vecesGuardado = 0;

  private clave(tenantId: string, guiaId: string): string {
    return `${tenantId}::${guiaId}`;
  }

  async buscar(tenantId: string, guiaId: string): Promise<Guia | null> {
    const eventos = this.almacen.get(this.clave(tenantId, guiaId));
    // Se reconstruye una guía nueva en cada lectura, como haría una base de datos:
    // los cambios no guardados no se ven en lecturas posteriores.
    return eventos ? Guia.reconstruir(guiaId, tenantId, eventos) : null;
  }

  async guardar(guia: Guia): Promise<void> {
    this.vecesGuardado++;
    this.almacen.set(this.clave(guia.tenantId, guia.id), [...guia.eventos]);
  }
}

/** Unidad de trabajo trivial: ejecuta el trabajo con los repositorios en memoria (sin rollback). */
export class UnidadDeTrabajoEnMemoria implements UnidadDeTrabajo {
  constructor(private readonly repositorios: RepositoriosTransaccionales) {}

  ejecutar<T>(trabajo: (repositorios: RepositoriosTransaccionales) => Promise<T>): Promise<T> {
    return trabajo(this.repositorios);
  }
}
