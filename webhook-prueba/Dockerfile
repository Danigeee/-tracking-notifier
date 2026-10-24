# Imagen del webhook de prueba: un servidor sin dependencias que imprime lo que recibe.

FROM node:22-bookworm-slim
WORKDIR /app

COPY server.js ./

# Sin privilegios: se ejecuta con el usuario "node".
USER node

EXPOSE 4000

CMD ["node", "server.js"]
