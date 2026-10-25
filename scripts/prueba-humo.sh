#!/usr/bin/env bash
# Prueba de humo: recorre el flujo principal contra un servicio YA levantado con `docker compose up`.
#
# Comprueba, de punta a punta y sin tocar el código, que el entorno funciona:
#   configurar el webhook -> registrar un evento -> el aviso llega al webhook de prueba ->
#   un duplicado no se repite -> un eventId no se puede reusar en otra guía -> aislamiento entre clientes.
#
# Uso:    bash scripts/prueba-humo.sh
# Opciones (variables de entorno):
#   APP_URL      dirección del servicio                  (por defecto http://localhost:3000)
#   WEBHOOK_URL  dirección del webhook DENTRO de Docker  (por defecto http://webhook:4000/hook)
#
# Cada ejecución usa un cliente nuevo, así que se puede repetir sin limpiar la base de datos.

set -euo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
WEBHOOK_URL="${WEBHOOK_URL:-http://webhook:4000/hook}"
TENANT="prueba-humo-${RANDOM}${RANDOM}"
GUIA="GUIA-HUMO"
EVENTO_1="7c9e6679-7425-40de-944b-e07fc1f90ae7"
FECHA="2026-10-24T10:00:00Z"

CUERPO_EVENTO="{\"eventId\": \"${EVENTO_1}\", \"estado\": \"CREADA\", \"fechaEvento\": \"${FECHA}\"}"

# Resultado de la última petición.
CODIGO=""
RESPUESTA=""

paso() { echo "-> $*"; }
fallar() {
  echo "FALLÓ: $*" >&2
  echo "   Última respuesta (HTTP ${CODIGO}): ${RESPUESTA}" >&2
  exit 1
}

# Hace una petición como un cliente. Uso: peticion METODO RUTA [CUERPO] [CLIENTE]
peticion() {
  local metodo="$1" ruta="$2" cuerpo="${3:-}" cliente="${4:-$TENANT}"
  local salida
  if [ -n "$cuerpo" ]; then
    salida=$(curl -s -X "$metodo" "${APP_URL}${ruta}" -H "X-Tenant-Id: ${cliente}" \
      -H "Content-Type: application/json" -d "$cuerpo" -w $'\n%{http_code}')
  else
    salida=$(curl -s -X "$metodo" "${APP_URL}${ruta}" -H "X-Tenant-Id: ${cliente}" -w $'\n%{http_code}')
  fi
  CODIGO="${salida##*$'\n'}"
  RESPUESTA="${salida%$'\n'*}"
}

# Comprueba el código HTTP de la última petición.
esperar_codigo() { [ "$CODIGO" = "$1" ] || fallar "se esperaba HTTP $1 ($2)"; }
# Comprueba que la última respuesta contiene un texto.
esperar_texto() { echo "$RESPUESTA" | grep -qF -- "$1" || fallar "la respuesta debía contener: $1 ($2)"; }

paso "Esperando a que el servicio responda en ${APP_URL}/health"
for _ in $(seq 1 60); do
  if curl -sf "${APP_URL}/health" > /dev/null 2>&1; then break; fi
  sleep 2
done
peticion GET /health "" ""
esperar_codigo 200 "el servicio no está sano"

paso "Configurar el webhook del cliente ${TENANT}"
peticion PUT /webhook "{\"url\": \"${WEBHOOK_URL}\"}"
esperar_codigo 200 "configurar el webhook"
esperar_texto '"secreto"' "la primera vez se debe mostrar el secreto de firma"

paso "Registrar un evento (debe responder 201 sin esperar al cliente)"
peticion POST "/guias/${GUIA}/eventos" "$CUERPO_EVENTO"
esperar_codigo 201 "registrar el evento"
esperar_texto '"duplicado":false' "el evento es nuevo"

paso "Esperar a que el worker entregue el aviso al webhook de prueba"
for _ in $(seq 1 30); do
  peticion GET /notificaciones
  if echo "$RESPUESTA" | grep -qF '"estado":"ENVIADA"'; then break; fi
  sleep 1
done
esperar_codigo 200 "consultar las notificaciones"
esperar_texto '"estado":"ENVIADA"' "el aviso debía quedar ENVIADA"
esperar_texto '"ultimoCodigoHttp":200' "el webhook debía responder 200"

paso "Repetir el mismo evento (debe responder 200 duplicado, sin otro aviso)"
peticion POST "/guias/${GUIA}/eventos" "$CUERPO_EVENTO"
esperar_codigo 200 "reenviar el mismo evento"
esperar_texto '"duplicado":true' "el reenvío es un duplicado"
peticion GET /notificaciones
[ "$(echo "$RESPUESTA" | grep -o '"eventId"' | wc -l)" -eq 1 ] || fallar "un duplicado no debe generar otro aviso"

paso "Usar el mismo eventId en otra guía (debe responder 409 EVENT_ID_YA_USADO)"
peticion POST "/guias/GUIA-OTRA/eventos" "$CUERPO_EVENTO"
esperar_codigo 409 "reusar el eventId en otra guía"
esperar_texto 'EVENT_ID_YA_USADO' "código de error"

paso "Saltarse un paso de estado (debe responder 409 TRANSICION_INVALIDA)"
peticion POST "/guias/${GUIA}/eventos" \
  "{\"eventId\": \"0b2f8d5e-3c1a-4f6b-9a7d-1e2f3a4b5c6d\", \"estado\": \"ENTREGADA\", \"fechaEvento\": \"2026-10-24T10:05:00Z\"}"
esperar_codigo 409 "transición inválida"
esperar_texto 'TRANSICION_INVALIDA' "código de error"

paso "Consultar la guía (estado actual y su historial)"
peticion GET "/guias/${GUIA}"
esperar_codigo 200 "consultar la guía"
esperar_texto '"estadoActual":"CREADA"' "la guía sigue en CREADA"

paso "Otro cliente no debe ver la guía (debe responder 404)"
peticion GET "/guias/${GUIA}" "" "otro-${TENANT}"
esperar_codigo 404 "aislamiento entre clientes"

echo
echo "Prueba de humo: TODO CORRECTO"
