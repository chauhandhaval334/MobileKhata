'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const env = require('../config/env');

const poolConfig = env.db.connectionString
  ? { connectionString: env.db.connectionString, ssl: { rejectUnauthorized: false } }
  : {
      host: env.db.host,
      port: env.db.port,
      database: env.db.name,
      user: env.db.user,
      password: env.db.password,
      ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(poolConfig);

const run = async () => {
  console.log('🚀 Running Brand/Model Catalog migration...');
  const client = await pool.connect();

  try {
    // 1. Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS catalog_brands (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS catalog_models (
          id SERIAL PRIMARY KEY,
          brand_id INTEGER NOT NULL REFERENCES catalog_brands(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(brand_id, name)
      );
    `);
    console.log('✅ Tables created: catalog_brands, catalog_models');

    // 2. Check if already seeded
    const countCheck = await client.query('SELECT COUNT(*) FROM catalog_brands');
    if (parseInt(countCheck.rows[0].count) > 0) {
      console.log('ℹ️ Catalog already seeded. Skipping initial seeding.');
      return;
    }

    // 3. Seed from Android JSON
    const jsonPath = 'C:/Users/dhava/Documents/MobileKhata/app/src/main/assets/brand_models.json';
    if (!fs.existsSync(jsonPath)) {
      console.log('⚠️ brand_models.json not found at expected path. Skipping seeding.');
      return;
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`🌱 Seeding ${data.length} brands into database...`);

    await client.query('BEGIN');
    for (const item of data) {
      const brandName = item.brand.trim();
      const models = item.models || [];
      if (!brandName) continue;

      // Insert brand
      const brandRes = await client.query(
        'INSERT INTO catalog_brands (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id',
        [brandName]
      );
      const brandId = brandRes.rows[0].id;

      // Insert models
      for (const modelName of models) {
        const trimmedModel = modelName.trim();
        if (!trimmedModel) continue;
        await client.query(
          'INSERT INTO catalog_models (brand_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [brandId, trimmedModel]
        );
      }
    }
    await client.query('COMMIT');
    console.log('✅ Catalog seeding completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration/Seeding failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
