const path = require("path");
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const morgan = require("morgan");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Datos en memoria
// ---------------------------------------------------------------------------

const salasPermitidas = ["Sala Norte", "Sala Sur", "Sala Multimedia"];
const turnosPermitidos = ["Mañana", "Tarde", "Noche"];

// Reservas iniciales: al reiniciar el servidor sólo vuelven estos registros.
const reservas = [
  {
    id: 1,
    estudiante: "Francisco",
    email: "franbarrio@gmail.com",
    sala: "Sala Norte",
    fecha: "2026-10-21",
    turno: "Mañana",
    personas: 4,
  },
  {
    id: 2,
    estudiante: "Maia",
    email: "maiasol@gmail.com",
    sala: "Sala Sur",
    fecha: "2026-11-01",
    turno: "Tarde",
    personas: 6,
  },
  {
    id: 3,
    estudiante: "Julieta",
    email: "juliromero@gmail.com",
    sala: "Sala Norte",
    fecha: "2026-10-21",
    turno: "Mañana",
    personas: 5,
  },
  {
    id: 4,
    estudiante: "Ana",
    email: "anaba@gmail.com",
    sala: "Sala Sur",
    fecha: "2026-10-26",
    turno: "Noche",
    personas: 3,
  },
];

let siguienteId = reservas.length + 1;

// ---------------------------------------------------------------------------
// Configuración de vistas
// ---------------------------------------------------------------------------

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.set("layout", "layouts/main");

// ---------------------------------------------------------------------------
// Middleware personalizado global
// ---------------------------------------------------------------------------

let contadorSolicitudes = 0;

// Asigna un identificador consecutivo (BIB-0001, BIB-0002, ...) a cada solicitud.
// res.locals lo deja disponible para las vistas y para los handlers posteriores.
function identificarSolicitud(req, res, next) {
  contadorSolicitudes += 1;
  res.locals.solicitudId = `BIB-${String(contadorSolicitudes).padStart(4, "0")}`;
  next();
}

// Mide la duración real de la solicitud: el cálculo se hace en el evento
// "finish", cuando la respuesta ya terminó de enviarse.
function medirDuracion(req, res, next) {
  const inicio = process.hrtime.bigint();

  res.on("finish", () => {
    const duracionMs = Number(process.hrtime.bigint() - inicio) / 1e6;
    console.log(
      `[${res.locals.solicitudId}] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duracionMs.toFixed(2)} ms`
    );
  });

  next();
}

// ---------------------------------------------------------------------------
// Pipeline global
// ---------------------------------------------------------------------------

app.use(morgan("dev")); // terceros
app.use(identificarSolicitud); // personalizado
app.use(medirDuracion); // personalizado
app.use(expressLayouts); // terceros
app.use(express.static(path.join(__dirname, "..", "public"))); // incorporado
app.use(express.urlencoded({ extended: false })); // incorporado
app.use(express.json()); // incorporado

// ---------------------------------------------------------------------------
// Rutas de aplicación
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.render("inicio", {
    titulo: "Inicio",
    salas: salasPermitidas,
  });
});

app.get("/estado", (req, res) => {
  res.json({
    servicio: "activo",
    reservas: reservas.length,
    solicitudId: res.locals.solicitudId,
  });
});

// ---------------------------------------------------------------------------
// Router de reservas
// ---------------------------------------------------------------------------

const reservasRouter = express.Router();

// Middleware de router: sólo se ejecuta para solicitudes bajo /reservas.
function prepararAreaReservas(req, res, next) {
  res.locals.seccion = "Reservas de salas";
  next();
}

// Middleware de ruta: sólo se ejecuta en POST /reservas.
function validarReserva(req, res, next) {
  const cuerpo = req.body || {};

  const valores = {
    estudiante: String(cuerpo.estudiante ?? "").trim(),
    email: String(cuerpo.email ?? "").trim(),
    sala: String(cuerpo.sala ?? "").trim(),
    fecha: String(cuerpo.fecha ?? "").trim(),
    turno: String(cuerpo.turno ?? "").trim(),
    personas: String(cuerpo.personas ?? "").trim(),
  };

  const personas = Number(valores.personas);
  const errores = [];

  if (!valores.estudiante) errores.push("El nombre del estudiante es obligatorio.");
  if (!valores.email) {
    errores.push("El email es obligatorio.");
  } else if (!valores.email.includes("@")) {
    errores.push("El email debe contener @.");
  }
  if (!valores.sala) {
    errores.push("La sala es obligatoria.");
  } else if (!salasPermitidas.includes(valores.sala)) {
    errores.push("La sala elegida no está permitida.");
  }
  if (!valores.fecha) errores.push("La fecha es obligatoria.");
  if (!valores.turno) {
    errores.push("El turno es obligatorio.");
  } else if (!turnosPermitidos.includes(valores.turno)) {
    errores.push("El turno debe ser Mañana, Tarde o Noche.");
  }
  if (!valores.personas) {
    errores.push("La cantidad de personas es obligatoria.");
  } else if (!Number.isInteger(personas) || personas < 1 || personas > 6) {
    errores.push("La cantidad de personas debe ser un número entero entre 1 y 6.");
  }

  if (errores.length > 0) {
    // Camino inválido: el ciclo termina acá, sin next().
    return res.status(400).render("reservas/nueva", {
      titulo: "Nueva reserva",
      salas: salasPermitidas,
      turnos: turnosPermitidos,
      errores,
      valores,
    });
  }

  // Camino válido: se entregan los datos ya normalizados al handler final.
  req.reservaValidada = { ...valores, personas };
  next();
}

// Handler final: confía en req.reservaValidada y no repite la validación.
function crearReserva(req, res) {
  const nueva = { id: siguienteId++, ...req.reservaValidada };
  reservas.push(nueva);
  res.redirect("/reservas");
}

reservasRouter.use(prepararAreaReservas);

reservasRouter.get("/", (req, res) => {
  // Filtro opcional por sala: permite ver el estado vacío sin borrar datos.
  const salaFiltro = String(req.query.sala ?? "").trim();
  const listado = salaFiltro
    ? reservas.filter((reserva) => reserva.sala === salaFiltro)
    : reservas;

  res.render("reservas/lista", {
    titulo: "Reservas",
    reservas: listado,
    salas: salasPermitidas,
    salaFiltro,
  });
});

// /nueva se declara antes de /:id para que "nueva" no se tome como id.
reservasRouter.get("/nueva", (req, res) => {
  res.render("reservas/nueva", {
    titulo: "Nueva reserva",
    salas: salasPermitidas,
    turnos: turnosPermitidos,
    errores: [],
    valores: {},
  });
});

reservasRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const reserva = reservas.find((item) => item.id === id);

  if (!reserva) {
    return res.status(404).render("no-encontrado", {
      titulo: "Reserva no encontrada",
      mensaje: `No existe una reserva con id ${req.params.id}.`,
    });
  }

  res.render("reservas/detalle", {
    titulo: `Reserva #${reserva.id}`,
    reserva,
  });
});

reservasRouter.post("/", validarReserva, crearReserva);

app.use("/reservas", reservasRouter);

// ---------------------------------------------------------------------------
// Página 404: último middleware del pipeline
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).render("no-encontrado", {
    titulo: "Página no encontrada",
    mensaje: "La dirección solicitada no existe.",
  });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
