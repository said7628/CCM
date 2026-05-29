# Cambios del dashboard ArbiCore

## Archivos modificados

- `components/dashboard.tsx`: se reorganizó la grilla principal para una distribución tipo dashboard financiero, con hero, KPIs, gráfica, tablas y módulos laterales balanceados.
- `components/sidebar.tsx`: se rediseñó la barra lateral con identidad ArbiCore, menú vertical profesional, opción activa `Resumen` en cyan claro y tarjeta de estrategia activa.
- `components/header.tsx`: se mejoró el topbar con saludo, subtítulo, estado `Motor activo`, búsqueda visual, notificaciones, modo visual y perfil.
- `components/hero-section.tsx`: se reemplazó el hero dibujado con CSS/HTML por la imagen real pública `/imagehero.png` dentro de la card azul derecha.
- `components/kpi-cards.tsx`: se rediseñaron las cards de métricas con sombras suaves, iconografía, jerarquía tipográfica y sparkline para P&L.
- `components/price-chart.tsx`: se ajustó la gráfica BTC para que se vea más limpia, amplia y alineada al estilo fintech blanco/cyan.
- `components/opportunities-table.tsx`: se mejoró la card y tabla de oportunidades con mejor espaciado, bordes suaves y estados hover.
- `components/balances-chart.tsx`: se refinó la card del donut chart y su leyenda para integrarse mejor con la grilla.
- `components/recent-operations.tsx`: se mejoró la tabla de operaciones recientes con una presentación más limpia y profesional.
- `components/risk-engine.tsx`: se ajustaron cards internas, estados y barra de margen para un aspecto más claro.
- `components/system-health.tsx`: se refinó el indicador circular de uptime y los estados del sistema.

## Mejoras visuales realizadas

- Layout más cercano a la referencia: sidebar fija en desktop, header superior, hero principal, KPIs y módulos distribuidos en una grilla amplia.
- Identidad visual ArbiCore reforzada con blanco, azul oscuro, cyan, teal y sombras suaves.
- Cards con bordes redondeados, profundidad sutil, hover profesional y mayor respiración visual.
- Sidebar con logo textual `ArbiCore`, menú vertical, activo `Resumen` con fondo cyan claro y tarjeta de estrategia activa.
- Topbar con saludo, estado del motor, búsqueda visual, iconos y perfil.
- Tablas y gráficas ajustadas para evitar amontonamiento y mejorar lectura en desktop y pantallas medianas.
- Responsive básico: el contenido se adapta en una columna en pantallas menores y conserva grillas amplias en desktop.

## Uso de `public/imagehero.png`

- La imagen se usa en `components/hero-section.tsx` mediante la ruta pública `/imagehero.png`.
- Se muestra como `<img>` dentro de la card azul derecha, con `object-cover`, sin deformación y con overlays suaves para integrarse con el texto `Ejecución inteligente sin límites`.
- Se eliminó la implementación anterior que intentaba dibujar el visual hero con figuras CSS/HTML y un icono Bitcoin en SVG.

## Confirmación sobre el bot de arbitraje

No se modificó, movió, formateó ni reestructuró ningún archivo relacionado con el bot de arbitraje, motor, trading, WebSockets, conectores de exchanges, backend, scripts de ejecución, servicios de mercado ni archivos dentro de `src/` o `test/`.
