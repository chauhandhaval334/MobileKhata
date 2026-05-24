'use strict';

/**
 * Database seeder — creates a test shop + sample data for development.
 * Run: node src/database/seed.js
 *
 * WARNING: Only run in development. Will insert dummy records.
 */

require('dotenv').config();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  ssl: env.db.ssl ? { rejectUnauthorized: false } : false,
});

const SEED_UID    = 'test-firebase-uid-001';
const SEED_SHOP   = uuidv4();
const SEED_DEV1   = uuidv4();
const SEED_DEV2   = uuidv4();
const SEED_CUST1  = uuidv4();
const SEED_CUST2  = uuidv4();
const SEED_TXN1   = uuidv4();
const SEED_TXN2   = uuidv4();
const SEED_TXN3   = uuidv4();

const run = async () => {
  if (env.NODE_ENV === 'production') {
    console.error('❌ Cannot seed in production environment!');
    process.exit(1);
  }

  const client = await pool.connect();
  console.log('🌱 Seeding MobileKhata database...');

  try {
    await client.query('BEGIN');

    // 1. Shop
    await client.query(
      `INSERT INTO shops (id, firebase_uid, phone_number, shop_name, shop_address, owner_name, district, gst_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (firebase_uid) DO NOTHING`,
      [SEED_SHOP, SEED_UID, '+919876543210', 'Raj Mobile Store',
       'Shop No. 5, MG Road, Jaipur', 'Rajesh Kumar', 'Jaipur', '08AAAAA0000A1Z5']
    );
    console.log('  ✓ Shop created');

    // 2. Customers
    await client.query(
      `INSERT INTO customers (id, shop_id, full_name, mobile, address, district, aadhaar_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [SEED_CUST1, SEED_SHOP, 'Amit Sharma', '9811111111', '12 Vaishali Nagar', 'Jaipur', '123456789012']
    );
    await client.query(
      `INSERT INTO customers (id, shop_id, full_name, mobile, address, district, aadhaar_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [SEED_CUST2, SEED_SHOP, 'Priya Singh', '9822222222', '45 Civil Lines', 'Ajmer', '987654321098']
    );
    console.log('  ✓ Customers created');

    // 3. Devices
    await client.query(
      `INSERT INTO devices (id, shop_id, imei1, imei2, brand, model, storage, color, condition_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [SEED_DEV1, SEED_SHOP, '356789012345678', '356789012345679', 'Samsung', 'Galaxy A54', '128GB', 'Black', 'New']
    );
    await client.query(
      `INSERT INTO devices (id, shop_id, imei1, imei2, brand, model, storage, color, condition_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [SEED_DEV2, SEED_SHOP, '490154203237518', '', 'Apple', 'iPhone 13', '256GB', 'Midnight', 'Used']
    );
    console.log('  ✓ Devices created');

    // 4. Transactions
    const date1 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const date2 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const date3 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

    await client.query(
      `INSERT INTO transactions (id, android_txn_id, shop_id, device_id, customer_id, txn_type, amount, payment_method, txn_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [SEED_TXN1, 'android-txn-001', SEED_SHOP, SEED_DEV1, SEED_CUST1, 'Purchase', 22000, 'Cash', date1]
    );
    await client.query(
      `INSERT INTO transactions (id, android_txn_id, shop_id, device_id, customer_id, txn_type, amount, payment_method, txn_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [SEED_TXN2, 'android-txn-002', SEED_SHOP, SEED_DEV1, SEED_CUST2, 'Sale', 25500, 'Online', date2]
    );
    await client.query(
      `INSERT INTO transactions (id, android_txn_id, shop_id, device_id, customer_id, txn_type, amount, payment_method, txn_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [SEED_TXN3, 'android-txn-003', SEED_SHOP, SEED_DEV2, SEED_CUST1, 'Purchase', 45000, 'Cheque', date3]
    );
    console.log('  ✓ Transactions created');

    // 5. Timeline events
    await client.query(
      `INSERT INTO timeline_events (shop_id, transaction_id, device_id, imei1, event_type, title, value, event_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [SEED_SHOP, SEED_TXN1, SEED_DEV1, '356789012345678', 'Purchase', 'Purchase: Samsung Galaxy A54', '₹22000', date1]
    );
    await client.query(
      `INSERT INTO timeline_events (shop_id, transaction_id, device_id, imei1, event_type, title, value, event_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [SEED_SHOP, SEED_TXN2, SEED_DEV1, '356789012345678', 'Sale', 'Sale: Samsung Galaxy A54', '₹25500', date2]
    );
    console.log('  ✓ Timeline events created');

    await client.query('COMMIT');
    console.log('\n✅ Seed completed successfully.');
    console.log(`\n📋 Test credentials:`);
    console.log(`   Firebase UID : ${SEED_UID}`);
    console.log(`   Shop ID      : ${SEED_SHOP}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
