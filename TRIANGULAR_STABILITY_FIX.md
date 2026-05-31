# Triangular Stability Fix

## Exchanges soportados para Triangular

La estrategia **Triangular** queda limitada a estos exchanges:

- Binance
- Kraken
- Coinbase

Los demás exchanges configurados (OKX, Bitfinex, KuCoin, Gate.io, Bitstamp, Gemini y cualquier otro no incluido en la lista anterior) siguen disponibles para **Cross-Exchange**, pero se muestran bloqueados en Triangular con el estado:

> No disponible para Triangular

## Bloqueo por pares insuficientes

Para que un exchange pueda usarse en Triangular debe poder formar al menos una ruta con:

- `BTC/USDT` o `BTC/USD`
- `COIN/USDT` o `COIN/USD`
- `COIN/BTC`

Binance y Kraken usan `USDT` como ancla por defecto. Coinbase usa `USD`, para evitar falsos bloqueos por falta de mercados `USDT`.

Si el exchange seleccionado no tiene rutas priceables para las monedas activas, la UI muestra:

> Sin pares suficientes para Triangular

Además, las filas de rutas explican el motivo concreto cuando faltan datos:

- `Par no disponible`
- `Esperando WebSocket`
- `Sin liquidez`
- `Endpoint bloqueado`
- `Sin order book todavía`

Las rutas incompletas quedan con profit y fees en cero para evitar oportunidades falsas por order books faltantes.

## Corrección del cambio de estrategia

El cambio entre **Cross-Exchange** y **Triangular** se estabilizó así:

1. El backend mantiene la estrategia activa en las preferencias persistidas (`prefs.strategy`).
2. El endpoint `/control?cmd=strategy` actualiza la estrategia activa y guarda la preferencia.
3. La UI aplica el cambio visual inmediatamente al click.
4. Mientras el cambio está en vuelo, la UI no deja que un frame SSE viejo revierta el botón seleccionado.
5. Cuando llega el estado confirmado desde el servidor, la selección queda sincronizada.

La estrategia seleccionada persiste al recargar porque se lee desde las preferencias del backend al arrancar.

## Conteo de oportunidades

El contador superior de oportunidades ahora separa conceptos:

- **Oportunidades escaneadas**: acumulado de oportunidades/rutas evaluadas durante la sesión.
- **Ejecutables ahora**: oportunidades accionables en el último tick/frame.
- **Oportunidades ejecutadas**: trades realmente ejecutados.

En **Cross-Exchange**, el acumulado suma las oportunidades cross evaluadas por el detector.

En **Triangular**, el acumulado suma las rutas triangulares evaluadas para las monedas activas del exchange triangular.

Los contadores de Cross y Triangular no se mezclan: la UI lee estadísticas Cross desde `stats` y estadísticas Triangular desde `triangular.stats`.

## Limpieza del header

Se quitó el botón duplicado de notificaciones de la barra superior.

La sección **Alertas** del menú lateral sigue funcionando y conserva su badge lateral.

## Cómo probar Cross-Exchange

1. Arrancar en SIM o LIVE.
2. Ir a **Estrategias**.
3. Hacer click una vez en **Cross-Exchange**.
4. Confirmar que el botón queda activo sin rebotar a Triangular.
5. Ir a **Exchanges**.
6. Confirmar que todos los exchanges configurados se pueden activar/desactivar como antes.
7. Confirmar que el KPI **Oportunidades escaneadas** acumula oportunidades Cross y que **Ejecutables ahora** refleja solo el estado actual.

## Cómo probar Triangular

1. Ir a **Estrategias**.
2. Hacer click una vez en **Triangular**.
3. Ir a **Exchanges**.
4. Confirmar que solo Binance, Kraken y Coinbase pueden activarse para Triangular.
5. Confirmar que los exchanges no soportados aparecen bloqueados con `No disponible para Triangular`.
6. Seleccionar Binance, Kraken o Coinbase.
7. Confirmar que las rutas se ordenan con `Listo`/`Ejecutable` arriba y `Par no disponible`/estados incompletos abajo.
8. Confirmar que las rutas incompletas no muestran profits enormes o falsos positivos.
9. Confirmar que si no hay rutas suficientes aparece `Sin pares suficientes para Triangular`.

## Cómo probar LIVE/SIM

1. Usar el control de modo de datos para alternar entre **SIM** y **LIVE**.
2. Verificar que Cross-Exchange sigue detectando y renderizando libros BTC entre exchanges.
3. Verificar que Triangular reconstruye su feed al cambiar de modo.
4. En SIM, las rutas triangulares deben poblarse rápidamente con datos sintéticos.
5. En LIVE, las rutas deben mostrar estados claros mientras esperan WebSocket o cuando un par no existe.
6. Verificar que no aparecen errores nuevos ni spam en logs. En entornos con PM2 disponible, usar:

```bash
pm2 logs --nostream --lines 80
```

## Checks ejecutados

```bash
npm run build
npm test
pm2 logs --nostream --lines 80
```

`pm2` no estaba instalado en el entorno de validación local, por lo que ese check no pudo ejecutarse aquí.
