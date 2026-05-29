# Corrección del dashboard Next.js con datos vivos

## Qué se corrigió

- Se centralizó la configuración visual de exchanges en `lib/exchange-visuals.ts`.
- Se agregaron valores fallback seguros para cualquier exchange conocido o desconocido:
  - `bgColor`
  - `textColor`
  - `iconColor`
  - `icon`
- Se normalizan nombres recibidos desde `/stream`, por ejemplo:
  - `binance` → `Binance`
  - `kraken` → `Kraken`
  - `okx` → `OKX`
  - `gate` → `Gate.io`
- Se cubrieron exchanges adicionales que el motor puede emitir: `KuCoin`, `Bitstamp`, `Bitfinex` y `Gate.io`.
- Si llega un exchange no contemplado, el frontend usa la configuración default y no intenta leer `.bgColor` sobre `undefined`.
- Se reemplazaron accesos inseguros a `config.bgColor` en las cards y tablas del dashboard por `getExchangeVisualConfig(exchange)`, que siempre devuelve una configuración válida.
- Se agregaron estados vacíos/seguros mientras `/stream` todavía no envía datos para evitar renders con arrays vacíos o valores inválidos.
- El hook `useEngineData` ahora normaliza exchanges y números desde el payload vivo de `/stream`, evitando que las cards se queden en cero cuando el stream ya trae libros, oportunidades o trades.
- El dashboard sigue consumiendo `/stream` mediante `EventSource`; no se modificó backend ni lógica del motor.
- Se eliminó la dependencia de `next/font/google` para que `npm run build` no dependa de descargar Google Fonts en el server.
- Se ajustó `npm run test` para ejecutar la suite con `tsx`, tal como indica el propio archivo de tests, evitando errores de resolución ESM con imports sin extensión.

## Cómo probarlo en el server

1. Instalar dependencias si hace falta:

   ```bash
   npm install
   ```

2. Compilar el frontend:

   ```bash
   npm run build
   ```

3. Levantar el backend/motor en otra terminal, por ejemplo en modo simulado:

   ```bash
   PORT=8080 npm run server
   ```

4. Verificar que el backend tiene estado vivo:

   ```bash
   curl http://127.0.0.1:8080/state
   ```

5. Levantar Next.js apuntando al motor:

   ```bash
   ENGINE_ORIGIN=http://127.0.0.1:8080 npm run start
   ```

6. Verificar que el proxy de Next.js mantiene el stream disponible:

   ```bash
   curl -N http://127.0.0.1:3000/stream
   ```

7. Abrir el dashboard:

   ```text
   http://87.99.133.208:3000
   ```

8. Resultado esperado:

   - No aparece `bgColor undefined` en consola.
   - Las cards de precio BTC muestran exchanges recibidos desde `/stream`.
   - Se actualizan bid, ask, spread, latencia, oportunidades, balances y métricas con datos vivos.
   - Si un exchange desconocido aparece en el stream, se muestra con icono/fallback default sin romper el render.
