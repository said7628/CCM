# Soporte Triangular en Wallets/Exchanges

Este documento describe el soporte visual y lógico para la estrategia **Triangular**
añadido sin romper **Cross-Exchange**. Resume qué archivos se modificaron, cómo
conviven ambas estrategias, dónde vive la persistencia, cómo probarlo a mano y
qué pasos manuales hacen falta.

---

## 1. Archivos modificados

Se tocaron **exactamente 5 archivos**, todos dentro de `src/`. No se cambió
`package.json`, `tsconfig.json`, ni ningún test.

| Archivo | Qué cambió |
|---|---|
| `src/exchanges/triangular.ts` | Generalizado de un triángulo fijo (solo ETH) a **multi-moneda**. Evalúa cada moneda activa contra el ancla BTC/USDT en ambas direcciones y elige la mejor ruta. Se mantienen `detectTriangular` y `TriangularEngine` retrocompatibles. |
| `src/exchanges/tri-source.ts` | El feed (SIM y CCXT live) ahora genera dinámicamente los pares de **todas las monedas activas** (`COIN/USDT`, `COIN/BTC`) además del ancla `BTC/USDT`. Añade `setCoins()` para cambiar monedas sin reconectar. |
| `src/server/prefs.ts` | Persistencia ampliada con `triExchange` (exchange triangular) y `triCoins` (monedas candidatas activas). |
| `src/server/index.ts` | El motor triangular ahora está **siempre instanciado** (lo controla la UI), se **restaura desde disco** al arrancar, y expone nuevos comandos `/control`: `tri-exchange` y `tri-coins`. El estado SSE incluye la config triangular completa. |
| `src/server/public/index.html` | Dashboard: toggles de exchange en **modo selección única** cuando Triangular está activo; panel de **monedas candidatas con toggles** (BTC/USDT bloqueados como base); tarjeta resumen en el dashboard y panel detallado en la vista *Estrategias*. |

### Detalle de la lógica nueva (`triangular.ts`)

- `TRI_BASE_COINS = ['BTC','USDT']` — anclas obligatorias, nunca son candidatas.
- `DEFAULT_TRI_COINS = ['ETH','SOL','XRP','BNB','ADA','DOGE','LTC','USDC','EUR']` — las
  ~10 monedas líquidas ofrecidas (junto a las 2 base suman las 11 pedidas).
- `DEFAULT_TRI_COINS_ACTIVE = ['ETH','SOL','XRP','BNB']` — set activo por defecto (modesto,
  para que el polling LIVE no dispare demasiadas llamadas).
- `pairsForCoin(coin)` → los 3 pares del loop de esa moneda: `BTC/USDT`, `COIN/USDT`, `COIN/BTC`.
- `evalCoinTriangle(books, coin, params)` → evalúa **una** moneda en ambas direcciones:
  - **A:** `USDT→BTC→COIN→USDT`
  - **B:** `USDT→COIN→BTC→USDT`
  y devuelve la mejor, con `feeCostUSDT` (fees de las 3 patas) y `takerFee`.
- `detectTriangularMulti(books, params, coins)` → evalúa **todas** las monedas activas y
  devuelve el mejor loop global + el desglose por moneda.
- `TriangularEngine` ahora acepta `coins`, tiene `setCoins()`/`getCoins()`/`getExchange()`,
  y `getState()` expone `coins`, `candidates`, `feeCostUSDT`, `takerFee` y `notionalUSDT`.
- `detectTriangular()` (firma vieja) se conserva y delega en `evalCoinTriangle(..., 'ETH', ...)`,
  por eso **los 80 tests existentes siguen pasando sin cambios**.

---

## 2. Cómo funciona Cross-Exchange vs Triangular

Las dos estrategias mantienen **estados completamente separados**. No se mezclan en
ningún punto: usan comandos distintos, campos de estado distintos y motores distintos.

### Cross-Exchange (sin cambios de comportamiento)
- **Varios** exchanges activos a la vez (multi-toggle, igual que antes).
- El conjunto activo vive en `engine.activeExchanges` y se controla con
  `/control?cmd=exchanges`. Se refleja en el estado SSE como `s.activeExchanges`.
- En la UI: toggles tipo interruptor + botones **Todos / Ninguno**.
- La detección de arbitraje cruzado opera sobre esos venues. Todo idéntico al original.

