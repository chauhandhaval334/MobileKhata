'use strict';

/**
 * Database migration runner.
 * Run: node src/database/migrate.js
 *
 * Reads schema.sql and executes it against the configured PostgreSQL database.
 * Safe to run multiple times — all statements use CREATE IF NOT EXISTS / OR REPLACE.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const env = require('../config/env');

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
});

const run = async () => {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('🚀 Running MobileKhata database migration...');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('✅ Migration completed successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
