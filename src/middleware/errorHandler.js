'use strict';

const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Global error handler — Express 4 error middleware.
 * Must be registered LAST in app.js after all routes.
 *
 * Works with express-async-errors package which patches
 * async route handlers to automatically call next(err).
 */
const errorHandler = (err, req, res, next) => {
  // Log the full error internally
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    uid: req.user?.uid || 'unauthenticated',
  });

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry — this record already exists',
      code: 'DUPLICATE_ENTRY',
    });
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      error: 'Referenced resource does not exist',
      code: 'FK_VIOLATION',
    });
  }

  // Multer file size error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: `File too large. Maximum allowed size is ${require('../config/env').uploads.maxFileSizeMb}MB`,
      code: 'FILE_TOO_LARGE',
    });
  }

  // Multer unexpected field
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: 'Unexpected file field in upload',
      code: 'UNEXPECTED_FILE',
    });
  }

  // Default 500
  const statusCode = err.statusCode || err.status || 500;
  return res.status(statusCode).json({
    success: false,
    error: env.NODE_ENV === 'production'
      ? 'Something went wrong on the server'
      : err.message,
    code: err.code || 'INTERNAL_ERROR',
    // Only expose stack in development
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};

/**
 * 404 handler — registered after all valid routes.
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
  });
};

module.exports = { errorHandler, notFoundHandler };
