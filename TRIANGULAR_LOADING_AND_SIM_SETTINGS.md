# Triangular loading + Configuración LIVE/SIM

## Archivos modificados

- `src/server/index.ts`
  - Convierte la fuente de datos en un estado runtime persistente (`LIVE` / `SIM`).
  - Permite cambiar la fuente desde `/control?cmd=data-mode&value=live|sim` sin reiniciar el dashboard.
  - Reconstruye el motor, wallets, feed cross-exchange y feed triangular al cambiar de fuente para no mezclar datos reales y simulados.
  - Publica `triangular.sync` en el estado SSE con progreso de carga, pares listos, WebSockets pendientes, pares no disponibles y endpoints bloqueados.

- `src/server/prefs.ts`
  - Agrega `dataMode` a las preferencias persistidas en backend.
  - La selección se guarda en `data/arbicore-prefs.json` o en `${DATA_DIR}/arbicore-prefs.json` si `DATA_DIR` está configurado.

- `src/exchanges/tri-source.ts`
  - Agrega progreso/status por par para feeds triangulares.
  - Agrega `getRequiredPairs()` al contrato `TriFeed`.
  - En LIVE valida disponibilidad de mercados spot antes de dejar un par esperando WebSocket.
  - Usa Binance `exchangeInfo` para Binance y `ccxt.loadMarkets()` para otros exchanges como Kraken.
  - Diferencia `Cargando`, `Listo`, `Par no disponible`, `WebSocket pendiente`, `Endpoint bloqueado` y `Sin liquidez`.
  - Usa timeout configurable `TRI_WS_TIMEOUT_MS` (default `8000`) para pasar de carga inicial a WebSocket pendiente.
  - Mantiene logs deduplicados por par/motivo para evitar spam infinito.

- `src/exchanges/triangular.ts`
  - Expone estados triangulares más claros para la UI.
  - Marca rutas priceables como `Listo` cuando no son ejecutables por margen, en lugar de dejarlas en espera ambigua.
  - Propaga motivos por par faltante para que la UI explique por qué una moneda no está lista.

- `src/server/public/index.html`
  - Agrega badge global `LIVE · Datos reales` / `SIM · Simulación activa`.
  - Agrega en Configuración el toggle visible `Fuente de datos` con `Real / LIVE` y `Simulación / SIM`.
  - Muestra panel de sincronización triangular con progreso: rutas listas, order books listos, WebSockets pendientes y pares no disponibles.
  - Evita mostrar ceros sin contexto durante la sincronización y explica que no todos los exchanges tienen todos los pares.

## Cómo funciona el loading al cambiar exchange triangular

1. El usuario selecciona un exchange en modo Triangular.
2. La UI llama `/control?cmd=tri-exchange&value=<exchange>`.
3. El backend:
   - limpia el feed triangular anterior,
   - crea un `TriangularEngine` nuevo para el exchange seleccionado,
   - inicializa las rutas candidatas con estado `Cargando`,
   - arranca el feed triangular LIVE o SIM según la fuente de datos actual,
   - vuelve a calcular rutas con los books del nuevo exchange.
4. El estado SSE incluye `triangular.sync` con:
   - `loading`,
   - `slow`,
   - `message`,
   - `detail`,
   - `readyRoutes / totalRoutes`,
   - `readyPairs / totalPairs`,
   - `waitingWebSockets`,
   - `unavailablePairs`,
   - `blockedPairs`.
5. Mientras `loading=true`, la UI muestra mensajes como:
   - `Sincronizando order books de Kraken…`
   - `Cargando pares BTC/USDT, ETH/USDT y ETH/BTC…`
6. Si el timeout expira y aún faltan pares, la UI muestra:
   - `Algunos pares siguen esperando WebSocket`
   - manteniendo activas las rutas que sí estén listas.

## Cómo se detectan pares faltantes vs WebSockets pendientes

