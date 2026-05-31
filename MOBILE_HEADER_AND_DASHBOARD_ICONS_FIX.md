# Mobile header and dashboard icons fix

## Componentes modificados

- `src/server/public/index.html`
  - Se ajustó el helper `kpi()` que renderiza las tarjetas principales del dashboard para que envuelva correctamente los trazos SVG y siempre pinte un icono visible.
  - Se actualizaron los iconos inline de las tarjetas KPI del resumen.
  - Se añadieron reglas responsive específicas para mobile sin tocar backend, engine, WebSockets/SSE ni lógica LIVE/SIM.

## Iconos agregados en tarjetas del dashboard

Las tarjetas principales ahora muestran iconos SVG reales, limpios y visibles dentro del contenedor premium existente:

- **Portfolio value**: icono tipo **Wallet**.
- **Oportunidades escaneadas**: icono tipo **Radar / Activity scanner**.
- **Operaciones**: icono tipo **ArrowLeftRight**.
- **Exchanges activos**: icono tipo **Globe / Network**.
- **Volatilidad BTC**: icono tipo **LineChart**.
- **Risk status**: icono tipo **ShieldCheck**.

Los iconos usan `currentColor`, por lo que heredan el estilo visual existente y funcionan correctamente en light mode y dark mode.

## Elementos ocultos en mobile

En pantallas mobile (`<= 767px`) el header queda simplificado y solo conserva:

- Botón hamburguesa / menú lateral.
- Badge de estado de datos: `LIVE · Datos reales` o `SIM · Simulación activa`.
- Botón de cambio light/dark mode.

Se ocultan en mobile:

- Texto `¡Bienvenido de vuelta!`.
- Subtítulo `Monitoriza mercados...`.
- Barra de búsqueda.
- Chip `Motor activo` / `Motor en pausa`.
- Render latency.
- Tarjeta de usuario `AR ArbiTrader`.

## Breakpoints usados

- **Desktop:** `1024px+` se mantiene prácticamente igual; no se elimina búsqueda ni perfil de usuario.
- **Tablet:** las reglas existentes de layout compacto siguen aplicando desde `<= 880px`, manteniendo una estructura usable para `768px - 1023px`.
- **Mobile:** `<= 767px` simplifica el header y evita que elementos superiores amontonen o tapen el hero.
- **Mobile pequeño:** `<= 430px` reduce espaciados, tamaños de badge y hero para evitar overflow horizontal.

## Cómo probar desktop

1. Ejecutar `npm run build`.
2. Abrir la app en un viewport de `1024px` o mayor.
3. Verificar que el header mantiene búsqueda, motor, LIVE/SIM, render, tema y usuario.
4. Verificar que las tarjetas KPI muestran iconos visibles en la esquina superior derecha.
5. Alternar light/dark mode y confirmar que los iconos conservan contraste.

## Cómo probar mobile

1. Ejecutar la app y abrir DevTools con un viewport de `390px - 430px` de ancho.
2. Confirmar que el header solo muestra menú, LIVE/SIM y botón de tema.
3. Confirmar que no aparecen búsqueda, usuario, chip de motor, render latency ni textos de bienvenida.
4. Revisar que el hero no queda tapado por el header.
5. Revisar que las cards se apilan sin solaparse.
6. Confirmar que no existe scroll horizontal global.
