# Trabajo práctico 05

Pipeline de middleware en Express — Reservas de salas de estudio.

## Descripción

Aplicación web para consultar salas de estudio (Sala Norte, Sala Sur y Sala Multimedia) y reservar temporalmente un turno (Mañana, Tarde o Noche) para un grupo de 1 a 6 personas.

La aplicación usa Express con EJS y `express-ejs-layouts`, y cada solicitud atraviesa un pipeline de middleware que la **registra** (Morgan), la **identifica** (`identificarSolicitud`), la **mide** (`medirDuracion`), la **prepara** (`prepararAreaReservas`) y, en el caso del POST, la **valida** (`validarReserva`) antes de llegar al handler final.

Estructura del proyecto:

```
tp-05-salas-middleware/
|-- public/css/estilos.css
|-- src/index.js              # servidor, datos, middleware y router de reservas
|-- views/
|   |-- layouts/main.ejs      # layout: lang, charset, viewport, título dinámico, nav, main, pie con ID
|   |-- reservas/lista.ejs    # listado en tarjetas + estado vacío + filtro por sala
|   |-- reservas/detalle.ejs  # todos los datos de una reserva
|   |-- reservas/nueva.ejs    # formulario con label/id/name por control y errores con role="alert"
|   |-- inicio.ejs            # propósito del sitio y enlaces
|   `-- no-encontrado.ejs     # página 404 HTML
|-- .gitignore                # excluye node_modules y .env
|-- package.json
|-- package-lock.json
`-- README.md
```

Las vistas muestran todos los datos con salida escapada (`<%= %>`); la única salida sin escapar es `<%- body %>` en el layout, que inserta la vista ya renderizada.

## Instalación

Requisitos: Node.js 18 o superior.

```bash
npm install
```

Dependencias de ejecución: `express`, `ejs`, `express-ejs-layouts` y `morgan`. El proyecto usa CommonJS (`"type": "commonjs"`).

## Ejecución

```bash
npm start        # node src/index.js
npm run check    # node --check src/index.js (verifica la sintaxis)
```

El servidor queda disponible en `http://localhost:3000` (se puede cambiar con la variable `PORT`).

## Rutas

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | `/` | 200 · Inicio: propósito del sitio y enlaces al listado y al formulario |
| GET | `/estado` | 200 · JSON `{ "servicio": "activo", "reservas": <cantidad>, "solicitudId": "BIB-xxxx" }` |
| GET | `/reservas` | 200 · Listado de reservas (o estado vacío). Acepta `?sala=Sala Multimedia` para filtrar |
| GET | `/reservas/nueva` | 200 · Formulario de nueva reserva |
| GET | `/reservas/:id` | 200 · Detalle completo, o 404 HTML si el id no existe |
| POST | `/reservas` | 302 → `/reservas` si es válida, 400 con el formulario y errores si es inválida |
| cualquier otra | — | 404 HTML desde el middleware final |

`GET /reservas/nueva` se declara **antes** que `GET /reservas/:id`; si fuera al revés, Express interpretaría `nueva` como un `id`.

## Pipeline de middleware

Orden real en `src/index.js`:

```
morgan("dev")                         global · terceros
  → identificarSolicitud              global · personalizado
  → medirDuracion                     global · personalizado
  → expressLayouts                    global · terceros
  → express.static("public")          global · incorporado
  → express.urlencoded()              global · incorporado
  → express.json()                    global · incorporado
  → GET /  y  GET /estado             rutas de aplicación
  → app.use("/reservas", reservasRouter)
        → prepararAreaReservas        router
        → GET /, GET /nueva, GET /:id
        → POST /  → validarReserva → crearReserva   ruta
  → middleware 404                    último del pipeline
```

Justificación del orden según los datos que consume cada función:

