# Frontend changes

## Archivos modificados

- `src/server/public/index.html`
  - Cambios exclusivamente visuales en el dashboard HTML/CSS/JS del frontend servido como estático.
- `FRONTEND_CHANGES.md`
  - Este registro de cambios solicitado.

## Cambios visuales realizados

- Rediseñé la sección de **Net Realized P&L** como una tarjeta compacta de dos columnas:
  - Mantiene el valor principal de Net Realized P&L.
  - Mantiene el texto de sesión actual.
  - Mantiene Trades, Mejor trade y Fantasmas filtrados.
  - Mantiene el porcentaje/variación existente.
  - Integra la curva de P&L en un contenedor más pequeño para evitar un panel grande vacío.
- Mejoré las tarjetas laterales de métricas con:
  - Iconos SVG inline coherentes para portfolio, oportunidades, operaciones, exchanges, volatilidad y riesgo.
  - Gradientes suaves, bordes limpios, sombra sutil y micro-interacción hover.
  - Conservación del estilo claro, institucional, azul/cyan y minimalista.
- Reemplacé el cubo geométrico del hero por la imagen real existente:
  - Usa `/imagehero.png` desde el frontend.
  - La imagen queda alineada a la derecha, con `object-fit: contain`, sombra y opacidad integrada.
  - Mantiene el texto y el botón existentes.
- Ajusté responsive para que la tarjeta de P&L pase a una columna en pantallas medianas y la imagen del hero no rompa el layout.

## Cosas que NO toqué

- No modifiqué backend, engine, servicios, exchanges, endpoints, SSE, WebSocket, polling ni lógica de arbitraje/trading.
- No cambié rutas de fetch, `/stream`, `/control`, eventos ni estructuras de datos.
- No cambié nombres de funciones, hooks, props, datos recibidos ni cálculos existentes.
- No agregué mocks, placeholders nuevos ni valores estáticos en reemplazo de datos reales.
- No instalé dependencias nuevas.
- No modifiqué PM2, scripts de servidor, variables de entorno ni configuración de ejecución.

## Revisión manual recomendada en navegador

1. Abrir el dashboard en desktop y validar que la sección **Net Realized P&L** ya no aparezca como panel gigante vacío.
2. Confirmar que Trades, Mejor trade, Fantasmas filtrados y el porcentaje de P&L siguen actualizándose con datos reales.
3. Verificar que las tarjetas de Portfolio Value, Opportunities, Operaciones, Exchanges Activos, Volatilidad BTC y Risk Status muestran iconos y siguen actualizando sus valores.
4. Confirmar que el hero muestra `/imagehero.png`, sin deformarse y sin tapar el texto/botón.
5. Probar una pantalla mediana/tablet para asegurar que el layout refluye correctamente.
6. Cambiar entre tema claro/oscuro si aplica y revisar contraste de tarjetas, iconos y hero.
