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
| `npm run chat` | Chat interactivo por consola |
| `npm run check` | Comprueba la configuración |
| `npm run test:agent` | Smoke test del agente |
| `npm run test:llm` | Prueba la capa del modelo |
| `npm run test:qa` | Batería de preguntas y respuestas |
| `npm run test:sec` | Pruebas de seguridad del prompt |

## Despliegue

Preparado para Railway (`railway.json` y `Procfile` incluidos).

---

Proyecto de [Studio32](https://studio32.es) — sistemas digitales para negocios reales.
