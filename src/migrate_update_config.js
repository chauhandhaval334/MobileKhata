require('dotenv').config({ path: '.env' });
const { query } = require('./config/database');

async function run() {
  try {
    await query(`
      INSERT INTO app_config (key, value) VALUES
        ('min_app_version_code', '3'),
        ('app_update_url', 'https://play.google.com/store/apps/details?id=com.mobilekhata')
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