### Triangular (nuevo)
- **Un solo** exchange activo a la vez. La triangulación ocurre **dentro** de ese venue.
- Al activar un exchange en modo Triangular, los demás se desactivan automáticamente
  (los toggles pasan a comportarse como **radio buttons**, selección única).
- El venue triangular vive en una variable independiente del servidor (`triExchange`,
  motor `TriangularEngine`) y se controla con `/control?cmd=tri-exchange`. **No** toca
  `activeExchanges` de Cross-Exchange.
- Debajo de la sección de exchanges aparece el **panel de monedas candidatas**:
  - BTC y USDT salen **bloqueadas y siempre activas** (etiqueta "Base"), porque son las
    anclas del reto de arbitraje de Bitcoin.
  - Las demás monedas (`ETH, SOL, XRP, BNB, ADA, DOGE, LTC, USDC, EUR`) tienen toggle
    para activarlas/desactivarlas.
  - Las monedas activas son las candidatas para rutas tipo `USDT→BTC→ETH→USDT` y
    `USDT→ETH→BTC→USDT`. Se controlan con `/control?cmd=tri-coins`.

### Qué muestra el dashboard en modo Triangular
- **Resumen:** tarjeta "Estrategia activa · Triangular" con el exchange seleccionado,
  monedas activas, ruta recomendada, profit estimado y fees.
- **Estrategias:** panel detallado con exchange, monedas activas, ruta recomendada,
  profit estimado, profit %, fee taker, costo de fees (3 patas) y una tabla de
  **rutas candidatas por moneda** con su estado (ejecutable / en espera).
- **Configuración:** filas "Triangular · exchange" y "Triangular · monedas".

### Cómo se conectó a la lógica existente
La triangulación ya existía (`detectTriangular`, `TriangularEngine`, `tri-source.ts`).
Se conectó a la nueva configuración así:
- El servidor instancia el `TriangularEngine` siempre (antes solo con `TRIANGULAR=1`).
- `tri-exchange` reconstruye el feed para el venue elegido (`rebuildTriFeed()`).
- `tri-coins` aplica las monedas en caliente vía `triEngine.setCoins()` +
  `triFeed.setCoins()` (sin reconectar, para no romper LIVE/SSE).
- El motor recorre **todas** las monedas activas y publica el mejor loop + el desglose.

---

## 3. Dónde se guarda la persistencia

La configuración se persiste **del lado del servidor**, en disco, igual que el resto
de preferencias del proyecto (sobrevive reinicios y se comparte entre navegadores).

- **Archivo:** `data/arbicore-prefs.json` (ruta configurable con la variable de entorno
  `DATA_DIR`). Escrito de forma atómica y con debounce por `src/server/prefs.ts`.
- **Campos persistidos** (interfaz `EnginePrefs`):
  - `strategy` — estrategia seleccionada (`cross` | `triangular` | `auto`).
  - `triExchange` — exchange triangular seleccionado.
  - `triCoins` — monedas candidatas activas (BTC/USDT nunca se guardan: son base fija).
  - (ya existían: `activeExchanges`, `riskAppetite`).
- **Al arrancar**, `src/server/index.ts` llama a `loadPrefs()` y restaura: la estrategia,
  el venue triangular y las monedas activas. Si no hay nada en disco, usa los valores por
  defecto (`triExchange` = primer exchange configurado, `triCoins` = set activo por defecto).

> Nota: el dashboard también guarda preferencias **de UI** (tema, vista, timeframe) en
> `localStorage` bajo la clave `arbicore.prefs`. Eso es solo cosmético; la config de
> estrategia/exchange/monedas **no** depende de `localStorage`, vive en el servidor.

---

## 4. Cómo probarlo manualmente

### Arranque (modo simulado, sin red)
```bash
npm install          # primera vez
npm run server       # SOURCE=sim por defecto -> http://localhost:8080
```
Abre `http://localhost:8080`.

### Flujo de prueba
1. **Cross-Exchange (estado base):** ve a *Estrategias* y selecciona **Cross-Exchange**.
   En *Exchanges* puedes activar/desactivar **varios** venues a la vez; los botones
   *Todos/Ninguno* funcionan. (Comportamiento original intacto.)
