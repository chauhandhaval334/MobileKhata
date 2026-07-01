require('dotenv').config({ path: '.env' });
const { query } = require('./config/database');

async function run() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS shop_devices (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        shop_id        UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        device_id      TEXT NOT NULL,
        device_name    TEXT NOT NULL DEFAULT '',
        os_version     TEXT NOT NULL DEFAULT '',
        app_version    TEXT NOT NULL DEFAULT '',
        login_count    INTEGER NOT NULL DEFAULT 1,
        last_login_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        
        UNIQUE (shop_id, device_id)
      );
    `);
    
    await query(`CREATE INDEX IF NOT EXISTS idx_shop_devices_shop_id ON shop_devices(shop_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_shop_devices_device_id ON shop_devices(device_id);`);

    console.log('Migration shop_devices OK');
  } catch (e) {
    console.error('Error during shop_devices migration:', e.message);
  } finally {
    process.exit(0);
  }
}
run();
