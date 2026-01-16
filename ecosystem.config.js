/**
 * PM2 Ecosystem Configuration
 *
 * Process manager configuration for VPS deployment.
 * Run with: pm2 start ecosystem.config.js
 *
 * @see https://pm2.keymetrics.io/docs/usage/application-declaration/
 */

module.exports = {
  apps: [
    {
      // Application name shown in pm2 list
      name: 'pickmyclass',

      // Entry point script
      script: 'server.ts',

      // Use bun as the interpreter (instead of node)
      interpreter: 'bun',

      // Number of instances (1 due to 1GB RAM constraint on VPS)
      // The server already handles cron + worker in a single process
      instances: 1,

      // Execution mode: fork for single instance
      exec_mode: 'fork',

      // Environment variables for production
      // Actual values are loaded from .env or set via pm2 start --env
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Log configuration
      // Logs stored in ./logs/ directory (created automatically)
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pickmyclass-error.log',
      out_file: './logs/pickmyclass-out.log',
      combine_logs: true,

      // Log rotation settings
      // Keeps logs manageable on VPS with limited storage
      max_size: '50M',
      retain: 5,

      // Restart policy
      // Automatically restart on crash with exponential backoff
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,

      // Exponential backoff restart delay
      // After each crash, wait longer before restart (up to 15 seconds)
      exp_backoff_restart_delay: 100,

      // Watch disabled in production (use deploy script for updates)
      watch: false,
      ignore_watch: ['node_modules', '.git', 'logs', '.next'],

      // Graceful shutdown settings
      // Match the 30-second timeout in server.ts
      kill_timeout: 35000,
      wait_ready: true,
      listen_timeout: 10000,

      // Memory limit (optional safety net for 1GB VPS)
      // Restart if memory exceeds 800MB to leave room for system
      max_memory_restart: '800M',
    },
  ],
};
