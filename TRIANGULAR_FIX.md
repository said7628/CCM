# TRIANGULAR_FIX

## Qué estaba mal

- La UI ya tenía controles visuales para **Triangular**, pero las tablas principales seguían leyendo `opportunities`, que son oportunidades **Cross-Exchange** (`buyExchange` → `sellExchange`). Por eso, al cambiar de estrategia, el dashboard mezclaba métricas y mostraba compras/ventas entre exchanges.
- El resumen y la gráfica principal no diferenciaban la estrategia efectiva: siempre estaban optimizados para comparar BTC entre exchanges, incluso cuando la estrategia seleccionada debía operar dentro de un solo venue.
- El motor triangular descartaba silenciosamente monedas sin los tres pares necesarios (`BTC/USDT`, `COIN/USDT`, `COIN/BTC`). Eso dejaba paneles con `$0`, `0%` y “sin ruta” sin explicar si faltaban pares o profundidad.
- El cálculo triangular usaba top-of-book simple. Ahora camina el order book en cada pata para estimar fill real, profundidad consumida y fees.
- En LIVE, la fuente triangular anterior podía caer en `ccxt`/Binance con carga de mercados no spot y terminar consultando `https://fapi.binance.com/fapi/v1/exchangeInfo`, generando errores 451. Triangular debe ser spot y ahora usa WebSockets spot nativos cuando existen.
- La selección de estrategia todavía exponía **Auto (bot decide)**, aunque el flujo esperado solo permite **Cross-Exchange** y **Triangular**.
- En simulación, la profundidad sintética era fija en unidades base para todas las monedas. Eso hacía que monedas baratas como DOGE/XRP/ADA parecieran sin profundidad aunque el modo SIM debería producir rutas comparables.

## Archivos modificados

- `src/exchanges/triangular.ts`
  - Reescribe la evaluación triangular para caminar profundidad de libro por cada pata.
  - Evalúa ambas direcciones por moneda:
    - `USDT → BTC → COIN → USDT`
    - `USDT → COIN → BTC → USDT`
  - Devuelve rutas candidatas para todas las monedas activas, incluyendo estados claros:
    - `Ejecutable`
    - `En espera`
    - `Sin pares suficientes`
    - `Sin profundidad suficiente`
  - Expone `feeCostUSDT`, `status` y `missingPairs` para el dashboard.
  - Activa por defecto todas las monedas candidatas liquidas configuradas (`ETH`, `SOL`, `XRP`, `BNB`, `ADA`, `DOGE`, `LTC`, `USDC`, `EUR`).

- `src/exchanges/tri-source.ts`
  - Ajusta la profundidad sintética para que sea proporcional al notional de cada nivel, no una cantidad base fija.
  - Añade `NativeWsTriFeed` para LIVE spot: usa los conectores WebSocket nativos por par (`BTC/USDT`, `COIN/USDT`, `COIN/BTC`) y cachea disponibilidad spot.
  - Para Binance usa `data-stream.binance.vision` + `data-api.binance.vision/api/v3` (spot), nunca `fapi.binance.com`.
  - Mantiene `CcxtTriFeed` como fallback REST spot para `live-rest`, con logs rate-limited por par y estados claros.

- `src/server/index.ts`
  - Normaliza la estrategia a dos modos manuales: `cross` y `triangular`.
  - Elimina el cambio automático de estrategia del servidor.
  - Mantiene el motor triangular independiente y persistente, usando un único exchange seleccionado.
  - En `SOURCE=live` conecta Triangular a `NativeWsTriFeed` spot; en `SOURCE=live-rest` usa el fallback CCXT spot.
  - Publica al frontend candidatos triangulares, monedas disponibles/activas, estados por par y exchange seleccionado.

- `src/server/prefs.ts`
  - Actualiza la documentación del preference `strategy` para reflejar que solo se exponen `cross` y `triangular`.

