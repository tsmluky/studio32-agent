# Studio32 Agent Platform · validación E2E del MVP

Estado: validado en entorno Bonto/Supabase el 12/07/2026.

## Entorno

- Backend: `https://studio32-agent2.bonto.run`
- Datos/Auth: proyecto Supabase `studio32-agent-platform`
- Organización demo: `GH Dent · Clínica Dental` (`gh-dent`)
- Panel independiente: repositorio `github.com/tsmluky/studio32-panel`

Las credenciales de prueba y las claves de servidor no se guardan en este
documento ni en los repositorios.

## Recorrido validado

1. Un usuario autenticado inicia sesión y solo recibe la organización de la
   que es miembro.
2. Una conversación web queda registrada con contacto, mensajes y estado de
   control del agente.
3. El operador toma el control desde el panel; el siguiente mensaje entrante
   se conserva y el agente no responde.
4. El operador envía una respuesta humana y devuelve la conversación al
   agente.
5. El siguiente mensaje vuelve a recibir respuesta automática.
6. Un cambio de servicio en el panel (precio orientativo de blanqueamiento)
   se carga desde Supabase en la siguiente conversación; la respuesta validada
   informa 279 EUR y 45 minutos.
7. El agente crea una primera valoración para GH Dent. La reserva se persiste
   en `appointments` como `confirmed`, con contacto, servicio y conversación
   asociados.
8. La vista Citas del panel lee las citas de Supabase y permite una
   cancelación con confirmación explícita.

## Garantías implementadas

- El backend persiste las reservas tanto si la fecha llega como `YYYY-MM-DD`
  como `DD/MM/YYYY`.
- `scripts/sync-bookings-to-supabase.js <tenant>` recupera reservas JSON
  antiguas de forma idempotente mediante `metadata.legacy_id`.
- Los servicios y la configuración activa de Supabase se hidratan para cada
  respuesta, por lo que no requieren reiniciar el agente tras editar el panel.
- Las tablas operativas del panel están en la publicación `supabase_realtime`.
- Las acciones de panel se autentican otra vez en el backend; el navegador
  nunca recibe la service-role key.

## Comprobaciones locales

```bash
npm run test:supabase
npm run check:supabase
npm run supabase:sync-bookings -- gh-dent
```

## Pendientes de entrega

### Estado de publicacion (12/07/2026)

- `studio32-panel` ya tiene repositorio privado, configuracion de build y
  redirect SPA para Netlify. Falta completar la autorizacion GitHub -> Netlify
  y decidir el dominio final (`panel.studio32.es` o el subdominio temporal de
  Netlify).
- Cuando exista el dominio final, debe incluirse en `CORS_ORIGINS` de Bonto y
  reiniciarse la aplicacion. Los origenes de desarrollo y el dominio previsto
  ya estan contemplados.
- El canal Twilio no esta activo todavia: se verifico que
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_WHATSAPP_NUMBER` no
  estan configuradas en Bonto. Se necesitan antes de la prueba Sandbox.

- Desplegar `studio32-panel` en el proveedor de hosting y asignar
  `panel.studio32.es`.
- Añadir el origen final del panel a `CORS_ORIGINS` de Bonto.
- Ejecutar el mismo guion desde Twilio Sandbox y guardar el guion comercial de
  demostración.
