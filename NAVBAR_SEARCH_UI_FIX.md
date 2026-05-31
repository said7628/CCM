# Navbar + Search UI Fix

## Archivos modificados

- `src/server/public/index.html`
  - Ajustes de CSS/HTML/JS para el sidebar mobile, overlay/backdrop, búsqueda desktop y eliminación del bloque de usuario/cuenta.
  - Cambio del item de navegación `Exchanges` a `Exchanges & Wallet`.
- `NAVBAR_SEARCH_UI_FIX.md`
  - Documentación de los cambios y pasos de prueba.

## Cómo funciona el cierre del sidebar mobile

- El sidebar conserva la animación actual de entrada/salida con la clase `navOpen` en `body`.
- Se agregó un botón de backdrop clickeable (`#navBackdrop`) detrás del menú mobile.
- Al tocar/clickear el backdrop, se ejecuta `closeMobileNav()` y se remueve `navOpen`.
- También se cierra cuando:
  - el usuario selecciona una opción del menú;
  - el usuario toca/clickea fuera del panel del sidebar;
  - el usuario presiona `Escape`.
- No se agrega `overflow: hidden` al `body`, por lo que no se deja la pantalla bloqueada ni en un estado raro después de cerrar.

## Qué se eliminó del usuario/cuenta

- Se quitó del header desktop el bloque de perfil/cuenta que mostraba:
  - `AR`
  - `ArbiTrader`
  - `Cuenta Pro`
- También se removieron los estilos asociados al bloque `.user` para evitar duplicados o espacio visual reservado.
- El header se ajusta automáticamente porque `.top-tools` mantiene su layout flexible sin ese bloque.

## Cómo funciona la búsqueda

- La barra desktop `#searchInput` ahora muestra resultados en un dropdown (`#searchResults`).
- La búsqueda normaliza minúsculas y acentos para que funcionen entradas como `riesgo`, `configuracion` o `configuración`.
- Puede buscar:
  - secciones del menú: `oportunidades`, `operaciones`, `riesgo`, `estrategias`, `backtesting`, `configuración`, etc.;
  - exchanges conocidos: `Binance`, `Kraken`, `OKX`, `Coinbase`, etc.;
  - pares comunes o detectados desde el estado: `BTC/USDT`, `ETH/BTC`, `ETH/USDT` y pares triangulares disponibles.
- Al seleccionar un resultado o presionar `Enter`:
  - si es una sección, navega a esa sección;
  - si es un exchange, navega a `Exchanges & Wallet` y resalta el exchange si aparece;
  - si es un par, navega al resumen y resalta un bloque útil relacionado.
- Si no hay coincidencias, el dropdown muestra `Sin resultados`.

## Cómo probar desktop

1. Ejecutar la app en desktop.
2. Verificar que el header ya no muestre `AR / ArbiTrader / Cuenta Pro`.
3. Verificar que el menú muestre `Exchanges & Wallet`.
4. Escribir `riesgo` en la búsqueda y seleccionar el resultado o presionar `Enter`; debe navegar a la vista Riesgo.
5. Escribir `Kraken`; debe aparecer como resultado, navegar a `Exchanges & Wallet` y resaltar datos de Kraken si están renderizados.
6. Escribir `BTC/USDT`; debe aparecer como par y llevar a una zona útil del dashboard.
7. Escribir un texto inexistente; debe aparecer `Sin resultados`.
8. Confirmar que dark mode y layout desktop se mantienen.

## Cómo probar mobile

1. Abrir la app con viewport mobile.
2. Tocar el botón hamburguesa para abrir el sidebar.
3. Tocar fuera del sidebar/backdrop: el menú debe cerrarse.
4. Abrir de nuevo el sidebar y seleccionar una opción: el menú debe cerrarse y navegar a la sección.
5. Abrir de nuevo el sidebar y presionar `Escape` con teclado/simulador: debe cerrarse.
6. Confirmar que no queda la pantalla bloqueada y que el scroll vuelve a funcionar normalmente.
7. Verificar que no aparece `AR / ArbiTrader / Cuenta Pro` en mobile.