- **Morgan va primero** para registrar todas las solicitudes, incluidas las de archivos estáticos y las que terminan en 404. Usa el formato documentado `dev` (`método URL estado tiempo - tamaño`), que colorea los estados 200, 302, 400 y 404.
- **identificarSolicitud antes de medirDuracion**: la línea de medición imprime `res.locals.solicitudId`, así que el ID tiene que existir antes de registrar el listener.
- **medirDuracion antes del resto**: así el tiempo medido incluye todo el trabajo posterior (layout, parsers, router, render).
- **expressLayouts antes de cualquier `res.render`**: modifica `res.render` para envolver cada vista en `layouts/main.ejs`.
- **express.static antes de los parsers y las rutas**: un pedido a `/css/estilos.css` se resuelve ahí y no recorre el resto. Como está después de Morgan, los recursos estáticos sí quedan registrados (y también reciben un ID BIB, por eso los IDs pueden saltar números al cargar una página con CSS).
- **Parsers antes de las rutas**: `validarReserva` lee `req.body`, que sólo existe después de `express.urlencoded`.
- **Rutas de aplicación y router antes del 404**: el 404 es un middleware sin ruta que responde a todo lo que llegue; si estuviera antes, taparía las rutas reales.

### Diagrama del POST válido

```
POST /reservas
  ↓ morgan("dev")
  ↓ identificarSolicitud        res.locals.solicitudId = "BIB-0007"
  ↓ medirDuracion               guarda inicio y registra res.on("finish")
  ↓ expressLayouts
  ↓ express.urlencoded          crea req.body
  ↓ reservasRouter
  ↓ prepararAreaReservas        res.locals.seccion = "Reservas de salas"
  ↓ validarReserva              datos correctos → req.reservaValidada → next()
  ↓ crearReserva                reservas.push(...) → res.redirect("/reservas")
  ↓ 302 /reservas
  ↓ finish: ID + estado + duración   "[BIB-0007] POST /reservas 302 - 4.12 ms"
```

Después el navegador sigue la redirección con un `GET /reservas` nuevo (otro ID, otra medición) que responde 200 y muestra la tarjeta creada.

### Diagrama del POST inválido

```
POST /reservas
  ↓ morgan("dev")
  ↓ identificarSolicitud
  ↓ medirDuracion
  ↓ expressLayouts
  ↓ express.urlencoded
  ↓ reservasRouter
  ↓ prepararAreaReservas
  ↓ validarReserva              hay errores → res.status(400).render("reservas/nueva")
  ✕ (no llama a next(): crearReserva nunca se ejecuta)
  ↓ 400 formulario con valores conservados y role="alert"
  ↓ finish: ID + estado + duración   "[BIB-0009] POST /reservas 400 - 3.05 ms"
```

El camino inválido **termina en `validarReserva`**.

## Alcance de cada función

### Tipos de middleware

- **Incorporado**: viene dentro de Express, no requiere instalar nada: `express.static`, `express.urlencoded`, `express.json` y `express.Router`.
- **De terceros**: paquetes instalados con npm que exponen un middleware: `morgan` y `express-ejs-layouts`.
- **Personalizado**: funciones escritas en este proyecto con la firma `(req, res, next)`: `identificarSolicitud`, `medirDuracion`, `prepararAreaReservas`, `validarReserva` (y el middleware 404).

### Alcances

| Función | Alcance | Se ejecuta en | Qué produce |
| --- | --- | --- | --- |
| `morgan("dev")` | global (`app.use`) | todas las solicitudes | línea de registro en la terminal |
| `identificarSolicitud` | global | todas las solicitudes | `res.locals.solicitudId` (`BIB-0001`, `BIB-0002`, …) |
| `medirDuracion` | global | todas las solicitudes | línea `[ID] método URL estado - ms` al terminar |
| `expressLayouts` | global | todas | layout alrededor de cada vista |
| `express.static` | global | pedidos a archivos de `public/` | el archivo estático |
| `express.urlencoded` / `express.json` | global | solicitudes con cuerpo | `req.body` |
| `prepararAreaReservas` | router (`reservasRouter.use`) | sólo bajo `/reservas` | `res.locals.seccion = "Reservas de salas"` |
| `validarReserva` | ruta (`reservasRouter.post("/", …)`) | sólo `POST /reservas` | 400 o `req.reservaValidada` + `next()` |
| `crearReserva` | handler final de ruta | sólo `POST /reservas` válido | alta en memoria y 302 |
| middleware 404 | global, último | lo que nadie respondió | 404 HTML |

