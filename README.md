# tracking-notifier

Microservicio que **recibe cambios de estado de guías de envío**, los **guarda por cliente (tenant)** y **notifica al sistema de cada cliente mediante un webhook**, de forma asíncrona, con reintentos y sin perder eventos.

**Stack:** Node.js · Express · TypeScript · PostgreSQL · Prisma · Docker

## Cómo funciona

1. Un sistema envía un evento (`CREADA`, `EN_RUTA`, `ENTREGADA`, `DEVUELTA`) de una guía.
2. El servicio lo valida y lo guarda junto con su aviso pendiente, en una sola transacción.
3. Un *worker* entrega el aviso al webhook del cliente, firmado. Si falla, reintenta con espera creciente (hasta 5 intentos) y, si no lo logra, deja el aviso como `FALLIDA`, consultable por la API.

## Requisitos

- [Git](https://git-scm.com/)
- [Docker](https://www.docker.com/products/docker-desktop/) con Docker Compose, **abierto y en ejecución**

No hace falta instalar Node.js ni PostgreSQL para probarlo.

## Ponerlo a funcionar

```bash
git clone https://github.com/Danigeee/tracking-notifier.git
cd tracking-notifier
docker compose up --build
```

La primera vez tarda unos minutos mientras descarga y construye las imágenes. Está listo cuando en la terminal aparece `servicio iniciado`. Se levantan cuatro servicios:

| Servicio | Qué es | Dirección |
|---|---|---|
| `app` | La API y el worker | http://localhost:3000 |
| `db` | PostgreSQL | puerto 5433 |
| `webhook` | "Sistema del cliente" de prueba: imprime los avisos que recibe | http://localhost:4000 |
| `migraciones` | Crea las tablas y termina | — |

Para comprobar que responde: abre http://localhost:3000/health, debe mostrar `{"estado":"ok"}`.

## Probarlo paso a paso

Abre **otra terminal** (deja la anterior corriendo). Cada cliente se identifica con la cabecera `X-Tenant-Id`.

**macOS, Linux o Git Bash:**

```bash
# 1. El cliente registra la URL de su webhook (dentro de Docker, el webhook de prueba se llama "webhook").
curl -X PUT http://localhost:3000/webhook \
  -H "X-Tenant-Id: cliente-demo" -H "Content-Type: application/json" \
  -d '{"url": "http://webhook:4000/hook"}'

# 2. Se registra un cambio de estado de la guía GUIA-001.
curl -X POST http://localhost:3000/guias/GUIA-001/eventos \
  -H "X-Tenant-Id: cliente-demo" -H "Content-Type: application/json" \
  -d '{"eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "estado": "CREADA", "fechaEvento": "2026-10-24T10:00:00Z"}'

# 3. Espera 2 o 3 segundos (el worker envía los avisos cada 2 s) y consulta la guía y sus avisos.
curl http://localhost:3000/guias/GUIA-001 -H "X-Tenant-Id: cliente-demo"
curl http://localhost:3000/notificaciones -H "X-Tenant-Id: cliente-demo"

# 4. El aviso que llegó al webhook de prueba.
docker compose logs webhook
```

<details>
<summary><b>Windows PowerShell</b></summary>

```powershell
$h = @{ "X-Tenant-Id" = "cliente-demo" }

# 1. Registrar la URL del webhook
Invoke-RestMethod -Method Put -Uri http://localhost:3000/webhook -Headers $h `
  -ContentType "application/json" -Body '{"url": "http://webhook:4000/hook"}'

# 2. Registrar un cambio de estado
Invoke-RestMethod -Method Post -Uri http://localhost:3000/guias/GUIA-001/eventos -Headers $h `
  -ContentType "application/json" `
  -Body '{"eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "estado": "CREADA", "fechaEvento": "2026-10-24T10:00:00Z"}'

# 3. Espera 2 o 3 segundos (el worker envía los avisos cada 2 s) y consulta la guía y sus avisos
Invoke-RestMethod http://localhost:3000/guias/GUIA-001 -Headers $h | ConvertTo-Json -Depth 5
Invoke-RestMethod http://localhost:3000/notificaciones -Headers $h | ConvertTo-Json -Depth 5

# 4. El aviso que llegó al webhook de prueba
docker compose logs webhook
```

</details>

**Qué debe ver:**

- Paso 1: la URL guardada y un `secreto` de firma (se muestra solo esta primera vez).
- Paso 2: `201` con `"estadoActual": "CREADA"`. El servicio responde al instante, sin esperar al cliente.
- Paso 3: la guía en `CREADA` y una notificación en estado `ENVIADA` con `intentos: 1`. Si la consultas apenas registras el evento, aún puede aparecer `PENDIENTE` con `intentos: 0`: es el worker que todavía no la envió; vuelve a consultar.
- Paso 4: el webhook de prueba imprimió el evento recibido:

```
POST /hook  intento 1 del evento 7c9e6679-...  -> responde 200
  firma: no verificada (sin WEBHOOK_SECRET)
  cuerpo: {"eventId":"7c9e6679-...","guiaId":"GUIA-001","estado":"CREADA","fechaEvento":"2026-10-24T10:00:00.000Z"}
```

### Probar las reglas de negocio

```bash
# Repetir el MISMO evento: responde 200 con "duplicado": true y no genera otro aviso.
curl -X POST http://localhost:3000/guias/GUIA-001/eventos \
  -H "X-Tenant-Id: cliente-demo" -H "Content-Type: application/json" \
  -d '{"eventId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "estado": "CREADA", "fechaEvento": "2026-10-24T10:00:00Z"}'

# Saltarse un paso (CREADA -> ENTREGADA): responde 409 TRANSICION_INVALIDA.
curl -X POST http://localhost:3000/guias/GUIA-001/eventos \
  -H "X-Tenant-Id: cliente-demo" -H "Content-Type: application/json" \
  -d '{"eventId": "0b2f8d5e-3c1a-4f6b-9a7d-1e2f3a4b5c6d", "estado": "ENTREGADA", "fechaEvento": "2026-10-24T10:05:00Z"}'

# Otro cliente no ve la guía: responde 404.
curl http://localhost:3000/guias/GUIA-001 -H "X-Tenant-Id: otro-cliente"
```

Las transiciones válidas son `CREADA → EN_RUTA → ENTREGADA` y `CREADA`/`EN_RUTA → DEVUELTA`. `ENTREGADA` y `DEVUELTA` son finales.

### Ver los reintentos

Se reinicia el webhook de prueba para que **falle el primer intento de cada evento**; el servicio reintenta a los 10 segundos y entonces llega.

```bash
# 1. Reiniciar el webhook de prueba con fallos simulados
WEBHOOK_FAIL_FIRST=1 docker compose up -d webhook          # PowerShell: $env:WEBHOOK_FAIL_FIRST=1; docker compose up -d webhook

# 2. Registrar el siguiente estado de la guía (otro eventId y una fecha posterior)
curl -X POST http://localhost:3000/guias/GUIA-001/eventos   -H "X-Tenant-Id: cliente-demo" -H "Content-Type: application/json"   -d '{"eventId": "d2719a3c-8f4e-4b1a-8c6d-5e7f9a0b1c2d", "estado": "EN_RUTA", "fechaEvento": "2026-10-24T11:00:00Z"}'

# 3. Mirar el webhook: primero responde 500 y, unos 10 segundos después, 200
docker compose logs -f webhook        # Ctrl+C para salir
```

## API

Todas las rutas, salvo `/health`, requieren la cabecera `X-Tenant-Id`.

| Método y ruta | Descripción |
|---|---|
| `POST /guias/{guiaId}/eventos` | Registra un cambio de estado. Cuerpo: `eventId` (UUID), `estado`, `fechaEvento` (ISO 8601 con zona horaria), `observacion` (opcional) |
| `GET /guias/{guiaId}` | Estado actual y eventos en orden cronológico |
| `PUT /webhook` | Configura la URL del webhook del cliente |
| `GET /webhook` | Consulta la URL configurada |
| `POST /webhook/secreto` | Genera un secreto de firma nuevo |
| `GET /notificaciones` | Lista los avisos. Filtros: `?estado=PENDIENTE\|ENVIADA\|FALLIDA` y `?limite=` |
| `GET /health` | Estado del servicio y de la base de datos |

Hay una colección lista para importar en Postman: [docs/postman/tracking-notifier.postman_collection.json](docs/postman/tracking-notifier.postman_collection.json).

## Detener y limpiar

```bash
docker compose down        # detiene los servicios (conserva los datos)
docker compose down -v     # detiene y borra también la base de datos
```

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `Cannot connect to the Docker daemon` o similar | Abre Docker Desktop y espera a que indique que está en ejecución. |
| `port is already allocated` | Un puerto está ocupado. Usa otros: `APP_PORT=3100 WEBHOOK_PORT=4100 DB_PORT=5499 docker compose up --build` (y cambia `3000` por `3100` en los comandos). |
| `curl` falla en Windows PowerShell | Usa los comandos de PowerShell de arriba, o `curl.exe` en lugar de `curl`. |
| Quiero empezar de cero | `docker compose down -v` y vuelve a ejecutar `docker compose up --build`. |

## Ejecutar las pruebas

Requiere [Node.js](https://nodejs.org/) 20 o superior.

```bash
npm install                    # instala las dependencias y genera el cliente de Prisma
npm test                       # pruebas unitarias (no necesitan Docker)

docker compose up -d db        # las de integración usan un PostgreSQL real
npm run test:integration       # crea una base temporal, la usa y la borra al terminar
```

## Estructura

```
src/
├── domain/          Reglas de negocio (sin dependencias externas)
├── application/     Casos de uso y puertos (interfaces)
├── infrastructure/  Adaptadores: API HTTP, PostgreSQL, webhook, worker, logs
├── config/          Variables de entorno
└── main.ts          Punto de entrada: conecta todas las piezas
prisma/              Esquema y migraciones de la base de datos
tests/               Pruebas unitarias y de integración
webhook-prueba/      Webhook de prueba usado por Docker Compose
```

Arquitectura hexagonal: el dominio no depende de Express ni de Prisma.
