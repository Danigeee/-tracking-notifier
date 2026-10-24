# Imagen del servicio tracking-notifier, en dos etapas:
#   1. "build": instala todo, genera el cliente de Prisma y compila TypeScript.
#      También se usa para aplicar las migraciones (necesita la herramienta de Prisma).
#   2. "runtime": solo lo necesario para ejecutar. Más pequeña y sin herramientas de desarrollo.

# ---------------------------------------------------------------------------
# Etapa 1: compilación
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Prisma necesita OpenSSL para detectar qué motor de base de datos usar.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# Primero solo los archivos de dependencias: mientras no cambien, Docker reutiliza esta capa
# y no vuelve a descargar todo en cada compilación.
COPY package.json package-lock.json ./
# --ignore-scripts: el script "postinstall" del proyecto genera el cliente de Prisma, pero en este
# punto todavía no está copiado el esquema. Se genera más abajo, de forma explícita.
RUN npm ci --ignore-scripts

# Esquema y migraciones de la base de datos; con el esquema se genera el cliente de Prisma.
COPY prisma ./prisma
RUN npx prisma generate

# Código fuente y compilación a JavaScript (carpeta dist).
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# Etapa 2: ejecución
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# Solo las dependencias de producción (sin TypeScript, Vitest ni la herramienta de Prisma).
# --omit=optional es necesario: Prisma y TypeScript figuran en el lockfile como pares opcionales
# de @prisma/client y, sin esta opción, npm los instalaría también en la imagen final.
COPY package.json package-lock.json ./
# --ignore-scripts por la misma razón: aquí no hay herramienta de Prisma; el cliente ya generado se copia abajo.
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

# Del paso anterior: el cliente de Prisma ya generado y el código compilado.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist

# El servicio no necesita privilegios: se ejecuta con el usuario "node", no como root.
USER node

EXPOSE 3000

# Docker marca el contenedor como sano si /health responde 200 (comprueba también la base de datos).
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Forma "exec": node es el proceso principal y recibe directamente la señal de apagado.
CMD ["node", "dist/main.js"]