- `src/server/public/index.html`
  - El selector de estrategia ya no renderiza **Auto (bot decide)**.
  - En modo Cross-Exchange conserva la vista anterior: varias wallets/exchanges, tabla comprar/vender, gráfica BTC entre exchanges.
  - En modo Triangular cambia la UI para:
    - mostrar badge `Triangular · <exchange>`;
    - destacar un solo exchange;
    - mostrar monedas activas en grid responsive;
    - cambiar la tabla de oportunidades a formato triangular;
    - cambiar el scanner del resumen a rutas candidatas;
    - cambiar la gráfica principal a una visualización de profit/fees por rutas/monedas;
    - no mezclar oportunidades Cross-Exchange en las vistas triangulares.

## Cómo funciona ahora Triangular

1. El usuario selecciona **Triangular** en la vista **Estrategias**.
2. El exchange triangular se toma de la sección **Exchanges** en modo single-select.
3. Solo ese exchange se usa visualmente y para la lógica de rutas triangulares.
4. `BTC` y `USDT` son anclas obligatorias y aparecen bloqueadas en el panel de monedas.
5. Las monedas activas (`ETH`, `SOL`, `XRP`, `BNB`, `ADA`, `DOGE`, `LTC`, `USDC`, `EUR`, etc.) se usan como monedas puente.
6. Para cada moneda puente el motor intenta evaluar las dos rutas:
   - `USDT → BTC → MONEDA → USDT`
   - `USDT → MONEDA → BTC → USDT`
7. Cada pata usa el order book disponible:
   - compra: camina `asks` hasta cubrir el notional;
   - venta: camina `bids` hasta vender el monto recibido;
   - resta taker fees en cada pata;
   - marca falta de profundidad cuando no puede llenar la ruta completa.
8. Si faltan pares, la ruta queda visible con `Sin pares suficientes` y lista los pares faltantes en UI.
9. La mejor ruta se muestra como recomendada; la tabla conserva todas las candidatas para diagnóstico.


## Corrección SPOT vs Futures

- El problema de `fapi.binance.com` aparecía porque la fuente triangular LIVE dependía de carga REST/CCXT para pares múltiples y Binance podía resolver mercados usando endpoints de futures. Eso no sirve para triangular porque la estrategia ocurre en **spot**.
- En `SOURCE=live`, Triangular ahora usa `NativeWsTriFeed`: crea un WebSocket spot por order book necesario y usa el conector spot existente de Binance.
- Para Binance, la disponibilidad de pares se carga una sola vez desde `BINANCE_REST_BASE/api/v3/exchangeInfo` (por defecto `https://data-api.binance.vision/api/v3/exchangeInfo`) y se cachea. No se consulta `exchangeInfo` por tick ni por moneda en loop.
- Los snapshots de profundidad de Binance se toman desde `data-api.binance.vision/api/v3/depth`; los updates llegan por `data-stream.binance.vision`. Ambos son spot.
- Si el endpoint está bloqueado, el estado de cada ruta muestra `Endpoint bloqueado`; si un símbolo no existe en spot, muestra `Par no disponible`; si el socket aún no sincroniza, muestra `Esperando WebSocket` o `Sin order book todavía`.

## Cómo probar Cross-Exchange

1. Ejecutar:

   ```bash
   npm run server
   ```

2. Abrir el dashboard en `http://localhost:8080`.
3. Ir a **Estrategias** y seleccionar **Cross-Exchange**.
4. Verificar:
   - aparecen múltiples exchanges activos;
   - la gráfica principal dice `Comparativa BTC entre exchanges`;
   - la tabla muestra columnas `Comprar en` y `Vender en`;
   - la sección de oportunidades compara exchange A contra exchange B;
   - las tarjetas de exchanges respetan el filtro multi-select de la pestaña **Exchanges**.

## Cómo probar Triangular

1. Ejecutar:

   ```bash
   npm run server
   ```

