// Servidor de webhook de prueba: hace de "sistema del cliente".
//
// Recibe las notificaciones de tracking-notifier y las imprime en consola, para
// poder ver qué llega, cuándo y con qué cabeceras. No tiene dependencias: solo Node.
//
// Variables de entorno (todas opcionales):
//   PORT        puerto en el que escucha (por defecto 4000)
//   STATUS      código HTTP con el que responde (por defecto 200)
//   FAIL_FIRST  si es N > 0, responde 500 a los primeros N intentos de CADA evento y
//               después responde STATUS; sirve para ver los reintentos en acción
//   DELAY_MS    espera esos milisegundos antes de responder (por defecto 0); con un
//               valor mayor que el timeout del servicio sirve para probar el timeout

const http = require("node:http");

const PUERTO = Number(process.env.PORT ?? 4000);
const STATUS = Number(process.env.STATUS ?? 200);
const FAIL_FIRST = Number(process.env.FAIL_FIRST ?? 0);
const DELAY_MS = Number(process.env.DELAY_MS ?? 0);

/** Cuántas veces ha llegado cada evento (por X-Event-Id), para aplicar FAIL_FIRST. */
const intentosPorEvento = new Map();

const servidor = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (trozo) => (cuerpo += trozo));
  req.on("end", () => {
    const eventId = req.headers["x-event-id"] ?? "(sin X-Event-Id)";
    const intento = (intentosPorEvento.get(eventId) ?? 0) + 1;
    intentosPorEvento.set(eventId, intento);

    // Falla los primeros FAIL_FIRST intentos de cada evento.
    const codigo = intento <= FAIL_FIRST ? 500 : STATUS;

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}  intento ${intento} del evento ${eventId}  -> responde ${codigo}`);
    console.log(`  X-Event-Id: ${eventId}`);
    console.log(`  cuerpo: ${cuerpo}`);

    // La respuesta puede retrasarse a propósito para probar el timeout del servicio.
    setTimeout(() => res.writeHead(codigo).end(), DELAY_MS);
  });
});

servidor.listen(PUERTO, () => {
  console.log(`Webhook de prueba escuchando en el puerto ${PUERTO} (STATUS=${STATUS}, FAIL_FIRST=${FAIL_FIRST}, DELAY_MS=${DELAY_MS})`);
});
