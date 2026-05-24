/**
 * PM2 Ecosystem Config
 * Deploy with: pm2 start ecosystem.config.js --env production
 * Save process list: pm2 save
 * Auto-start on reboot: pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'mobilekhata-backend',
      script: 'src/server.js',
      instances: 'max',          // use all CPU cores
      exec_mode: 'cluster',      // cluster mode for load balancing
      watch: false,              // never watch in production
      max_memory_restart: '500M',

      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/log/mobilekhata/pm2-error.log',
      out_file: '/var/log/mobilekhata/pm2-out.log',
      merge_logs: true,

      // Restart strategy
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',

      // Graceful shutdown
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 10000,
    },
  ],
};
