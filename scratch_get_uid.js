'use strict';
require('dotenv').config();
const { query } = require('./src/config/database');

async function run() {
  try {
    const shopRes = await query('SELECT * FROM shops WHERE firebase_uid = $1', ['G72RFWR2W8YFdB6CtVIqfpPmgCt2']);
    console.log('Shops for UID G72RFWR2W8YFdB6CtVIqfpPmgCt2:');
    console.log(shopRes.rows);

    const userFeatures = await query('SELECT * FROM user_features WHERE shop_id IN (SELECT id FROM shops WHERE firebase_uid = $1)', ['G72RFWR2W8YFdB6CtVIqfpPmgCt2']);
    console.log('User Features:');
    console.log(userFeatures.rows);
  } catch (err) {
    console.error('Error querying database:', err.message);
  } finally {
    process.exit(0);
  }
}

run();
