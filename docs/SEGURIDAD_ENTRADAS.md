# S1 · Entradas autenticadas

Estado 2026-10-01: implementado y verificado localmente. No desplegado.

## Comportamiento

- Meta POST: HMAC-SHA256 del cuerpo original con META_APP_SECRET. Sin secreto
  devuelve 503; firma ausente o incorrecta devuelve 403, sin invocar el agente.
  GET exige META_VERIFY_TOKEN configurado y reto textual; no autentica el POST.
- Twilio POST: formulario validado con el SDK instalado, TWILIO_AUTH_TOKEN y
  TWILIO_WEBHOOK_URL exacta. Sin configuración devuelve 503; firma/ruta incorrecta
  403; tipo distinto de formulario 415. No confiar en Host o cabeceras de proxy.
- Números de destino: coincidencia normalizada completa y una sola asignación.
  Número desconocido/ambiguo se acepta como evento autenticado pero se descarta
  sin atenderlo desde otra clínica. Monitorizar estos descartes al provisionar.
- Sandbox Twilio: solo fallback explícito TWILIO_SANDBOX_TENANT, con To igual
  a TWILIO_WHATSAPP_NUMBER y business.demo=true. No usar DEFAULT_TENANT para rutas.
- Chat público: demos y widget comercial studio32; resto de negocios exige
  ownerToken correcto o SMOKE_TOKEN en cabecera. Un smoke no adquiere rol owner.
  En tenants reales la identidad es web:<sesion>, independiente del teléfono.
- Alta interna: exige ONBOARDING_TOKEN; configuración ausente 503 y token malo 401.
  IDs de tenant/plantilla no permiten recorrer otras carpetas.

## Validación

`node --test test/entry-security.test.js`: 12 pruebas sobre el servidor HTTP
real en loopback con fixtures sintéticos y orquestador sustituido, sin proveedores.
Además se ejecuta cancelBooking con store real contra una reserva sintética:
elegir su teléfono desde el widget no permite encontrarla ni cancelarla.
Pruebas generales del backend: 74/74. Supabase: 9/9 y contrato de 15 tablas.

## Requisitos antes de desplegar

1. Meta, si se utiliza: cargar META_APP_SECRET de la aplicación correspondiente;
   registrar el número inequívocamente en el tenant y comprobar GET/POST del proveedor.
2. Twilio, si se utiliza: definir TWILIO_WEBHOOK_URL con la URL configurada en
   Twilio (ruta/query exactas), verificar token de la cuenta emisora y registrar número.
   Un túnel de pruebas también necesita URL exacta; no desactivar firmas.
3. Onboarding: configurar su token para el equipo que realizará las altas.
4. Confirmar uso del widget: nuevas conversaciones web de tenants reales quedan
   en namespace web:. No enlazar automáticamente identidades antiguas elegidas por
   visitantes con contactos telefónicos, porque no estaban autenticadas.
5. Probar entrega real y comprobar logs de destino descartado. Esta prueba local
   no acredita coexistencia ni cuenta 360dialog; ese adaptador es W2.

La autenticación de un evento no resuelve reintentos, batching, ecos humanos,
control_mode ni persistencia concurrente. Continúan en S2/S3 y W2.

Referencias de implementación:
[Twilio, validación de webhooks](https://www.twilio.com/docs/usage/webhooks/webhooks-security),
[Meta, configuración de webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/).
