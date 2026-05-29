# Cambios del dashboard ArbiCore

## Archivos del frontend modificados

- `components/dashboard.tsx`: reorganización del layout general del dashboard y simulación de datos live del frontend.
- `components/hero-section.tsx`: rediseño del hero y uso directo de la imagen real `/imagehero.png`.
- `components/kpi-cards.tsx`: nueva jerarquía de métricas con P&L neto como módulo principal.
- `components/btc-exchange-prices.tsx`: nueva sección visual de precio BTC por exchange.
- `components/price-chart.tsx`: gráfica comparativa BTC multi-exchange mejorada.
- `components/opportunities-table.tsx`: tabla de oportunidades con estado operativo.
- `components/recent-operations.tsx`: execution log con fee, slippage, P&L neto y estado.
- `components/risk-engine.tsx`: motor de riesgo mejorado con latencia promedio y actual.
- `components/cost-breakdown.tsx`: nueva sección de desglose de costos.
- `components/balances-chart.tsx`: ajuste de pesos tipográficos para balances/wallets.
- `components/system-health.tsx`: ajuste tipográfico manteniendo salud del sistema.
- `components/header.tsx`: ajuste tipográfico de topbar y estado del motor.
- `components/sidebar.tsx`: ajuste tipográfico y refinamiento de estrategia activa.
- `lib/mock-data.ts`: datos mock de frontend para métricas, precios BTC por exchange, operaciones, riesgo y costos.

## Cambios visuales realizados

- Se mantuvo la identidad clara de ArbiCore: fondo blanco/cyan, cards limpias, azul oscuro, bordes suaves y sombras sutiles.
- Se redujo la sensación de dashboard inflado usando cards con menor peso visual, espaciado más balanceado y jerarquías más claras.
- Se agregaron microinteracciones suaves en cards, botones, estados live y barras de progreso.
- Las tablas ahora son más legibles, con encabezados discretos, texto normal 400/500 y énfasis solo en datos relevantes.

## Corrección de tipografía

- Se mantiene la fuente `Inter` configurada por `next/font` en `app/layout.tsx`.
- Se eliminó el uso extendido de pesos extremos como `font-black` en las secciones del dashboard.
- Los títulos principales usan `font-bold` o `font-semibold` según jerarquía.
- Labels, navegación, tablas y texto secundario usan `font-normal`, `font-medium` o `font-semibold` de forma controlada.
- Los números importantes usan `font-semibold` o `font-bold` solo cuando tienen prioridad visual real.

## Jerarquía del P&L

- El módulo `Net Realized P&L / P&L neto realizado` ahora es la card principal de la zona de métricas.
- El valor principal muestra `$76,745.65` como métrica dominante.
- Incluye variación positiva, número de trades, mejor trade, estado de riesgo y mini gráfica/sparkline.
- Las métricas de portfolio, opportunities, operaciones, capital, exchanges y risk status pasan a cards secundarias alrededor del P&L.

## Uso de `/imagehero.png`

- El hero derecho usa directamente la imagen real del repo mediante:

  ```tsx
  <img src="/imagehero.png" ... />
  ```

- Se eliminó cualquier representación dibujada con HTML/CSS del cubo/bitcoin/hero.
- La imagen usa `object-cover`, `object-center` y bordes redondeados para evitar deformaciones.

## Latencia actual mock/actualizable

- El motor de riesgo contiene dos lecturas separadas:
  - `Latencia promedio`, basada en `averageLatency`.
  - `Latencia actual`, basada en `currentLatency`.
- `currentLatency` se actualiza en `components/dashboard.tsx` cada `1200 ms` con valores mock razonables entre `1.8 ms` y `8.4 ms`.
- Esto evita que la latencia actual quede fija en `0 ms` mientras no exista un endpoint real.
- No se conectó ni modificó ningún endpoint del bot o motor real.

## Módulos nuevos o mejorados

- Resumen financiero principal con P&L neto destacado, portfolio value, trades, opportunities, best trade, risk status, capital asignado y uso de capital.
- Sección `Precio BTC por exchange` con Binance, Kraken, OKX, Coinbase y Bybit, mostrando precio, spread, bid/ask y estado.
- Gráfica comparativa BTC con líneas para Binance, Coinbase, Kraken y OKX.
- Tabla de oportunidades detectadas con comprar en, vender en, spread, volumen, beneficio estimado y estado.
- Execution log con hora, comprar, vender, volumen, fee, slippage, P&L neto y estado `FILLED`, `PARTIAL` o `REJECTED`.
- Wallets/balances por exchange con donut chart y total estimado.
- Cost breakdown con gross profit, trading fees, slippage, latency penalty y net profit.
- Motor de riesgo con latencia promedio, latencia actual, slippage, circuit breaker, rechazadas, exposición neta, uso de margen y estado.
- Salud del sistema con uptime, conectividad, feeds de mercado, ejecución, base de datos y última verificación.
- Estrategia activa en sidebar con `Triangular BTC`, capital asignado, uso de capital y botón para pausar motor.

## Confirmación sobre bot/motor de arbitraje

No se modificó, movió, formateó, refactorizó ni optimizó ningún archivo del bot/motor de arbitraje, trading, estrategias, WebSockets, conectores de exchanges, execution engine, market data, backend ni scripts reales del sistema.

Los cambios se limitaron a archivos visuales del frontend/dashboard y a datos mock usados por el frontend.

## Pasos manuales necesarios

- No hay pasos manuales obligatorios.
- Si en el futuro existe un endpoint real de latencia actual, reemplazar únicamente el mock de `currentLatency` del frontend por la lectura real sin tocar la lógica del motor.
