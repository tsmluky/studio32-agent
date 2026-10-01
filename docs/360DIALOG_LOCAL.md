# 360dialog · integración preparada, no activada

Estado 2026-10-01: sin cuenta ni número Business elegible. El usuario pidió
preparar integración y pruebas locales. No se ha contratado, enviado WhatsApp,
configurado un webhook externo ni aplicado una migración.

## Configuración futura por clínica

1. Verificar W1: elegibilidad y alta de coexistencia conservando la aplicación.
2. Usar slug en minúsculas. En business.json del volumen:

```json
{"whatsapp_number":"+34600000101","channels":{"whatsapp_360dialog":{"enabled":true}}}
```

3. Configurar D360_API_KEY_<SLUG> y D360_WEBHOOK_AUTH_<SLUG> en el entorno.
   El segundo contiene el header completo Basic base64(usuario:contraseña),
   con secretos aleatorios. Conservar guiones del slug al convertir mayúsculas:
   clinica-a y clinica_a no pueden compartir secretos. Nunca subir esas claves
   al repositorio ni devolverlas al panel.
4. Registrar por número el webhook HTTPS
   /whatsapp/360dialog/<slug>/webhook con ese header Authorization.
   Una clave API del proveedor autentica envíos; no autentica por sí sola
   webhooks entrantes. El receptor exige Basic Auth y número exacto/único.
5. Supabase configurado y control humano comprobado. Mantener
   D360_PROCESS_INBOUND=off para recepción persistente sin ejecutar el agente.
   on habilita el worker; cada clínica exige también enabled=true.

## Comportamiento implementado

- Recorre todos los mensajes de un lote; rechaza número ajeno o identidad inválida.
- Persiste d360-inbox.json mediante reemplazo atómico ANTES de devolver HTTP 200.
  Fallo de volumen devuelve 503. Deduplica por tipo/ID/estado/timestamp en disco.
- Ecos smb_message_echoes pausan control en Supabase y registran sender_type=human
  antes del ACK. No generan respuesta. Eco duplicado no deshace un release posterior.
  El historial usado por el agente incluye las respuestas humanas.
- Reinicio reanuda queued. Un evento processing/sending queda para revisión:
  no vuelve a ejecutar una herramienta que pudo reservar antes de una caída.
- Rechazo/timeout de envío conserva respuesta y delivery_uncertain. No reenvía
  automáticamente. accepted significa que el proveedor dio ID de mensaje,
  no que el destinatario lo recibió o leyó.
- Panel puede enviar respuesta humana con el slug de su organización autorizada.
- Estados de entrega se conservan como eventos recorded; no actualizan todavía
  el mensaje original del panel. Audio conserva referencia y queda unsupported.

## Revisión y límites pendientes de W2

```powershell
node scripts/inspect-d360.cjs clinica_ejemplo
```

El resumen muestra estados y claves internas, sin teléfonos ni contenido.
Ante processing/sending/review_required/delivery_uncertain, comprobar agenda,
historial y entrega del proveedor ANTES de intervenir. No cambiar manualmente
un evento a queued sin reconciliarlo: podría repetir una reserva o mensaje.
No hay todavía interfaz de resolución ni reintento seguro de outbox.

El inbox alcanza un límite conservador de 5000 eventos por clínica y devuelve
503 ante nuevas entradas; falta archivo/retención automatizada. No borrar
registros de deduplicación a ciegas. El volumen y sus snapshots contienen datos
personales y requieren acceso restringido. No almacenar en outputs públicos.

Preparación para UN proceso con volumen persistente. No acredita atomicidad
entre Supabase y archivos, coordinación entre réplicas ni ausencia de carreras
con una operación que ya comenzó. Falta medir ACK <5 s con BD real: ecos hacen
lecturas/escrituras antes de confirmación. Fallos conservan respuesta 503.
Solo mensajes textuales dentro de la ventana de atención; plantillas y
recordatorios 360dialog no están habilitados. Cuenta, coexistencia, permisos,
entrega real, latencia, estados del panel y notas de voz siguen abiertos.

La tabla channel_accounts todavía restringe provider a web/Meta/Twilio/voz/other;
este conector no crea cuentas ahí. Antes del alta de producción decidir y probar
la ampliación del constraint y una gestión segura de secretos por cuenta.

Fuentes primarias consultadas 2026-10-01:
[Messages API](https://docs.360dialog.com/docs/messaging-api/api-reference/messages),
[Basic Auth y configuración](https://docs.360dialog.com/docs/messaging/webhook),
[Payloads y ecos](https://docs.360dialog.com/docs/messaging/webhook/webhook-reference).

Pruebas reproducibles: node --test test/360dialog.test.js test/human-echo.test.js
test/api-isolation.test.js. Proveedores y Supabase simulados; cero mensajes reales.
