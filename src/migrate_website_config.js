require('dotenv').config({ path: '.env' });
const { query } = require('./config/database');

async function run() {
  try {
    await query(`
      INSERT INTO app_config (key, value) VALUES
        ('website_hero_title', 'Manage Your Mobile Shop with Ease'),
        ('website_hero_subtitle', 'MobileKhata is the ultimate ledger and inventory management app designed specifically for mobile shop owners. Keep track of sales, purchases, and repairs effortlessly.'),
        ('website_about_text', 'MobileKhata was built to solve the daily challenges of mobile shop owners. From tracking IMEI numbers to maintaining customer ledgers and generating professional PDF invoices, our app digitizes your entire business workflow.')
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log('Website Migration OK');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    process.exit(0);
  }
}
run();
