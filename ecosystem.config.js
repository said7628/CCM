// ecosystem.config.js — PM2 para el dashboard de arbitraje de BTC.
// Ejecuta desde la raíz del proyecto (donde está package.json), tras `npm install`.
//
//   pm2 start ecosystem.config.js
//
module.exports = {
  apps: [
    {
      name: 'arbi-bot',

      // Corre el server TS directo con ts-node (transpile-only = rápido, sin paso
      // de build y sin tener que copiar a mano los assets de src/server/public).
      script: 'src/server/index.ts',
      interpreter: 'node',
      interpreter_args: '-r ts-node/register/transpile-only',

      // CRÍTICO: una sola instancia en modo fork. El motor mantiene estado en
      // memoria (wallets, trades, clientes SSE) y UN solo feed de mercado.
      // Cluster mode levantaría varios motores en conflicto y rompería el panel.
      instances: 1,
      exec_mode: 'fork',

      // Reinicios automáticos ante caídas.
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '600M',

      // Logs con timestamp.
      time: true,
      merge_logs: true,
      out_file: './logs/arbi-out.log',
      error_file: './logs/arbi-err.log',

      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        DATA_DIR: './data', // prefs + P&L persistidos sobreviven reinicios

        // NO definas SOURCE aquí: así el toggle live/sim del dashboard funciona
        // y se guarda. Si quieres FORZAR el modo al arrancar, descomenta uno:
        // SOURCE: 'sim',                       // demo estable y determinista
        // SOURCE: 'live',                      // feeds reales por WebSocket
        // EXCHANGES: 'binance,okx,kraken',     // venues a usar
        // INTERVAL_MS: '150',                  // cadencia del tick (ms)
        // SIM_DIVERGENCE_CHANCE: '0.35',       // afina la actividad del simulador
        // SIM_EDGE_MIN_PCT: '0.0010',
        // SIM_EDGE_MAX_PCT: '0.0045',
      },
    },
  ],
};
