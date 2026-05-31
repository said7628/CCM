# Final UI Triangular + Responsive Fix

## Archivos modificados

- `src/exchanges/triangular.ts`
  - Ajusta los estados y razones de rechazo de rutas triangulares.
  - Evita que una ruta calculada pero no ejecutable quede como estado final `Listo`.
  - Expone razones legibles para la UI en cada candidata triangular.
- `src/server/index.ts`
  - Actualiza el cálculo de rutas listas para que el estado de sincronización triangular considere los nuevos estados de decisión.
- `src/server/public/index.html`
  - Agrega razones de rechazo en las tablas de Triangular.
  - Mejora el estado real de Triangular en la comparativa de estrategias.
  - Mantiene los iconos de KPI del dashboard y los deja integrados dentro del estilo fintech/minimalista actual.
  - Añade navegación mobile tipo hamburguesa y reglas responsive para tarjetas, tablas, header, monedas y controles.

## Cómo funcionan las razones de rechazo en Triangular

Triangular ahora distingue entre **datos cargados** y **decisión de ejecución**. Una ruta puede estar priceada, pero si no cumple condiciones de ejecución muestra una razón explícita en vez de quedarse como `Listo`.

Las candidatas triangulares exponen una lista `reasons` para que la UI muestre la columna **Razón**. Cuando la ruta tiene todos sus libros y se puede calcular, la razón se deriva del resultado económico:

- `Profit neto negativo` cuando el resultado neto es menor o igual a cero.
- `Fees exceden spread` cuando existe spread bruto positivo, pero las tres fees taker consumen el margen.
- `Debajo del umbral` cuando hay profit positivo, pero está por debajo del mínimo configurado.
- `Sin liquidez` cuando alguna pata no puede llenar el notional.
- `Ruta ejecutable` cuando pasa todos los filtros.

Cuando faltan datos de mercado, la razón conserva el detalle por par, por ejemplo:

- `Par no disponible`
- `Esperando WebSocket`
- `Datos incompletos`
- `Sin pares suficientes`
- `Endpoint bloqueado`

## Estados agregados o normalizados

En Triangular se agregaron/normalizaron estos estados de decisión:

- `Ejecutable`
- `En espera`
- `No rentable`
- `Fees exceden spread`
- `Debajo del umbral`
- `Par no disponible`
- `Sin pares suficientes`
- `Esperando WebSocket`
- `Datos incompletos`
- `Sin liquidez`

`Listo` queda reservado como una señal técnica de disponibilidad de books cuando venga de fuentes internas, pero la UI ya no lo usa como estado final de ejecución para rutas triangulares negativas o rechazadas.

## Comparativa de estrategias

La tabla **Comparativa de estrategias** ahora calcula el estado visible de Triangular con base en sus candidatas reales:

- `Activa · ejecutable` si Triangular está activo y hay al menos una ruta ejecutable.
- `Activa · sin rutas rentables` si Triangular está activo pero no hay rutas rentables.
- `Ejecutable` si no está activo pero existen rutas ejecutables.
- `No rentable` si hay rutas evaluadas pero ninguna supera costos/umbral.
- `Par no disponible` si los pares requeridos no están disponibles.
- `Sin pares suficientes` si no hay suficientes monedas/rutas candidatas.
- `En espera` si todavía está esperando WebSocket, carga o datos completos.

Esto evita que Triangular aparezca como si estuviera funcionando perfecto cuando en realidad no hay oportunidad ejecutable.

## Iconos agregados en tarjetas del dashboard

Las tarjetas KPI principales usan iconos SVG lineales, pequeños y consistentes con el branding actual:

- `Portfolio value`: wallet/capital.
- `Oportunidades escaneadas`: scanner/radar.
- `Operaciones`: pulso/actividad operativa.
- `Exchanges activos`: globo/red de venues.
- `Volatilidad BTC`: línea de mercado/volatilidad.
- `Risk status`: escudo de riesgo.

Los iconos se integran dentro de un contenedor compacto con gradiente suave, sin cambiar la estructura desktop ni volverlos invasivos.

## Breakpoints responsive usados

