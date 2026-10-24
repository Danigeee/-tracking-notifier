// Servidor de webhook de prueba: hace de "sistema del cliente".
//
// Recibe las notificaciones de tracking-notifier y las imprime en consola, para
// poder ver qué llega, cuándo y con qué cabeceras. También muestra cómo un cliente
// verifica la firma de los avisos. No tiene dependencias: solo Node.
//
// Variables de entorno (todas opcionales):
//   PORT            puerto en el que escucha (por defecto 4000)
//   WEBHOOK_SECRET  secreto de firma del cliente (el que devuelve PUT /webhook la primera
//                   vez). Si se define, se verifica la firma de cada aviso y se responde
//                   401 si no es válida. Si no, solo se imprime que no se verificó.
//   STATUS          código HTTP con el que responde (por defecto 200)
//   FAIL_FIRST      si es N > 0, responde 500 a los primeros N intentos de CADA evento y
//                   después responde STATUS; sirve para ver los reintentos en acción
//   DELAY_MS        espera esos milisegundos antes de responder (por defecto 0); con un
//                   valor mayor que el timeout del servicio sirve para probar el timeout

const http = require("node:http");
const crypto = require("node:crypto");

const PUERTO = Number(process.env.PORT ?? 4000);
const SECRETO = process.env.WEBHOOK_SECRET ?? "";
const STATUS = Number(process.env.STATUS ?? 200);
const FAIL_FIRST = Number(process.env.FAIL_FIRST ?? 0);
const DELAY_MS = Number(process.env.DELAY_MS ?? 0);

/** Un aviso con más de 5 minutos de antigüedad se rechaza: evita que se reenvíe uno capturado. */
const TOLERANCIA_SEGUNDOS = 300;

/** Cuántas veces ha llegado cada evento (por X-Event-Id), para aplicar FAIL_FIRST. */
const intentosPorEvento = new Map();

/**
 * Verifica la firma de un aviso. Es lo que debe hacer el sistema de un cliente real:
 *  1. Calcular HMAC-SHA256 con su secreto sobre "<X-Timestamp>.<cuerpo exacto recibido>".
 *  2. Compararlo con X-Signature en tiempo constante.
 *  3. Comprobar que X-Timestamp es reciente.
 * @returns "VÁLIDA", o un texto que explica por qué es inválida
 */
function verificar(cabeceras, cuerpo) {
  const timestamp = Number(cabeceras["x-timestamp"]);
  const firma = String(cabeceras["x-signature"] ?? "");
  if (!Number.isFinite(timestamp) || !firma) return "INVÁLIDA (faltan X-Timestamp o X-Signature)";

  const esperada = "sha256=" + crypto.createHmac("sha256", SECRETO).update(`${timestamp}.${cuerpo}`).digest("hex");
  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "INVÁLIDA (no coincide)";

  const antiguedad = Math.abs(Date.now() / 1000 - timestamp);
  if (antiguedad > TOLERANCIA_SEGUNDOS) return `INVÁLIDA (aviso de hace ${Math.round(antiguedad)} s)`;
  return "VÁLIDA";
}

const servidor = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (trozo) => (cuerpo += trozo));
  req.on("end", () => {
    const eventId = req.headers["x-event-id"] ?? "(sin X-Event-Id)";
    const intento = (intentosPorEvento.get(eventId) ?? 0) + 1;
    intentosPorEvento.set(eventId, intento);

    // Firma: solo se verifica si se indicó el secreto.
    const firma = SECRETO ? verificar(req.headers, cuerpo) : "no verificada (sin WEBHOOK_SECRET)";
    const firmaValida = !SECRETO || firma === "VÁLIDA";

    // Una firma inválida se rechaza; si no, falla los primeros FAIL_FIRST intentos de cada evento.
    const codigo = !firmaValida ? 401 : intento <= FAIL_FIRST ? 500 : STATUS;

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}  intento ${intento} del evento ${eventId}  -> responde ${codigo}`);
    console.log(`  firma: ${firma}`);
    console.log(`  X-Timestamp: ${req.headers["x-timestamp"] ?? "(no viene)"}`);
    console.log(`  cuerpo: ${cuerpo}`);

    // La respuesta puede retrasarse a propósito para probar el timeout del servicio.
    setTimeout(() => res.writeHead(codigo).end(), DELAY_MS);
  });
});

servidor.listen(PUERTO, () => {
  console.log(
    `Webhook de prueba escuchando en el puerto ${PUERTO} ` +
      `(firma ${SECRETO ? "verificada" : "sin verificar"}, STATUS=${STATUS}, FAIL_FIRST=${FAIL_FIRST}, DELAY_MS=${DELAY_MS})`,
  );
});
