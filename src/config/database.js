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
const testConnection = async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    logger.info('PostgreSQL connected successfully');
  } finally {
    client.release();
  }
};

module.exports = { query, getClient, withTransaction, testConnection, pool };
