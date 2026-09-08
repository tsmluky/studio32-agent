# Banco de pruebas del agente

Los tests de `test/` comprueban la fontanería: reservas, huecos, límites de demo.
Esto es otra cosa. Aquí se comprueba **el criterio**: que el agente no se invente un
precio, que sepa que los sábados está cerrado, que no prometa un mensaje que nunca va
a enviar.

Por qué importa: lo que vendemos de este agente no es que conteste rápido —eso lo
hace cualquiera, incluido el agente gratuito de Meta—. Lo que vendemos es que **no
inventa** y que **tiene criterio del oficio**. Hasta ahora eso era una promesa. Con
esto es una prueba que pasa o no pasa, y que se puede volver a pasar cada vez que
alguien toque el prompt o una política.

## Cómo se lanza

```bash
npm run eval
```

Y para ver el detalle de cada caso en el navegador, con la respuesta completa y por
qué la nota fue la que fue:

```bash
npm run eval:view
```

## Lo que necesita

**Una `OPENAI_API_KEY` en el `.env`.** Sin ella, `src/llm.js` cae al proveedor `mock`,
que no razona, y los resultados no valen nada — el propio banco de pruebas te avisa
por consola si eso pasa.

Los casos gastan tokens dos veces: una para que el agente responda y otra para
corregirlo (`llm-rubric` usa `gpt-4o-mini`, que es barato). Una pasada completa de los
doce casos cuesta céntimos, no euros.

promptfoo **no está en las dependencias del proyecto, y es a propósito**: pide `zod` 4
y el `openai` que usa el agente pide `zod` 3, así que instalarlo aquí obliga a forzar
la resolución de dependencias en un repo que se despliega en Railway. Como promptfoo
es una herramienta de línea de comandos y no una librería que importe el código, los
scripts lo lanzan con `npx`, que resuelve sus dependencias en su propio árbol aparte.
La primera vez tarda un poco en descargar; después queda en caché.

## Cómo está montado

`provider-agente.js` habla con el agente de verdad: el mismo system prompt, las mismas
herramientas, el mismo filtro de seguridad. No pasa por `src/orchestrator.js` a
propósito, y el porqué está explicado en la cabecera del archivo — resumido: el
orchestrator persiste conversaciones, suma consumo e hidrata el tenant desde Supabase,
y un banco de pruebas no debe hacer nada de eso.

Las reservas que el agente cree durante una evaluación van a `.eval-data/`, que está
ignorada por git. **Nunca tocan `data/` ni la agenda real de ningún cliente.**

## Añadir un caso

Un caso nuevo son cinco líneas en `promptfooconfig.yaml`:

```yaml
  - description: nombre-corto-del-caso
    vars:
      mensaje: Lo que escribiría el cliente por WhatsApp
    assert:
      - type: llm-rubric
        value: Lo que tiene que cumplir la respuesta, en una frase.
```

La regla práctica: **cada vez que arregles un comportamiento del agente, deja aquí el
caso que lo pillaba**. Así no vuelve.

Hay dos tipos de comprobación y conviene mezclarlas:

- Las deterministas (`not-regex`, `not-icontains`, `javascript`) son gratis y no
  fallan por capricho. Úsalas siempre que la regla se pueda escribir sin ambigüedad
  ("no debe aparecer una cifra en euros").
- `llm-rubric` es para lo que solo se puede juzgar leyendo ("trata el miedo sin
  minimizarlo"). Escribe la nota como se la darías a una persona nueva del equipo.

## Probar el modo dueño

Añade un segundo proveedor en `providers:` con `owner: true` y tendrás los mismos
casos contra el agente en modo dueño, que sí puede consultar la agenda:

```yaml
  - id: file://./provider-agente.js
    label: agente-gh-dent-dueño
    config:
      tenant: gh-dent
      owner: true
```

## Otro tenant

Cambia `tenant:` en `providers`. Ojo: los casos de este archivo están escritos contra
las políticas de GH Dent (valoración gratuita, sin precios por chat, viernes solo por
la mañana). Para un restaurante o una peluquería hacen falta casos propios — lo suyo
es un `promptfooconfig.<tenant>.yaml` por vertical cuando llegue el momento.
