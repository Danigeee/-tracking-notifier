// Adaptador de salida: implementa el puerto UnidadDeTrabajo con transacciones de Prisma.

import { PrismaClient } from "@prisma/client";
import {
  RepositoriosTransaccionales,
  UnidadDeTrabajo,
} from "../../application/ports/unidad-de-trabajo";
import { GuiaRepositoryPrisma } from "./guia-repository-prisma";

export class UnidadDeTrabajoPrisma implements UnidadDeTrabajo {
  constructor(private readonly prisma: PrismaClient) {}

  ejecutar<T>(trabajo: (repositorios: RepositoriosTransaccionales) => Promise<T>): Promise<T> {
    // Si `trabajo` termina bien, Prisma confirma la transacción. Si lanza un error,
    // la descarta y vuelve a lanzar ese mismo error.
    return this.prisma.$transaction(async (tx) =>
      trabajo({
        // Dentro de la transacción las guías se bloquean al buscarlas.
        guias: new GuiaRepositoryPrisma(tx, true),
      }),
    );
  }
}
