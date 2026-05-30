# Responsive implementation

## Archivos modificados

- `src/server/public/index.html`
  - Se añadieron reglas CSS responsive para laptop, tablet, mobile grande, mobile chico y pantallas de 320 px.
  - Se incorporó una navegación móvil horizontal sticky reutilizando las mismas vistas del dashboard.
  - Se ajustó el layout visual de header, hero, KPIs, P&L, gráficas, order book, tablas, riesgo, estrategias, alertas y configuración sin tocar backend, engine, WebSockets/SSE ni cálculos de arbitraje.
- `RESPONSIVE_IMPLEMENTATION.md`
  - Documentación de los cambios, breakpoints y pasos de prueba manual.

## Breakpoints usados

- **Desktop grande:** `1280px+`
  - Se mantiene el layout original de escritorio. Las reglas responsive nuevas no aplican por encima de 1279 px.
- **Laptop:** `1024px - 1279px`
  - Sidebar ligeramente más compacto, padding principal reducido, render pill oculto para evitar amontonamientos, grids complejos pasan a una columna donde era necesario.
- **Tablet:** `768px - 1023px`
  - Sidebar oculto y reemplazado por navegación móvil horizontal sticky.
  - Header en dos zonas, buscador ancho, chips compactos y layout principal sin overflow global.
  - Order book en 2 columnas y formularios/configuración a una columna.
- **Mobile grande:** `480px - 767px`
  - Header compacto con buscador en fila completa.
  - Cards, P&L, gráficas, tabs, botones, inputs y secciones adaptados para touch.
  - Grids principales a una columna cuando corresponde.
- **Mobile chico:** `320px - 479px`
  - KPIs en una columna, paddings reducidos, textos largos protegidos contra cortes, tablas con scroll interno y hero más compacto.
- **Ajuste extra 320 px:** `max-width: 340px`
  - Refinamiento de padding, tipografía y hero para pantallas muy estrechas.

## Componentes adaptados

- **Header/topbar**
  - Evita amontonamientos con grid responsive.
  - El buscador ocupa fila completa en mobile.
  - Chips de motor y LIVE/SIM se mantienen visibles y compactos.
  - Botones táctiles con mínimo 44 px.
- **Navegación**
  - En desktop se conserva el sidebar.
  - En tablet/mobile se usa una navegación horizontal sticky con scroll interno controlado, manteniendo badges de oportunidades y alertas.
- **Hero/bienvenida**
  - Desktop intacto.
  - Tablet/mobile apilado, con imagen decorativa reposicionada y textos escalados.
- **KPIs y P&L**
  - Desktop conserva el grid original.
  - Tablet/mobile evitan cortes en valores grandes, reducen padding y ajustan columnas.
  - La gráfica P&L mantiene ancho 100% y altura móvil razonable.
- **Gráficas**
  - Contenedores mantienen `width: 100%` y alturas adaptadas en mobile.
  - Se evita que se aplasten en pantallas angostas.
- **Order book / exchange cards**
  - Desktop conserva el grid auto-fill original.
  - Tablet pasa a 2 columnas.
  - Mobile pasa a 1 columna.
- **Tablas**
  - Las tablas grandes usan scroll horizontal interno dentro de la card, no scroll global de la página.
  - Se aplicaron anchos mínimos por tipo de tabla para operaciones, oportunidades, balances y estrategias.
- **Configuración / LIVE-SIM**
  - Toggle LIVE/SIM se adapta a ancho completo y en mobile se apila para no romper el layout.
  - Cards de parámetros pasan a una columna.
- **Estados visuales y accesibilidad**
  - Empty/loading/error-like placeholders conservan padding adecuado.
  - Botones, selects, tabs y toggles tienen altura táctil adecuada en mobile.
  - Textos largos se truncan o ajustan sin desbordar.

## Cómo probar manualmente en responsive

1. Ejecutar la app:

   ```bash
   npm run server
   ```

2. Abrir en navegador:

   ```text
   http://localhost:8080
   ```

3. Abrir DevTools y probar estos viewports:

   - `1440px` desktop
   - `1024px` laptop/tablet horizontal
   - `768px` tablet
   - `430px` mobile grande
   - `390px` iPhone común
   - `360px` Android común
   - `320px` mobile pequeño

4. En cada tamaño revisar:

   - Header sin elementos cortados.
   - Buscador usable.
   - Chips “Motor activo”, “LIVE/SIM” y badges visibles.
   - Navegación usable en tablet/mobile.
   - Cards con spacing correcto.
   - Gráficas visibles y no aplastadas.
   - Order book sin overflow.
   - Tablas con scroll interno cuando corresponda.
   - Configuración y toggle LIVE/SIM legibles y clicables.

## Checklist de overflow horizontal

En DevTools Console ejecutar en cada viewport:

```js
document.documentElement.scrollWidth <= window.innerWidth
```

Debe devolver `true` para la página global. Si una tabla es más ancha, el scroll debe estar dentro de su card, no en toda la página.

## Cosas que debe revisar el usuario en navegador

- Que el diseño desktop a `1280px+` se vea igual o prácticamente igual que antes.
- Que la navegación móvil permita entrar a todas las secciones.
- Que el selector LIVE/SIM siga cambiando modo desde Configuración.
- Que las actualizaciones de datos en tiempo real sigan refrescando métricas, order book y gráficas.
- Que los datos críticos de oportunidades, operaciones, estrategias e historial estén disponibles en mobile mediante scroll interno.

## Pasos manuales necesarios en navegador/devtools

- Usar el dispositivo responsive de DevTools para validar visualmente los tamaños solicitados.
- Ejecutar el snippet de overflow global en cada tamaño.
- Probar taps/clicks en navegación móvil, theme button, alertas, tabs de timeframe, selector LIVE/SIM y botones de configuración.