- **Global**: se registra con `app.use(fn)` y corre para todas las solicitudes.
- **De router**: se registra con `reservasRouter.use(fn)` y sólo corre para rutas bajo el montaje `/reservas`. Por eso `GET /estado` no tiene `res.locals.seccion` y tampoco lo necesita: sólo lo usan el listado, el detalle y el formulario.
- **De ruta**: se pasa como argumento de una ruta concreta (`reservasRouter.post("/", validarReserva, crearReserva)`) y sólo corre en esa ruta y ese método.

### Cuándo se usa `next()`

`next()` pasa el control al siguiente middleware de la cadena. Lo llama un middleware que **no termina** la respuesta: `identificarSolicitud`, `medirDuracion` y `prepararAreaReservas` siempre lo llaman; `validarReserva` lo llama sólo en el camino válido. Una función que **responde** (render, json, redirect) no debe llamar a `next()`: así lo hacen `validarReserva` en el camino inválido, `crearReserva`, los handlers GET y el middleware 404. Si una función no responde ni llama a `next()`, la solicitud queda cargando.

### Por qué `finish`

`res.on("finish", …)` se dispara cuando la respuesta terminó de enviarse. Si `medirDuracion` calculara el tiempo justo después de `next()`, mediría casi nada, porque el render o la redirección todavía no ocurrieron (y en general pasan de forma asincrónica). Además, recién en `finish` está disponible el `res.statusCode` definitivo (200, 302, 400 o 404).

### Montaje del router

`app.use("/reservas", reservasRouter)` hace que el router reciba todas las URLs que empiezan con `/reservas`, quitándoles ese prefijo. Por eso las rutas internas son relativas: `/` equivale a `/reservas`, `/nueva` a `/reservas/nueva` y `/:id` a `/reservas/:id`. En la medición se usa `req.originalUrl` porque conserva la URL completa (`/reservas/2`), mientras que dentro del router `req.url` sería sólo `/2`.

## Validación

`validarReserva` es un middleware de ruta separado del handler `crearReserva`:

1. Normaliza los textos con `trim()` (estudiante, email, sala, fecha, turno).
2. Convierte `personas` con `Number`.
3. Comprueba que ningún campo obligatorio esté vacío.
4. Comprueba que la sala pertenezca a `salasPermitidas`.
5. Comprueba que el turno sea `Mañana`, `Tarde` o `Noche`.
6. Comprueba que `personas` sea un entero entre 1 y 6 (`Number.isInteger`).
7. Comprueba de manera básica que el email contenga `@`.
8. **Si hay errores**: responde `400`, vuelve a renderizar `reservas/nueva` con los valores ingresados y la lista de errores dentro de un bloque `role="alert"`, y **no** llama a `next()`.
9. **Si todo es correcto**: guarda los datos normalizados en `req.reservaValidada` y llama a `next()`.

`crearReserva` sólo asigna el siguiente `id`, agrega `req.reservaValidada` al arreglo y redirige a `/reservas`; no repite la validación.

**Por qué los parsers van antes de validar**: el formulario envía `application/x-www-form-urlencoded`. Hasta que `express.urlencoded` lo procesa, `req.body` no existe; sin ese orden, el validador no tendría datos que revisar.

Los atributos `required`, `type="email"` y `min`/`max` del formulario ayudan al usuario, pero se pueden saltear (por ejemplo con curl o editando el HTML), así que la validación del servidor es la que decide.

