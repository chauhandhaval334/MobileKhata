'use strict';

/**
 * Migration: Add Bills & Invoices tables.
 * Run: node src/migrate_add_bills.js
 */

require('dotenv').config();
const { query } = require('./config/database');
const logger = require('./utils/logger');

async function migrate() {
  logger.info('Running migration: Unified Bill Book System...');

  // Create bills table
  await query(`
    CREATE TABLE IF NOT EXISTS bills (
      id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      remote_id           UUID        UNIQUE DEFAULT uuid_generate_v4(),
      android_bill_id     BIGINT      NOT NULL DEFAULT 0,
      shop_id             UUID        REFERENCES shops(id) ON DELETE CASCADE,
      bill_number         TEXT        NOT NULL DEFAULT '',
      bill_type           TEXT        NOT NULL DEFAULT 'Invoice'
                          CHECK (bill_type IN ('Cash Bill','Estimate','Invoice','Receipt','Quotation','Custom Bill')),
      source_module       TEXT        NOT NULL DEFAULT 'manual'
                          CHECK (source_module IN (
                            'manual','mobile_sale','mobile_purchase','mobile_repair',
                            'accessories_sale','accessories_purchase'
                          )),
      payment_status      TEXT        NOT NULL DEFAULT 'Paid'
                          CHECK (payment_status IN ('Draft','Paid','Unpaid','Partial Payment','Cancelled')),
      customer_name       TEXT        NOT NULL DEFAULT '',
      customer_mobile     TEXT        NOT NULL DEFAULT '',
      customer_address    TEXT        NOT NULL DEFAULT '',
      customer_gstin      TEXT        NOT NULL DEFAULT '',
      items_json          TEXT        NOT NULL DEFAULT '[]',
      subtotal            DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      tax_percent         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      tax_amount          DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      discount_amount     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      grand_total         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      payment_method      TEXT        NOT NULL DEFAULT 'Cash',
      template_type       TEXT        NOT NULL DEFAULT 'Simple',
      timeline_json       TEXT        NOT NULL DEFAULT '[]',
      created_at_millis   BIGINT      NOT NULL DEFAULT 0,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (shop_id, android_bill_id)
    );
  `);
  logger.info('✅ Created bills table');

  // Create indexes
  await query(`
    CREATE INDEX IF NOT EXISTS idx_bills_shop_id        ON bills(shop_id);
    CREATE INDEX IF NOT EXISTS idx_bills_bill_number    ON bills(bill_number);
    CREATE INDEX IF NOT EXISTS idx_bills_customer_phone ON bills(customer_mobile);
    CREATE INDEX IF NOT EXISTS idx_bills_source_module  ON bills(source_module);
    CREATE INDEX IF NOT EXISTS idx_bills_created_at     ON bills(created_at_millis DESC);
  `);
  logger.info('✅ Created indexes for bills table');

  // Attach updated_at trigger
  await query(`
    DROP TRIGGER IF EXISTS trg_bills_updated_at ON bills;
    CREATE TRIGGER trg_bills_updated_at
      BEFORE UPDATE ON bills
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
  logger.info('✅ Added trg_bills_updated_at trigger');

  logger.info('✅ Migration completed! Unified Bill Book is ready on server.');
  process.exit(0);
}

migrate().catch(err => {
  logger.error('Migration failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
