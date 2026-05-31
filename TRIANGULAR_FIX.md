# TRIANGULAR_FIX

## Qué estaba mal

- La UI ya tenía controles visuales para **Triangular**, pero las tablas principales seguían leyendo `opportunities`, que son oportunidades **Cross-Exchange** (`buyExchange` → `sellExchange`). Por eso, al cambiar de estrategia, el dashboard mezclaba métricas y mostraba compras/ventas entre exchanges.
- El resumen y la gráfica principal no diferenciaban la estrategia efectiva: siempre estaban optimizados para comparar BTC entre exchanges, incluso cuando la estrategia seleccionada debía operar dentro de un solo venue.
- El motor triangular descartaba silenciosamente monedas sin los tres pares necesarios (`BTC/USDT`, `COIN/USDT`, `COIN/BTC`). Eso dejaba paneles con `$0`, `0%` y “sin ruta” sin explicar si faltaban pares o profundidad.
- El cálculo triangular usaba top-of-book simple. Ahora camina el order book en cada pata para estimar fill real, profundidad consumida y fees.
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
  - Mantiene los feeds LIVE vía ccxt y SIM separados, sin tocar el modo Cross-Exchange.

- `src/server/index.ts`
  - Normaliza la estrategia a dos modos manuales: `cross` y `triangular`.
  - Elimina el cambio automático de estrategia del servidor.
  - Mantiene el motor triangular independiente y persistente, usando un único exchange seleccionado.
  - Publica al frontend candidatos triangulares, monedas disponibles/activas y exchange seleccionado.

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

## Pasos manuales recomendados en navegador/devtools

- En la consola de red, revisar el frame de `/stream`:
  - `strategy.effective` debe ser `cross` o `triangular`.
  - `triangular.exchange` debe contener un solo exchange.
  - `triangular.activeCoins` debe contener las monedas puente activas.
  - `triangular.candidates` debe contener filas triangulares con `path`, `feeCostUSDT`, `status` y `missingPairs` cuando aplique.
- Cambiar entre Cross-Exchange y Triangular varias veces y confirmar que la tabla cambia de formato sin recargar.
- En Triangular, cambiar el exchange seleccionado y confirmar que el badge y las rutas cambian al nuevo exchange.
- Desactivar/activar monedas puente y confirmar que la lista de candidatos se actualiza sin mezclar oportunidades Cross-Exchange.
- Probar en viewport estrecho para confirmar que la grilla de monedas cae limpiamente en varias filas.

## Checks ejecutados

- `npm run build`
- `npm test`
- Smoke test local con `SOURCE=sim PORT=8099 npm run server`, cambio a `strategy=triangular` y lectura de `/state` para confirmar candidatos triangulares activos.