**POST 302 frente al GET posterior**: el POST válido no renderiza una página; responde `302 Found` con `Location: /reservas`. El navegador hace entonces un `GET /reservas` nuevo que responde 200 con el listado. Este patrón (POST-redirect-GET) evita que al recargar la página se reenvíe el formulario y se duplique la reserva. En la terminal se ven dos solicitudes distintas, cada una con su ID y su duración.

## Pruebas manuales

Para cada caso revisar la línea de Morgan y la línea `[BIB-xxxx] … ms` de `medirDuracion`.

| Caso | Cómo probar | Esperado | Evidencia |
| --- | --- | --- | --- |
| Inicio | `GET /` | 200 | Navegación y ID en el pie |
| Estado | `GET /estado` | 200 | JSON con cantidad e ID |
| Listado | `GET /reservas` | 200 | Cuatro o más tarjetas |
| Estado vacío | `GET /reservas?sala=Sala%20Multimedia` (los datos iniciales no tienen reservas en Sala Multimedia) | 200 | Mensaje "No hay reservas para mostrar" |
| Formulario | `GET /reservas/nueva` | 200 | Controles etiquetados |
| Detalle válido | `GET /reservas/1` | 200 | Datos completos |
| Detalle inexistente | `GET /reservas/999` | 404 | Página HTML |
| Campos vacíos | enviar el formulario vacío (sin validación HTML) | 400 | Errores y valores conservados |
| Sala no permitida | `sala=Sala Azul` | 400 | No se crea registro |
| Turno no permitido | `turno=Madrugada` | 400 | No se crea registro |
| Email sin @ | `email=correo.com` | 400 | No se crea registro |
| Personas = 0 | `personas=0` | 400 | No se crea registro |
| Personas = 7 | `personas=7` | 400 | No se crea registro |
| Reserva válida | datos correctos | 302 y luego 200 | Nueva tarjeta en el listado |
| URL inexistente | `GET /no-existe` | 404 | Middleware final |
| Reinicio | detener y volver a ejecutar `npm start` | 200 | Sólo las cuatro reservas iniciales |

Ejemplos con curl (saltean la validación HTML):

```bash
curl -i http://localhost:3000/estado
curl -i -X POST http://localhost:3000/reservas -d "estudiante=&email=&sala=&fecha=&turno=&personas="
curl -i -X POST http://localhost:3000/reservas --data-urlencode "estudiante=Ana" --data-urlencode "email=ana@correo.com" --data-urlencode "sala=Sala Azul" --data-urlencode "fecha=2026-10-20" --data-urlencode "turno=Tarde" --data-urlencode "personas=2"
curl -i -X POST http://localhost:3000/reservas --data-urlencode "estudiante=Ana" --data-urlencode "email=ana@correo.com" --data-urlencode "sala=Sala Sur" --data-urlencode "fecha=2026-10-20" --data-urlencode "turno=Tarde" --data-urlencode "personas=7"
curl -i -X POST http://localhost:3000/reservas --data-urlencode "estudiante=Ana" --data-urlencode "email=ana@correo.com" --data-urlencode "sala=Sala Sur" --data-urlencode "fecha=2026-10-20" --data-urlencode "turno=Tarde" --data-urlencode "personas=2"
curl -i http://localhost:3000/no-existe
```

Ejemplo de salida en la terminal para una reserva válida:

```
POST /reservas 302 4.010 ms - 29
[BIB-0005] POST /reservas 302 - 4.37 ms
GET /reservas 200 6.112 ms - 2981
[BIB-0006] GET /reservas 200 - 6.40 ms
```

## Persistencia temporal

Las reservas viven en un arreglo (`reservas`) definido en `src/index.js`, es decir, en la memoria del proceso de Node. Las altas hechas con el formulario se agregan a ese arreglo, pero no se escriben en ningún archivo ni base de datos. Cuando el proceso se detiene, esa memoria se libera; al volver a ejecutar `npm start`, el archivo se carga de nuevo y el arreglo vuelve a tener sólo las cuatro reservas iniciales. Lo mismo pasa con el contador de IDs BIB, que vuelve a empezar en `BIB-0001`.
