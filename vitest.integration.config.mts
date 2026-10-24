// Configuración de las pruebas de integración (`npm run test:integration`).
//
// Estas pruebas usan un PostgreSQL real. Antes de empezar, `global-setup.ts` crea una
// base de datos temporal con las migraciones aplicadas, y al terminar la borra; así no
// tocan los datos de desarrollo. Requiere que el contenedor `db` esté encendido
// (`docker compose up -d db`).

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // Los archivos se ejecutan uno tras otro: comparten la misma base temporal y algunas
    // pruebas (el reclamo de notificaciones) miran toda la tabla, no solo sus datos.
    fileParallelism: false,
    // Crear la base y aplicar las migraciones tarda unos segundos.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
