'use strict';

const { Pool } = require('pg');
const env = require('./env');
const logger = require('../utils/logger');

/**
 * PostgreSQL connection pool.
 * Uses pg Pool for connection reuse — production-safe.
 */
const poolConfig = env.db.connectionString
  ? {
      connectionString: env.db.connectionString,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: env.db.host,
      port: env.db.port,
      database: env.db.name,
      user: env.db.user,
      password: env.db.password,
      ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool({
  ...poolConfig,
  max: 5,                          // Neon free tier: max 10 connections
  idleTimeoutMillis: 30000,        // 30s — recycle before Neon's 5-min idle kill
  connectionTimeoutMillis: 10000,  // 10s to acquire connection
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err, client) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message });
  // Remove the errored client — pool will create a new one automatically
});

/**
 * Execute a parameterised query.
 * @param {string} text  — SQL with $1,$2… placeholders
 * @param {any[]}  params — parameter values
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('DB query executed', { duration, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.error('DB query error', { text, error: err.message });
    throw err;
  }
};

/**
 * Get a client from the pool for manual transaction management.
 * Remember to call client.release() in finally block.
 */
const getClient = () => pool.connect();

/**
 * Run multiple queries inside a single ACID transaction.
 * @param {Function} callback — receives (client) and should return a value
 */
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Test the connection — called at server startup.
 */
const runMigrations = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS how_to_use_videos (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          duration VARCHAR(50),
          video_url TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const countRes = await query('SELECT COUNT(*) FROM how_to_use_videos');
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      await query(`
        INSERT INTO how_to_use_videos (title, description, duration, video_url) VALUES 
        ('How to Add a Sale Entry', 'Learn how to record device sales, select brands/models, scan IMEI, and print digital receipts.', '2:15 mins', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        ('How to Add a Purchase Entry', 'Learn how to add incoming mobile stocks, record supplier details, and manage inventory costs.', '1:48 mins', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        ('How to Track Mobile Repairs', 'Manage repair jobs, setup device symptoms, estimate costs, and track status change logs.', '3:04 mins', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        ('How to Generate & Export PDF Reports', 'Generate consolidated PDF sales/purchase books and share ledger statements on WhatsApp.', '2:30 mins', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        ('Managing App Security & PIN Lock', 'Keep your business transactions secure by setting up and managing a 4-digit PIN lock.', '1:15 mins', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      `);
      logger.info('Database seeded with default how-to-use videos');
    }
  } catch (err) {
    logger.error('Failed to run schema migrations:', { error: err.message });
  }
};

const testConnection = async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    logger.info('PostgreSQL connected successfully');
    await runMigrations();
  } finally {
    client.release();
  }
};

module.exports = { query, getClient, withTransaction, testConnection, pool };
