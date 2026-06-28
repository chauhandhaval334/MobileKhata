require('dotenv').config({ path: '.env' });
const { query } = require('./config/database');

async function run() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS app_config (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await query(`
      INSERT INTO app_config (key, value) VALUES
        ('support_whatsapp',   '+918160707979'),
        ('support_email',      'support@mobilekhata.com'),
        ('privacy_policy_url', 'https://sites.google.com/view/mobilekhata/home')
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log('Migration OK');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}
run();