- `1180px`
  - Apila layouts anchos: hero, KPIs, comparativas y filas inferiores.
  - Mantiene desktop/tablet grande muy similar al diseño existente.
- `880px`
  - Activa experiencia mobile/tablet:
    - sidebar pasa a drawer/hamburguesa,
    - header se reorganiza,
    - search ocupa ancho completo,
    - badges/perfil/botones se acomodan en grid,
    - cards y secciones pasan a una columna,
    - tablas tienen scroll horizontal interno controlado,
    - controles táctiles suben a mínimo aproximado de 44px,
    - rutas triangulares se parten en grid de dos columnas.
- `430px`
  - Ajusta celulares grandes/medianos:
    - KPIs a una columna,
    - métricas internas a una columna,
    - tabs y tablas con ancho interno controlado,
    - monedas triangulares en dos columnas si cabe.
- `360px`
  - Ajusta celulares pequeños:
    - paddings reducidos,
    - badges reordenados,
    - monedas en una columna si ya no caben,
    - segmentos y toggles se apilan.

Estos breakpoints cubren las pruebas pedidas para `1440px`, `1024px`, `768px`, `430px`, `390px`, `360px` y `320px`.

## Cómo probar desktop

1. Ejecutar el servidor normalmente.
2. Abrir el dashboard en `1440px`.
3. Verificar que:
   - el sidebar sigue fijo y visible,
   - el header conserva la distribución desktop,
   - el dashboard mantiene estética y proporciones,
   - las cards KPI tienen iconos pequeños integrados,
   - las tablas siguen usando presentación tabular normal.
4. Repetir en `1024px` y confirmar que el layout se apila solo donde ya era necesario, sin rediseñar PC.

## Cómo probar mobile

Probar anchos `768px`, `430px`, `390px`, `360px` y `320px` con DevTools:

1. Confirmar que no hay scroll horizontal global del documento.
2. Abrir el menú hamburguesa y validar que el sidebar aparece como drawer usable.
3. Cambiar de sección desde el drawer y verificar que se cierra automáticamente.
4. Verificar que el header no se amontona:
   - search en su propia fila,
   - badges y perfil compactos,
   - botón de tema tocable.
5. Revisar dashboard:
   - cards en una columna o dos si cabe,
   - textos importantes sin cortes,
   - botones/toggles con área táctil cómoda.
6. Revisar tablas:
   - no generan scroll horizontal global,
   - si son anchas, el scroll queda dentro de la card.
7. Revisar Triangular:
   - monedas en grid responsive,
   - rutas legibles en dos filas/columnas cuando no caben,
   - columna `Razón` visible mediante scroll interno de la card.

## Cómo verificar Cross-Exchange, Triangular y LIVE/SIM

### Cross-Exchange

1. Seleccionar estrategia `Cross-Exchange`.
2. Abrir **Oportunidades**.
3. Confirmar que la tabla Cross-Exchange conserva columnas de comprar/vender, spread, neto, exposición, P&L y estado.
4. Confirmar que las razones Cross-Exchange existentes no fueron reemplazadas por la lógica triangular.

### Triangular

1. Seleccionar estrategia `Triangular`.
2. Abrir **Oportunidades** o **Estrategias**.
3. Confirmar que las tablas triangulares muestran:
   - `Moneda puente`,
   - `Ruta`,
   - profit estimado / profit %,
   - fees,
   - `Razón`,
   - `Estado`.
4. Forzar o esperar una ruta negativa y verificar que el estado no diga `Listo`; debe mostrar `No rentable` o `Fees exceden spread` con razón clara.
5. Verificar que si faltan pares aparezca `Par no disponible`, `Sin pares suficientes`, `Esperando WebSocket` o `Datos incompletos`.

### LIVE/SIM

1. Ir a **Configuración**.
2. Alternar `Real / LIVE` y `Simulación / SIM`.
3. Confirmar que el badge superior cambia entre `LIVE · Datos reales` y `SIM · Simulación activa`.
4. Confirmar que el dashboard sigue actualizando datos tras alternar.
5. Confirmar que Cross-Exchange y Triangular siguen renderizando oportunidades/candidatas después del cambio.

## Verificación técnica

- `npm run build` compila correctamente con TypeScript.
