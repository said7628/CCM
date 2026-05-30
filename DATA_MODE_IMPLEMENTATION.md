# Implementación del selector global de modo de datos

## Archivos modificados

- `src/server/index.ts`
  - Se agregó una capa de selección global `dataMode: "live" | "sim"` controlada por backend.
  - Se ejecutan runtimes separados para LIVE y SIM, cada uno con su propio `MarketDataSource`, `ArbitrageEngine`, `WalletManager`, historial de precios, P&L y estadísticas.
  - Se agregaron los endpoints:
    - `GET /api/settings`
    - `POST /api/settings/data-mode`
  - El stream SSE `/stream` y `/state` ahora exponen metadatos claros del modo activo: `dataMode`, `dataModeLabel`, `isSimulation` y `sourceStatus`.

- `src/server/prefs.ts`
  - Se extendieron las preferencias persistentes del servidor con `dataMode`.
  - El default seguro es `live`.
  - Se agregó guardado inmediato para cambios críticos como el modo de datos.

- `src/server/persistence.ts`
  - Se separó la persistencia de estado por modo usando archivos distintos:
    - `data/arbicore-state-live.json`
    - `data/arbicore-state-sim.json`
  - Esto evita mezclar P&L, oportunidades, trades, stats e históricos reales con simulados.
  - Se mantiene fallback de lectura del archivo legado `data/arbicore-state.json` para el modo live si todavía no existe el archivo nuevo.

- `src/server/public/index.html`
  - Se agregó un badge visible en el header:
    - `LIVE · Datos reales`
    - `SIM · Simulación activa`
  - Se agregó en Configuración una sección “Fuente de datos” con selector importante tipo toggle:
    - Real: “Usa order books reales vía WebSockets.”
    - Simulación: “Genera divergencias controladas para visualizar el bot en acción.”
  - El cambio llama al backend y muestra feedback:
    - “Modo Simulación activado”
    - “Modo Real activado”
  - Al cambiar de modo se limpia el buffer local de precios y se vuelve a sembrar desde `/prices` para no mezclar series live/sim en los gráficos.

## Cómo funciona el cambio live/sim

El servidor levanta dos runtimes independientes:

1. **Runtime LIVE**
   - Usa `WebSocketSource`.
   - Mantiene conectados los WebSockets reales.
   - Alimenta su propio engine, wallets, stats, P&L, operaciones e históricos.

2. **Runtime SIM**
   - Usa `SimulatedSource` en modo streaming.
   - Genera order books sintéticos, divergencias, oportunidades ejecutables, operaciones simuladas y P&L simulado.
   - Alimenta su propio engine, wallets, stats, P&L, operaciones e históricos.

El dashboard siempre recibe por `/stream` el snapshot del runtime activo según `dataMode`. Cambiar el modo no borra ni detiene el otro runtime; solo cambia qué runtime se publica al dashboard y a los endpoints de lectura.

## Persistencia

La fuente de verdad del modo activo es el backend:

- Archivo: `data/arbicore-prefs.json`
- Campo: `dataMode`
- Valores válidos: `live` o `sim`
- Default si no hay configuración guardada: `live`

La persistencia de métricas queda separada por modo:

- LIVE: `data/arbicore-state-live.json`
- SIM: `data/arbicore-state-sim.json`

## Endpoints agregados

### `GET /api/settings`

Devuelve el modo actual:

```json
{
  "dataMode": "live",
  "dataModeLabel": "Modo Real",
  "isSimulation": false,
  "sourceStatus": "real_market_data"
}
```

### `POST /api/settings/data-mode`

Body:

```json
{ "dataMode": "sim" }
```

Valida estrictamente que `dataMode` sea `live` o `sim`. Si el valor es válido:

- actualiza `prefs.dataMode`,
- persiste inmediatamente el cambio en disco,
- emite logs claros:
  - `[settings] dataMode changed to sim`
  - `[engine] using simulation source`

## Campos nuevos en el stream del dashboard

Cada snapshot de `/stream` y `/state` incluye:

```json
{
  "dataMode": "sim",
  "dataModeLabel": "Modo Simulación",
  "isSimulation": true,
  "sourceStatus": "simulation_engine"
}
```

En modo real:

```json
{
  "dataMode": "live",
  "dataModeLabel": "Modo Real",
  "isSimulation": false,
  "sourceStatus": "real_market_data"
}
```

## Cómo probar manualmente

1. Iniciar el dashboard:

```bash
npm run server
```

2. Abrir:

```text
http://localhost:8080
```

3. Ir a **Configuración**.

4. En **Fuente de datos**, cambiar entre:
   - **Real**
   - **Simulación**

5. Verificar que:
   - El badge superior cambia entre `LIVE · Datos reales` y `SIM · Simulación activa`.
   - El dashboard cambia oportunidades, operaciones, P&L, order books, balances, historial, estrategias y estado según el modo seleccionado.
   - En SIM aparecen divergencias y actividad simulada.
   - Al recargar la página, el modo seleccionado persiste.
   - Al reiniciar el servidor, el modo seleccionado persiste porque se guarda en `data/arbicore-prefs.json`.

También se puede probar por API:

```bash
curl http://localhost:8080/api/settings
curl -X POST -H 'Content-Type: application/json' -d '{"dataMode":"sim"}' http://localhost:8080/api/settings/data-mode
curl http://localhost:8080/state
```

## Decisiones técnicas

- Se mantuvieron los WebSockets reales conectados: cambiar a SIM no llama `stop()` sobre LIVE.
- No se modificaron las fórmulas de arbitraje ni la lógica de detección/ejecución existente.
- Se reutilizó `SimulatedSource` existente y se conectó como fuente completa del dashboard, no como una tarjeta visual aislada.
- Se separaron engines, wallets, stats, P&L e históricos por modo para evitar mezclar métricas reales y simuladas.
- El endpoint `/prices` responde el histórico del modo activo, y el frontend limpia su buffer local al detectar cambio de `dataMode`.
- Si un runtime falla al iniciar su fuente, el otro puede seguir funcionando y el snapshot expone `sourceError` para facilitar diagnóstico.

## Fix aplicado

Se corrigió un bug crítico de inicialización en `src/server/index.ts`: el callback registrado en `source.onUpdate(...)` podía invocar `onTick(...)` antes de que la constante `onTick` hubiera sido inicializada, provocando el error `ReferenceError: Cannot access 'onTick' before initialization` y el crash del proceso bajo PM2.

La corrección mantiene la arquitectura live/sim existente y no cambia fórmulas de arbitraje ni diseño del dashboard:

- `onTick` ahora está definido como función antes de registrar cualquier callback de WebSocket o simulador que lo use.
- Los runtimes LIVE y SIM se construyen primero con sus callbacks ya seguros.
- Las fuentes se arrancan después de que `onTick`, el estado de estrategia y el registro de runtimes ya existen, evitando que cualquier emisión temprana de WebSocket/SimulatedSource ejecute código en temporal dead zone.

Archivo corregido: `src/server/index.ts`.
