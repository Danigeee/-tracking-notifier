// Configuración de las pruebas unitarias (`npm test`).
//
// Son rápidas y no necesitan base de datos ni Docker. Las pruebas de integración,
// que sí necesitan PostgreSQL, tienen su propia configuración en
// vitest.integration.config.mts y se ejecutan con `npm run test:integration`.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "node_modules/**"],
  },
});
