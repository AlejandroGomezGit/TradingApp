/**
 * PM2 Ecosystem Config — Trading Bot
 *
 * Uso:
 *   cd backend
 *   npx pm2 start ecosystem.config.js          # arrancar
 *   npx pm2 stop trading-bot                    # parar
 *   npx pm2 restart trading-bot                 # reiniciar
 *   npx pm2 logs trading-bot                    # ver logs en vivo
 *   npx pm2 status                              # estado
 *   npx pm2 startup && npx pm2 save             # auto-arranque al reiniciar Mac
 */

module.exports = {
  apps: [
    {
      name: 'trading-bot',
      script: 'npx',
      args: 'tsx src/index.ts',

      // Directorio de trabajo
      cwd: __dirname,

      // NO usar watch — PM2 maneja los reinicios, no tsx
      watch: false,

      // Reinicio automático en crashes
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,       // esperar 5s entre reinicios (evita crash loops rápidos)
      min_uptime: '10s',         // si muere en <10s se cuenta como crash

      // Memoria: reiniciar si supera 500MB
      max_memory_restart: '500M',

      // Logs
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Variables de entorno
      env: {
        NODE_ENV: 'production',
        TZ: 'America/New_York',    // fuerza timezone ET para cron
      },

      // Interpretador
      interpreter: 'none',
    },
  ],
};