2. **Cambia a Triangular:** en *Estrategias* selecciona **Triangular**. Vuelve a
   *Exchanges*:
   - Los toggles ahora son de **selección única**. Activa "Kraken" → "Binance" (u otro)
     se desactiva solo.
   - Aparece el panel **"Monedas para triangular"**. BTC y USDT salen bloqueadas
     ("Base"). Activa/desactiva ETH, SOL, XRP, etc.
3. **Verifica el dashboard:** en *Resumen* aparece la tarjeta Triangular (exchange,
   monedas activas, ruta recomendada, profit, fees). En *Estrategias*, el panel
   detallado con la tabla de rutas candidatas por moneda.
4. **Persistencia:** recarga la página (F5) → la estrategia, el exchange triangular y las
   monedas activas siguen como las dejaste. Reinicia el servidor (Ctrl-C + `npm run server`)
   → siguen igual (se leen de `data/arbicore-prefs.json`).
5. **Independencia Cross/Triangular:** vuelve a Cross-Exchange: tus venues multi-activos
   siguen como estaban. El cambio de venue/monedas en Triangular no los alteró.

### Comprobar el estado por API (opcional)
```bash
curl -s http://localhost:8080/state | python3 -m json.tool | grep -A30 '"triangular"'
```
Verás `exchange`, `baseCoins`, `activeCoins`, `availableCoins`, `candidateExchanges`,
`candidates`, `opportunity`, `takerFee`, `feeCostUSDT`.

### Comandos de control (lo que disparan los toggles)
```bash
curl "http://localhost:8080/control?cmd=strategy&value=triangular"
curl "http://localhost:8080/control?cmd=tri-exchange&value=kraken"
curl "http://localhost:8080/control?cmd=tri-coins&value=ETH,SOL,DOGE"   # BTC/USDT se ignoran (son base)
```

### Build y tests
```bash
npm run typecheck    # compila sin errores
npm test             # 80 + 8 + 6 checks; todos verdes (incl. sección triangular)
npm run build        # genera dist/
```

### LIVE (con red)
```bash
SOURCE=live npm run server
```
En LIVE el feed triangular usa `CcxtTriFeed`, que sondea los pares reales del exchange
seleccionado. Si un par `COIN/BTC` o `COIN/USDT` no existe en ese venue, esa moneda
simplemente se omite de las rutas (se registra un aviso y no rompe nada). Por eso el
panel solo "promete" rutas para monedas que el exchange realmente cotiza.

---

## 5. Pasos manuales necesarios

- **`npm install`** la primera vez (dependencias `ccxt` y `ws`). No se incluye
  `node_modules` en el entregable.
- **Para LIVE**, ajusta el venue/monedas a pares que el exchange realmente liste. Las
  monedas sin par `COIN/BTC`+`COIN/USDT` en ese venue se ignoran automáticamente.
- **Variables de entorno opcionales** (todas con valor por defecto sensato):
  - `TRI_EXCHANGE` — venue triangular inicial (si no hay pref guardada).
  - `TRI_COINS` — monedas activas iniciales, separadas por coma (BTC/USDT se filtran).
  - `TRI_NOTIONAL` — tamaño nocional por loop (def. 10 000 USDT).
  - `TRI_TAKER` — fee taker triangular (def.: el del exchange en `EXCHANGE_FEES`).
  - `DATA_DIR` — carpeta donde se guardan `arbicore-prefs.json` y el estado.
- **No hace falta** la antigua variable `TRIANGULAR=1`: el motor triangular ahora está
  siempre disponible para que la UI lo controle.

---

## 6. Criterios de aceptación — estado

| Criterio | Estado |
|---|---|
| En Cross-Exchange puedo tener varios exchanges activos como antes | ✅ |
| En Triangular solo puedo tener 1 exchange activo | ✅ (selección única) |
| En Triangular veo monedas disponibles con toggles | ✅ |
| Puedo activar/desactivar monedas candidatas | ✅ (BTC/USDT bloqueadas como base) |
| La triangulación usa el exchange seleccionado y las monedas activas | ✅ |
| La configuración persiste al recargar | ✅ (servidor, `data/arbicore-prefs.json`) |
| No se rompe el dashboard, ni LIVE/SIM, ni WebSockets/SSE | ✅ |
| El build compila correctamente | ✅ (`typecheck` limpio, 94 checks de test verdes) |
| No se mezcla el estado Cross con el Triangular | ✅ (comandos y campos separados) |
| Diseño desktop / responsive / premium intactos | ✅ (solo se añadieron componentes) |
