'use strict';

// Load environment first — before any other imports
require('dotenv').config();

const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { testConnection } = require('./config/database');
const { initFirebase } = require('./config/firebase');
const { initUploadDirs } = require('./services/uploadService');

let server;

const start = async () => {
  try {
    // 1. Initialise Firebase Admin SDK
    initFirebase();

    // 2. Test PostgreSQL connection
    try {
      await testConnection();
    } catch (dbErr) {
      if (env.NODE_ENV === 'production') throw dbErr;
      logger.warn('PostgreSQL not connected — DB routes will fail until database is running.', {
        hint: 'Install PostgreSQL and create the mobilekhata database, then restart the server.',
      });
    }

    // 3. Ensure upload directories exist
    initUploadDirs();

    // 4. Start HTTP server
    server = app.listen(env.PORT, '0.0.0.0', () => {
      logger.info(`MobileKhata backend started`, {
        port:        env.PORT,
        environment: env.NODE_ENV,
        pid:         process.pid,
      });
    });

    // Graceful shutdown helpers
    server.keepAliveTimeout = 65 * 1000;
    server.headersTimeout   = 66 * 1000;

  } catch (err) {
    logger.error('Server startup failed', { error: err.message, stack: err.stack });
    process.exit(1);
  }
};

// ─── Graceful Shutdown ─────────────────────────────────────────────────────────

const shutdown = (signal) => {
  logger.info(`Received ${signal} — shutting down gracefully`);
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

start();