2. Abrir `http://localhost:8080`.
3. Ir a **Estrategias** y seleccionar **Triangular**.
4. Ir a **Exchanges** y seleccionar un único venue, por ejemplo **Binance**.
5. En **Monedas para triangular**, verificar que `BTC` y `USDT` están bloqueadas como base y que las demás monedas aparecen en grid responsive.
6. Volver a **Resumen** o **Oportunidades** y verificar:
   - aparece el badge `Triangular · Binance` (o el exchange seleccionado);
   - solo el exchange seleccionado se destaca como principal;
   - el scanner ya no muestra `Comprar en / Vender en` entre exchanges;
   - las rutas muestran `Moneda puente`, `Ruta`, `Profit estimado`, `Profit %`, `Fees` y `Estado`;
   - si una moneda no tiene pares suficientes en LIVE, aparece `Sin pares suficientes` con pares faltantes.



## Cómo probar Binance spot LIVE

1. Ejecutar:

   ```bash
   SOURCE=live npm run server
   ```

2. Seleccionar **Triangular** y **Binance**.
3. En logs debe verse sincronización spot (`data-stream.binance.vision` / `data-api.binance.vision`) y no debe aparecer `fapi.binance.com`.
4. En DevTools, revisar `/state` o `/stream`:
   - `triangular.exchange` debe ser `binance`.
   - `triangular.candidates[*].status` debe ser `Ejecutable`, `En espera`, `Esperando WebSocket`, `Par no disponible` o `Endpoint bloqueado` según el caso real.
   - No debe haber filas Cross-Exchange en la tabla triangular.

## Cómo probar otro exchange si Binance está bloqueado

1. Ir a **Exchanges** con Triangular activo.
2. Seleccionar OKX, Kraken, KuCoin u otro conector WebSocket disponible.
3. Confirmar que el badge cambia a `Triangular · <exchange>`.
4. Si el exchange no publica algún `COIN/BTC` o `COIN/USDT`, la fila debe indicar `Par no disponible` o `Sin order book todavía`, no quedarse en ceros sin explicación.

## Cómo probar LIVE/SIM

- SIM:

  ```bash
  SOURCE=sim npm run server
  ```

  Debe generar libros sintéticos para `BTC/USDT`, `COIN/USDT` y `COIN/BTC`, y poblar rutas/profits/fees.

- LIVE spot:

  ```bash
  SOURCE=live npm run server
  ```

  Debe usar WebSockets spot nativos para los pares necesarios.

- LIVE REST fallback:

  ```bash
  SOURCE=live-rest npm run server
  ```

  Debe usar CCXT configurado como spot (`defaultType: spot`) y logs rate-limited por par si algo falla.

## Pasos manuales recomendados en navegador/devtools

- En la consola de red, revisar el frame de `/stream`:
  - `strategy.effective` debe ser `cross` o `triangular`.
  - `triangular.exchange` debe contener un solo exchange.
  - `triangular.activeCoins` debe contener las monedas puente activas.
  - `triangular.candidates` debe contener filas triangulares con `path`, `feeCostUSDT`, `status`, `missingPairs` y `reasons` cuando aplique.
- Cambiar entre Cross-Exchange y Triangular varias veces y confirmar que la tabla cambia de formato sin recargar.
- En Triangular, cambiar el exchange seleccionado y confirmar que el badge y las rutas cambian al nuevo exchange.
- Desactivar/activar monedas puente y confirmar que la lista de candidatos se actualiza sin mezclar oportunidades Cross-Exchange.
- Probar en viewport estrecho para confirmar que la grilla de monedas cae limpiamente en varias filas.

## Checks ejecutados

- `npm run build`
- `npm test`
- Smoke test local con `SOURCE=sim PORT=8099 npm run server`, cambio a `strategy=triangular` y lectura de `/state` para confirmar candidatos triangulares activos.
- Smoke test local con `SOURCE=live PORT=8100 npm run server` en entorno con DNS bloqueado: confirmó estados `Endpoint bloqueado` sin `fapi.binance.com` ni spam en loop.
