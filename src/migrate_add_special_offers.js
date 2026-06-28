'use strict';

/**
 * Migration: Add special_offers table for One Time Offer (OTO) popup feature.
 * Run: node src/migrate_add_special_offers.js
 */

require('dotenv').config();
const { query } = require('./config/database');
const logger = require('./utils/logger');

async function migrate() {
  logger.info('Running migration: add special_offers table...');

  // 1. Create the special_offers table
  await query(`
    CREATE TABLE IF NOT EXISTS special_offers (
      id                  TEXT PRIMARY KEY,
      is_active           BOOLEAN NOT NULL DEFAULT FALSE,
      title               TEXT NOT NULL DEFAULT 'One Time Offer',
      title_hi            TEXT NOT NULL DEFAULT 'एक बार का ऑफर',
      title_gu            TEXT NOT NULL DEFAULT 'એક વખત ઓફર',
      subtitle            TEXT NOT NULL DEFAULT 'Limited Time Offer',
      subtitle_hi         TEXT NOT NULL DEFAULT 'सीमित समय ऑफर',
      subtitle_gu         TEXT NOT NULL DEFAULT 'સીમિત સમય ઓફર',
      discount_pct        INTEGER NOT NULL DEFAULT 40,
      plan_id             TEXT REFERENCES premium_plans(id) ON DELETE SET NULL,
      original_price      INTEGER NOT NULL DEFAULT 999,
      offer_price         INTEGER NOT NULL DEFAULT 599,
      currency            TEXT NOT NULL DEFAULT '₹',
      price_unit          TEXT NOT NULL DEFAULT 'per year',
      price_unit_hi       TEXT NOT NULL DEFAULT 'प्रति वर्ष',
      price_unit_gu       TEXT NOT NULL DEFAULT 'દર વર્ષ',
      countdown_seconds   INTEGER NOT NULL DEFAULT 600,
      bg_gradient_start   TEXT NOT NULL DEFAULT '#0f0f1a',
      bg_gradient_end     TEXT NOT NULL DEFAULT '#1a0a2e',
      accent_color_start  TEXT NOT NULL DEFAULT '#FF6B6B',
      accent_color_end    TEXT NOT NULL DEFAULT '#FF8E53',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  logger.info('✅ Created special_offers table');

  // 2. Add trigger for updated_at
  await query(`
    DROP TRIGGER IF EXISTS trg_special_offers_updated_at ON special_offers;
    CREATE TRIGGER trg_special_offers_updated_at
      BEFORE UPDATE ON special_offers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
  logger.info('✅ Added updated_at trigger for special_offers');

  // 3. Seed a default (inactive) offer
  await query(`
    INSERT INTO special_offers (
      id, is_active, title, title_hi, title_gu,
      subtitle, subtitle_hi, subtitle_gu,
      discount_pct, plan_id,
      original_price, offer_price, currency, price_unit, price_unit_hi, price_unit_gu,
      countdown_seconds,
      bg_gradient_start, bg_gradient_end,
      accent_color_start, accent_color_end
    ) VALUES (
      'oto_main',
      FALSE,
      'One Time Offer',
      'एक बार का ऑफर',
      'એક વખત ઓફર',
      'Limited Time Offer',
      'सीमित समय ऑफर',
      'સીમિત સમય ઓફર',
      40,
      'plan_1y',
      999,
      599,
      '₹',
      'per year',
      'प्रति वर्ष',
      'દર વર્ષ',
      600,
      '#0f0f1a',
      '#1a0a2e',
      '#FF6B6B',
      '#FF8E53'
    )
    ON CONFLICT (id) DO NOTHING;
  `);
  logger.info('✅ Seeded default special_offer (is_active=false)');

  logger.info('Migration completed successfully!');
  logger.info('Use admin panel to activate offer: PATCH /api/v2/admin/offers/oto_main/toggle');
  process.exit(0);
}

migrate().catch(err => {
  logger.error('Migration failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
