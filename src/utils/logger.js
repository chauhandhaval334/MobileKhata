'use strict';

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');

// Ensure log directory exists
if (!fs.existsSync(env.logDir)) {
  fs.mkdirSync(env.logDir, { recursive: true });
}

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const logger = winston.createLogger({
  level: env.logLevel,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    json()
  ),
  transports: [
    // Rotating file for errors
    new winston.transports.File({
      filename: path.join(env.logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    }),
    // Rotating file for all logs
    new winston.transports.File({
      filename: path.join(env.logDir, 'combined.log'),
      maxsize: 20 * 1024 * 1024, // 20 MB
      maxFiles: 10,
    }),
  ],
});

// Pretty console output in development
if (env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: combine(colorize(), simple()),
    })
  );
} else {
  // In production, still log to console (PM2 captures stdout)
  logger.add(
    new winston.transports.Console({
      format: combine(timestamp(), json()),
    })
  );
}

module.exports = logger;
