'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const env = require('./src/config/env');

const pool = new Pool(
  env.db.connectionString
    ? { connectionString: env.db.connectionString, ssl: { rejectUnauthorized: false } }
    : {
        host: env.db.host,
        port: env.db.port,
        database: env.db.name,
        user: env.db.user,
        password: env.db.password,
        ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
      }
);

async function main() {
  const client = await pool.connect();
  try {
    const brands = await client.query('SELECT COUNT(*), array_agg(name) FROM catalog_brands');
    console.log('Brands Count:', brands.rows[0].count);
    console.log('Sample Brands:', brands.rows[0].array_agg.slice(0, 10));
    const models = await client.query('SELECT COUNT(*) FROM catalog_models');
    console.log('Models Count:', models.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    client.release();
    await pool.end();
  }
}
main();
