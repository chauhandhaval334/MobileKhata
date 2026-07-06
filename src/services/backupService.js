'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { query } = require('../config/database');
const { admin } = require('../config/firebase');
const env = require('../config/env');
const logger = require('../utils/logger');

// Cache config in memory to avoid querying the DB every minute
let backupConfig = {
  enabled: false,
  time: '02:00', // HH:MM in 24-hour IST
  lastRunDate: null,
  isBackupRunning: false
};

let schedulerIntervalId = null;

/**
 * Gets the current date and time formatted in Indian Standard Time (IST, UTC+5:30)
 * @returns {{ dateStr: string, timeStr: string }}
 */
const getISTDateTime = () => {
  const now = new Date();
  // Add 5 hours and 30 minutes offset for IST
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);

  const yyyy = istTime.getUTCFullYear();
  const mm = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(istTime.getUTCDate()).padStart(2, '0');

  const hh = String(istTime.getUTCHours()).padStart(2, '0');
  const min = String(istTime.getUTCMinutes()).padStart(2, '0');

  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${min}`
  };
};

/**
 * Executes a PostgreSQL database dump and uploads it to Firebase Storage
 * @param {string} mode 'manual' or 'automatic'
 * @returns {Promise<object>} Info about the created backup
 */
const runBackup = async (mode = 'automatic') => {
  if (backupConfig.isBackupRunning) {
    logger.warn('A database backup is already in progress');
    throw new Error('Backup already in progress');
  }

  backupConfig.isBackupRunning = true;
  logger.info(`Starting ${mode} database backup...`);

  // Verify database connection string is present
  const dbUrl = env.db.connectionString;
  if (!dbUrl) {
    backupConfig.isBackupRunning = false;
    throw new Error('DATABASE_URL connection string is not configured');
  }

  // Get timestamp for filename (IST-based)
  const { dateStr } = getISTDateTime();
  const now = new Date();
  const timestamp = `${now.getUTCHours().toString().padStart(2, '0')}${now.getUTCMinutes().toString().padStart(2, '0')}${now.getUTCSeconds().toString().padStart(2, '0')}`;
  const fileName = `backup-${dateStr}-${timestamp}.sql.gz`;
  
  // Write to temporary local file in uploads folder
  const uploadsDir = path.resolve(env.uploads.dir);
  const localFilePath = path.join(uploadsDir, fileName);

  try {
    // 1. Run pg_dump and pipe to gzip
    await new Promise((resolve, reject) => {
      // Use pg_dump with dbUrl wrapped in quotes for safety
      const command = `pg_dump "${dbUrl}" | gzip > "${localFilePath}"`;
      
      exec(command, (err, stdout, stderr) => {
        if (err) {
          logger.error('pg_dump execution failed:', { error: err.message, stderr });
          return reject(new Error(`Failed to generate database dump: ${err.message}`));
        }
        resolve();
      });
    });

    // Verify file exists and is not empty
    if (!fs.existsSync(localFilePath) || fs.statSync(localFilePath).size === 0) {
      throw new Error('Generated backup file is empty or does not exist');
    }

    const fileSize = fs.statSync(localFilePath).size;
    logger.info(`Backup file generated locally: ${fileName} (${fileSize} bytes)`);

    // 2. Upload to Firebase Storage
    if (!admin.apps.length) {
      throw new Error('Firebase Admin SDK is not initialised');
    }

    const bucket = admin.storage().bucket();
    const destination = `backups/${fileName}`;

    logger.info(`Uploading backup to Firebase Storage bucket at ${destination}...`);
    await bucket.upload(localFilePath, {
      destination: destination,
      metadata: {
        contentType: 'application/gzip',
        metadata: {
          uploadedBy: 'MobileKhata Server',
          backupMode: mode,
          originalSize: String(fileSize)
        }
      }
    });

    logger.info(`Database backup uploaded successfully: ${destination}`);

    // Return backup details
    return {
      fileName,
      destination,
      sizeBytes: fileSize,
      createdAt: new Date().toISOString()
    };

  } catch (err) {
    logger.error('Database backup failed:', { error: err.message });
    throw err;
  } finally {
    // Clean up local temp file
    try {
      if (fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath);
        logger.debug(`Cleaned up temporary backup file: ${localFilePath}`);
      }
    } catch (cleanupErr) {
      logger.error('Failed to delete temporary backup file:', { error: cleanupErr.message });
    }
    backupConfig.isBackupRunning = false;
  }
};

/**
 * Loads configuration from database and updates memory cache
 */
const syncConfigFromDatabase = async () => {
  try {
    const res = await query(
      `SELECT key, value FROM app_config WHERE key IN ('backup_enabled', 'backup_time')`
    );

    let enabledVal = 'false';
    let timeVal = '02:00';

    res.rows.forEach(row => {
      if (row.key === 'backup_enabled') enabledVal = row.value;
      if (row.key === 'backup_time') timeVal = row.value;
    });

    backupConfig.enabled = enabledVal === 'true';
    // Validate time format HH:MM
    if (/^\d{2}:\d{2}$/.test(timeVal)) {
      backupConfig.time = timeVal;
    } else {
      backupConfig.time = '02:00';
    }

    logger.info('Database backup scheduler config loaded:', {
      enabled: backupConfig.enabled,
      timeIST: backupConfig.time
    });
  } catch (err) {
    logger.error('Failed to sync backup scheduler config from database:', { error: err.message });
  }
};

/**
 * Runs the check tick every 60 seconds
 */
const runSchedulerTick = async () => {
  if (!backupConfig.enabled) return;

  const { dateStr, timeStr } = getISTDateTime();

  // If time matches and it hasn't run today yet
  if (timeStr === backupConfig.time && backupConfig.lastRunDate !== dateStr) {
    try {
      logger.info(`Scheduled backup trigger activated for time ${timeStr} IST`);
      await runBackup('automatic');
      backupConfig.lastRunDate = dateStr;
    } catch (err) {
      logger.error('Scheduled database backup execution failed:', { error: err.message });
    }
  }
};

/**
 * Initialises the backup scheduler on server startup
 */
const initBackupScheduler = async () => {
  // Sync config from database first
  await syncConfigFromDatabase();

  // Prevent duplicate intervals
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
  }

  // Run the scheduler tick once every 60 seconds
  schedulerIntervalId = setInterval(runSchedulerTick, 60 * 1000);
  logger.info('Database backup scheduler initialised and ticking (every 60s)');
};

/**
 * Updates the scheduler settings in memory immediately
 * @param {boolean} enabled 
 * @param {string} time HH:MM format
 */
const updateSchedulerConfig = (enabled, time) => {
  backupConfig.enabled = enabled;
  if (/^\d{2}:\d{2}$/.test(time)) {
    backupConfig.time = time;
  }
  logger.info('Database backup scheduler config updated in-memory:', {
    enabled: backupConfig.enabled,
    timeIST: backupConfig.time
  });
};

/**
 * Lists all backups stored in Firebase Storage /backups directory
 */
const listBackups = async () => {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin SDK is not initialised');
  }

  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({
    prefix: 'backups/'
  });

  // Filter out any folder placeholder objects and map values
  return files
    .filter(file => !file.name.endsWith('/'))
    .map(file => {
      const metadata = file.metadata;
      return {
        fileName: path.basename(file.name),
        fullPath: file.name,
        sizeBytes: parseInt(metadata.size, 10),
        createdAt: metadata.timeCreated,
        updatedAt: metadata.updated,
        backupMode: metadata.metadata ? metadata.metadata.backupMode : 'unknown'
      };
    })
    // Sort newest first
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

/**
 * Generates a short-lived download URL for a backup file
 * @param {string} fileName Name of the backup file (just the basename)
 * @returns {Promise<string>} Download URL valid for 5 minutes
 */
const getBackupDownloadUrl = async (fileName) => {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin SDK is not initialised');
  }

  const cleanName = path.basename(fileName);
  const bucket = admin.storage().bucket();
  const file = bucket.file(`backups/${cleanName}`);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`Backup file not found: ${cleanName}`);
  }

  // Generate signed URL valid for 5 minutes (300 seconds)
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 5 * 60 * 1000 // 5 minutes
  });

  return signedUrl;
};

/**
 * Deletes a backup file from Firebase Storage
 * @param {string} fileName Name of the backup file (just the basename)
 */
const deleteBackup = async (fileName) => {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin SDK is not initialised');
  }

  const cleanName = path.basename(fileName);
  const bucket = admin.storage().bucket();
  const file = bucket.file(`backups/${cleanName}`);

  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`Backup file not found: ${cleanName}`);
  }

  await file.delete();
  logger.info(`Deleted backup file from Firebase Storage: backups/${cleanName}`);
};

module.exports = {
  runBackup,
  initBackupScheduler,
  updateSchedulerConfig,
  syncConfigFromDatabase,
  listBackups,
  getBackupDownloadUrl,
  deleteBackup
};
