# Backtesting y apetito de riesgo

## Qué estaba fallando en Backtesting

La vista de Backtesting dependía de la curva `pnlHistory` de la sesión actual y solo dibujaba un canvas. Si no había puntos suficientes, el gráfico quedaba vacío sin explicar si faltaban datos, si no había trades o si el modo LIVE/SIM no coincidía.

Además, la persistencia previa guardaba una sola serie global, por lo que no distinguía de forma explícita:

- Cross-Exchange vs. Triangular.
- LIVE vs. SIM.

Eso podía hacer que el backtesting pareciera incompleto o que no fuera suficientemente auditable.

## De dónde toma los datos

El backend persiste el historial en `data/arbicore-state.json` mediante `src/server/persistence.ts`.

La estructura actual separa buckets por:

- `live.cross`
- `live.triangular`
- `sim.cross`
- `sim.triangular`

Cada bucket contiene:

- `pnlHistory`: puntos de P&L/equity persistidos.
- `trades`: operaciones persistidas.
- `stats`: estadísticas de la estrategia para ese modo.

Backtesting reconstruye la curva usando primero los trades persistidos del bucket seleccionado. Si hay menos de dos trades, muestra el estado profesional:

> Sin operaciones suficientes para backtesting

Y explica que se necesitan al menos dos operaciones persistidas del mismo modo y estrategia.

## Métricas calculadas

Cuando hay trades suficientes, el backend calcula para cada estrategia y modo:

- Curva de equity acumulando `netProfit` real por trade.
- P&L final.
- Pico de equity.
- Drawdown máximo.
- Número de trades.
- Win rate.
- Promedio P&L por trade.
- Mejor trade.
- Peor trade.

No se inventan ganancias ni se sintetizan trades. Si no existen operaciones suficientes, el UI muestra placeholder y mensaje en lugar de una gráfica vacía.

## Cómo funciona el apetito de riesgo

El control de apetito de riesgo ya no es solo visual. El backend lo persiste en `data/arbicore-prefs.json` y el motor lo traduce a parámetros efectivos usados por Cross-Exchange en cada ciclo de decisión.

El slider conserva valores numéricos para compatibilidad, pero se mapea a perfiles:

- `0.25–0.74`: Conservador.
- `0.75–1.74`: Moderado.
- `1.75–2.74`: Agresivo.
- `2.75–4.00`: Muy agresivo.

Cuando cambia, el servidor registra logs como:

```text
[risk] appetite changed to aggressive
[risk] thresholds updated: minNet=..., slippage=..., latencyWindow=...
```

La UI de Riesgo muestra los valores efectivos en uso:

- Umbral mínimo.
- Slippage permitido.
- Ventana de exposición.
- Tamaño máximo.
- Drawdown máximo.
- Pérdidas consecutivas máximas.
- Estado del circuit breaker.
- Perfil efectivo.

## Parámetros por nivel

### Conservador

- Exige más P&L neto mínimo.
- Reduce tamaño máximo por trade.
- Reduce slippage permitido.
- Reduce ventana de latencia asumida.
- Aumenta sensibilidad del filtro de latencia (`latencyRiskZ`).
- Hace más sensible el circuit breaker: menos pérdidas consecutivas y menor drawdown permitido.

### Moderado

- Usa los valores base configurados por el motor.
- Mantiene el equilibrio entre ejecución y protección.

### Agresivo

- Acepta spreads netos más finos.
- Permite mayor tamaño por trade.
- Tolera más slippage y mayor ventana de exposición.
- Relaja el filtro de latencia y el circuit breaker.

### Muy agresivo

- Relaja aún más los filtros de umbral, tamaño, slippage y latencia.
- Mantiene la regla de seguridad principal: no ejecuta oportunidades con P&L neto negativo.
- El objetivo es considerar más oportunidades, no fabricar ganancias.

## Cómo impacta Cross-Exchange

Cross-Exchange consume los parámetros efectivos en:

- Evaluación de ejecutabilidad.
- Rechazos por `below_threshold`.
- Rechazos por `negative_net` cuando fees/slippage superan el spread.
- Filtro de latencia fantasma (`latency_risk`).
- Tamaño máximo por trade.
- Circuit breaker por pérdidas consecutivas y drawdown.

Al subir de Conservador a Agresivo o Muy agresivo deberías ver:

- Más oportunidades consideradas ejecutables cuando el neto sigue siendo positivo.
- Menos rechazos por threshold.
- Potencialmente mayor exposición por tamaño máximo.
- Sin ejecuciones si el P&L neto calculado es negativo.

## Cómo probar Cross-Exchange con distintos niveles de riesgo

1. Ejecutar el servidor:

   ```bash
   npm run server
   ```

2. Abrir el dashboard y entrar a **Riesgo**.
3. Cambiar entre:
   - Conservador.
   - Moderado.
   - Agresivo.
   - Muy agresivo.
4. Observar en la misma pantalla los thresholds efectivos.
5. Entrar a oportunidades/Cross-Exchange y comparar:
   - Cantidad de oportunidades ejecutables.
   - Rechazos por threshold.
   - Rechazos por latencia fantasma.
   - Tamaño máximo usado.
6. Reiniciar/recargar y comprobar que el apetito persiste.
7. Revisar logs del proceso para confirmar los mensajes `[risk]`.

## Cómo probar Backtesting en SIM

1. Seleccionar **Simulación / SIM** en Configuración.
2. Dejar operar hasta tener al menos dos trades en Cross-Exchange o Triangular.
3. Entrar a **Backtesting**.
4. Verificar que muestra métricas y curva para el modo SIM.
5. Si una estrategia no tiene al menos dos trades, debe mostrar “Sin operaciones suficientes para backtesting”.

## Cómo probar Backtesting en LIVE

1. Seleccionar **Real / LIVE** en Configuración.
2. Operar con feeds reales hasta persistir al menos dos trades de la estrategia deseada.
3. Entrar a **Backtesting**.
4. Confirmar que las métricas salen del bucket LIVE correspondiente.
5. Cambiar a SIM y comprobar que los resultados LIVE no se mezclan con los simulados.

## Archivos principales modificados

- `src/engine/engine.ts`: perfiles de apetito y parámetros efectivos del motor.
- `src/engine/risk.ts`: actualización dinámica de config del circuit breaker.
- `src/server/persistence.ts`: persistencia separada por LIVE/SIM y Cross/Triangular.
- `src/server/index.ts`: construcción backend de métricas de backtesting y exposición de `riskEffective`.
- `src/exchanges/triangular.ts`: acceso a trades triangulares persistibles.
- `src/server/public/index.html`: UI de thresholds efectivos y backtesting profesional con placeholder.
