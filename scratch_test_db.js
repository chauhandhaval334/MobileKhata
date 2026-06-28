'use strict';
require('dotenv').config();
const { query } = require('./src/config/database');

async function test() {
  try {
    const tables = await query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables:', tables.rows.map(r => r.table_name));

    const { getMaintenanceMode } = require('./src/utils/maintenanceStore');
    console.log('Current maintenance mode:', await getMaintenanceMode());
  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    process.exit(0);
  }
}

test();