- `Par no disponible`
  - Binance: se consulta `exchangeInfo` del endpoint spot configurado.
  - Otros exchanges: se consulta `ccxt.loadMarkets()` y se filtran mercados spot activos.
  - Si el par no existe en el listado del exchange, se marca como no disponible antes de esperar indefinidamente al WebSocket.

- `Endpoint bloqueado`
  - Si la consulta de disponibilidad falla por bloqueo/restricción o el conector no existe, el par se marca con ese motivo.

- `Cargando`
  - Estado inicial mientras se abre WebSocket y se espera el primer snapshot/order book.

- `WebSocket pendiente`
  - Si no llega book antes de `TRI_WS_TIMEOUT_MS` (default 8 segundos), deja de mostrarse como carga indefinida y pasa a pendiente.

- `Sin liquidez`
  - Si existe book pero no tiene bid/ask suficiente para pricear la ruta.

- `Listo`
  - El par/ruta tiene books suficientes para calcular precio, aunque el arbitraje no sea rentable.

## Cómo funciona el toggle LIVE/SIM

En Configuración aparece `Fuente de datos` con dos opciones:

- `Real / LIVE`
  - Usa WebSockets/order books reales para cross-exchange.
  - Usa feed triangular LIVE por exchange.

- `Simulación / SIM`
  - Reutiliza `SimulatedSource` para cross-exchange.
  - Reutiliza `SimTriFeed` para triangular.
  - Genera divergencias controladas para oportunidades, operaciones, P&L, gráficas, wallets/balances, métricas, triangular y cross-exchange.

Al cambiar fuente:

1. El backend persiste `dataMode`.
2. Se detiene la fuente anterior.
3. Se reinician engine, wallets, estadísticas runtime y curva P&L para no mezclar datos LIVE con SIM.
4. Se arranca la nueva fuente.
5. Se reconstruye Triangular con la fuente actual.
6. El badge global cambia a `LIVE · Datos reales` o `SIM · Simulación activa`.

## Dónde se guarda la persistencia

La persistencia backend vive en:

- `data/arbicore-prefs.json` por defecto.
- `${DATA_DIR}/arbicore-prefs.json` si se define `DATA_DIR`.

Ahí se guardan, entre otros:

- `strategy`,
- `triExchange`,
- `triCoins`,
- `activeExchanges`,
- `riskAppetite`,
- `dataMode`.

## Cómo probar LIVE

1. Iniciar el servidor:

   ```bash
   SOURCE=live npm run server
   ```

2. Abrir el dashboard.
3. Ir a Configuración.
4. Seleccionar `Real / LIVE`.
5. Verificar que el badge global diga `LIVE · Datos reales`.
6. Verificar que oportunidades, books, wallets, métricas y triangular usen datos reales.

## Cómo probar SIM

1. Iniciar el servidor:

   ```bash
   npm run server
   ```

2. Abrir Configuración.
3. Seleccionar `Simulación / SIM`.
4. Verificar que el badge global diga `SIM · Simulación activa`.
5. Verificar que el dashboard no quede en ceros:
   - oportunidades,
   - operaciones,
   - P&L,
   - gráficas,
   - triangular,
   - cross-exchange,
   - wallets/balances,
   - métricas.

## Cómo probar Triangular en Kraken y Binance

1. Ir a Estrategias y seleccionar `Triangular`.
2. Ir a Exchanges.
3. Seleccionar `Kraken` o `Binance` como único exchange triangular.
4. Confirmar que aparece el panel de sincronización:
   - `Sincronizando order books de Kraken…` o `Sincronizando order books de Binance…`
   - progreso de rutas y pares.
5. Verificar que:
   - rutas con pares existentes pasan a `Listo` o `Ejecutable`,
   - pares inexistentes aparecen como `Par no disponible`,
   - WebSockets lentos pasan a `WebSocket pendiente`,
   - endpoints restringidos aparecen como `Endpoint bloqueado`,
   - no se muestran datos viejos del exchange anterior.
