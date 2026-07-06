'use strict';

require('dotenv').config();

/**
 * Central environment config — all process.env reads happen here.
 * The rest of the codebase imports from this file, never from process.env directly.
 */
const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,

  // PostgreSQL — supports both DATABASE_URL (Neon/Render) and individual DB_* vars
  db: {
    connectionString: process.env.DATABASE_URL || null,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'mobilekhata',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' || !!process.env.DATABASE_URL,
  },

  // Firebase Admin
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Handle escaped newlines from .env files
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  },

  // File uploads
  uploads: {
    dir: process.env.UPLOADS_DIR || './uploads',
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
  },

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000'],

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logDir: process.env.LOG_DIR || './logs',

  // Admin — comma-separated Firebase UIDs that have admin access
  adminUids: process.env.ADMIN_UIDS
    ? process.env.ADMIN_UIDS.split(',').map((u) => u.trim()).filter(Boolean)
    : [],
};

// Fail fast on missing critical config — production only
if (env.NODE_ENV === 'production') {
  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_STORAGE_BUCKET',
  ];
  required.forEach((key) => {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  });
  if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
    throw new Error('Missing required environment variable: DATABASE_URL or DB_PASSWORD');
  }
}

module.exports = env;
