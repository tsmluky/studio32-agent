# Studio32 Agent

> Agente conversacional **multi-tenant** para negocios locales. Atiende por WhatsApp, capta leads y gestiona reservas en Google Calendar.

Un solo servicio da servicio a varios negocios a la vez. Cada negocio (*tenant*) tiene su propia configuración, su propio contexto y su propio calendario, sin desplegar nada nuevo.

## Qué hace

- **Atiende conversaciones** por WhatsApp, con la personalidad y el contexto de cada negocio.
- **Capta leads** y los registra.
- **Gestiona reservas** contra Google Calendar: consulta huecos, confirma y guarda.
- **Envía recordatorios** de las citas próximas.
- **Notifica por email** al negocio cuando hay algo que requiere atención.
- **Onboarding** de un negocio nuevo sin tocar código.

## Arquitectura

```
src/
├── server.js         Entrada HTTP (Express)
├── orchestrator.js   Coordina la conversación de principio a fin
├── prompt.js         Construcción del prompt por tenant
├── llm.js            Capa de abstracción sobre el modelo
├── safety.js         Filtros y límites de seguridad
├── tenants.js        Resolución y carga de tenants
├── onboarding.js     Alta de negocios nuevos
├── reminders.js      Recordatorios de citas
├── notify.js         Avisos por email
├── channels/         WhatsApp vía Twilio y vía Meta Cloud API
├── integrations/     Google Calendar
├── providers/        OpenAI + provider mock para tests
└── store/            Persistencia: conversaciones, reservas
```

Cada tenant vive en `tenants/<slug>/` con su configuración propia.

## Stack

Node.js 18+ · Express · OpenAI · Twilio y Meta Cloud API (WhatsApp) · Google Calendar API · Nodemailer

## Puesta en marcha

```bash
npm install
cp .env.example .env    # rellena las credenciales
npm start               # o: npm run dev
```

## Comandos

| Comando | Para qué |
|---|---|
| `npm start` | Arranca el servidor |
| `npm run dev` | Arranca con recarga automática |
| `npm run check` | Comprueba la configuración |
| `npm run test:agent` | Smoke: habla con el agente y comprueba que la cita existe |
| `npm run test:agent:prod` | El mismo smoke, contra lo desplegado en Railway |
| `npm run eval` | Banco de pruebas del criterio (`evals/`) |
| `npm run test:supabase` | Pruebas del adaptador y de los permisos de la API |

Cuatro comandos que había aquí —`chat`, `test:llm`, `test:qa`, `test:sec`— apuntaban
a archivos que nunca existieron en el repositorio. Se han quitado: lo que probaban de
verdad ahora está en el smoke y en `evals/`.

## Despliegue

Preparado para Railway (`railway.json` y `Procfile` incluidos).

---

Proyecto de [Studio32](https://studio32.es) — sistemas digitales para negocios reales.
