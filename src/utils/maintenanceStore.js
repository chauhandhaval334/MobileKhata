'use strict';

const { query } = require('../config/database');
const logger = require('./logger');

// In-memory cache for maintenance mode to avoid querying the DB on every single request
let isMaintenanceCached = null;

/**
 * Initialize system_settings table and seed default configs if missing
 */
async function ensureSettingsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    
    await query(`
      INSERT INTO system_settings (key, value)
      VALUES ('maintenance_mode', 'false')
      ON CONFLICT (key) DO NOTHING
    `);
  } catch (err) {
    logger.error('Failed to ensure settings table exists', { error: err.message });
  }
}

/**
 * Retrieve maintenance mode status (uses in-memory cache if available)
 */
async function getMaintenanceMode() {
  try {
    if (isMaintenanceCached !== null) {
      return isMaintenanceCached;
    }
    await ensureSettingsTable();
    const res = await query(`SELECT value FROM system_settings WHERE key = 'maintenance_mode'`);
    const isActive = res.rows[0]?.value === 'true';
    isMaintenanceCached = isActive;
    return isActive;
  } catch (err) {
    logger.error('Failed to get maintenance mode status', { error: err.message });
    return false; // Safe default
  }
}

/**
 * Set maintenance mode status in DB and update the cache
 */
async function setMaintenanceMode(value) {
  try {
    await ensureSettingsTable();
    await query(
      `INSERT INTO system_settings (key, value) VALUES ('maintenance_mode', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [value ? 'true' : 'false']
    );
    isMaintenanceCached = value;
    logger.info(`Maintenance mode status changed to: ${value}`);
    return true;
  } catch (err) {
    logger.error('Failed to set maintenance mode status', { error: err.message });
    throw err;
  }
}

module.exports = { getMaintenanceMode, setMaintenanceMode };

