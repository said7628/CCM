# Auditoría realtime del dashboard

## Hallazgos

### Dashboard anterior rápido

- El dashboard simple anterior estaba en `src/server/public/index.html` (histórico: commit `dfa4101`). Era HTML + JavaScript servido por el mismo proceso HTTP del motor en el puerto `8080`.
- La fuente de verdad era el stream SSE real `EventSource('/stream')`; no usaba mocks ni polling HTTP para datos críticos.
- El servidor del dashboard/motor generaba el payload desde `onTick(engine.tick(books), books)` y exponía libros, P&L, oportunidades, trades, fees, slippage, riesgo y wallets.
- La UI anterior actualizaba el DOM directamente en `es.onmessage`, por lo que evitaba un render completo de React por cada tick. La gráfica era un canvas dibujado manualmente.

### Dashboard nuevo antes de este cambio

- El dashboard Next.js ya consumía `EventSource('/stream')` desde `lib/use-engine-data.ts`; no había `setInterval` ni `fetch` repetido en el frontend para P&L, precios, spreads, oportunidades, latencia, trades o fees/slippage.
- Next.js estaba configurado para proxyear `/stream`, `/state` y `/control` hacia el motor mediante rewrites same-origin. Esto evita CORS y preflights desde el navegador.
- El cuello de botella real era doble:
  1. El servidor emitía el último snapshot SSE en un `setInterval(..., 50)`, agregando hasta 50 ms de espera artificial incluso cuando el motor ya tenía un tick nuevo.
  2. El hook React reconstruía todo el modelo y hacía `setData` en cada mensaje; eso hacía re-render del dashboard completo y de gráficas pesadas en cada tick.

## Cambios aplicados

- El stream SSE ahora se envía inmediatamente dentro de cada tick real del motor (`broadcastLatest()` en `onTick`) y el intervalo periódico se reemplazó por un heartbeat SSE que no reenvía datos viejos.
- El payload agrega metadatos no transaccionales (`streamSeq`, `emittedAt`) para medir transporte y orden de frames sin modificar el bot ni la lógica de arbitraje.
- El frontend mantiene `EventSource` como fuente de verdad, con soporte opcional para `NEXT_PUBLIC_ENGINE_STREAM_URL` si se necesita apuntar directo al backend. Por defecto sigue usando `/stream` same-origin y el proxy existente de Next.js.
- Los renders se agrupan con `requestAnimationFrame` para pintar como máximo una vez por frame y medir `dataReceivedAt`, `renderedAt`, `visualLatencyMs` y `updatesPerSecond` con `performance.now()`.
- La serie de gráfica se desacopla de los datos críticos y se muestrea cada 250 ms para no bloquear P&L, precios, spreads, oportunidades, latencia, trades ni costes.
- Las secciones principales del dashboard se envolvieron con `React.memo` para reducir renders innecesarios cuando sus props no cambian.

## Estado esperado

- Datos críticos: stream SSE real existente (`/stream`).
- No hay mocks, simulación visual ni polling HTTP en el frontend para datos críticos.
- Para baja latencia en producción, mantener el navegador en same-origin (`/stream`) con el rewrite actual o apuntar `NEXT_PUBLIC_ENGINE_STREAM_URL` directamente al backend si se detecta buffering en un proxy externo.
- Si la fuente de mercado es `SOURCE=live-rest`, la latencia mínima seguirá limitada por REST. Para actualizaciones de 7–15 ms se requiere `SOURCE=live`/WebSocket y exchanges que publiquen a esa cadencia; el frontend ya no agrega el intervalo artificial de 50 ms.
