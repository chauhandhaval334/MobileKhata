'use strict';

const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { query } = require('../config/database');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/auth');
const { success, paginate } = require('../utils/response');
const { getMaintenanceMode, setMaintenanceMode } = require('../utils/maintenanceStore');
const logger = require('../utils/logger');

const router = Router();

// Apply auth middleware to all routes in this router
router.use(verifyFirebaseToken, requireAdmin);

/**
 * GET /api/v2/admin/stats
 * Platform-wide stats across all shops.
 */
router.get('/stats', async (req, res) => {
  const [shopsRes, txnsRes, stockRes, customersRes] = await Promise.all([
    query(`SELECT COUNT(*) AS total FROM shops WHERE is_active = TRUE`),
    query(`SELECT
             txn_type,
             COUNT(*) AS count,
             COALESCE(SUM(amount), 0) AS total_amount
           FROM transactions GROUP BY txn_type`),
    query(`SELECT COUNT(*) AS total FROM current_stock`),
    query(`SELECT COUNT(*) AS total FROM customers`),
  ]);

  return success(res, {
    totalShops:     parseInt(shopsRes.rows[0].total, 10),
    totalCustomers: parseInt(customersRes.rows[0].total, 10),
    totalStock:     parseInt(stockRes.rows[0].total, 10),
    transactions:   txnsRes.rows,
  });
});

// GET /api/v2/admin/stats/bills-count
router.get('/stats/bills-count', async (req, res) => {
  try {
    const r = await query(`SELECT COUNT(*) AS total FROM bills`);
    return success(res, { total: parseInt(r.rows[0].total, 10) });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// GET /api/v2/admin/stats/premium-count
router.get('/stats/premium-count', async (req, res) => {
  try {
    const r = await query(`SELECT COUNT(*) AS total FROM user_features WHERE premium_expires_at > NOW()`);
    return success(res, { total: parseInt(r.rows[0].total, 10) });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v2/admin/activity-feed
 * Live activity feed — transactions + bills + premium activations across all shops.
 * Query params: limit (default 50), type (all|transaction|bill|premium)
 */
router.get('/activity-feed', async (req, res) => {

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const type = req.query.type || 'all';

  try {
    const parts = [];

    if (type === 'all' || type === 'transaction') {
      parts.push(`
        SELECT
          t.id,
          'transaction'            AS activity_type,
          t.txn_type               AS sub_type,
          t.txn_date               AS activity_at,
          s.shop_name,
          s.owner_name,
          s.phone_number           AS shop_phone,
          c.full_name              AS customer_name,
          c.mobile                 AS customer_mobile,
          d.brand                  AS device_brand,
          d.model                  AS device_model,
          d.imei1,
          d.storage,
          t.amount,
          t.payment_method,
          NULL::text               AS bill_number,
          NULL::text               AS plan_id,
          NULL::integer            AS price_paid
        FROM transactions t
        JOIN shops s     ON s.id = t.shop_id
        JOIN customers c ON c.id = t.customer_id
        JOIN devices d   ON d.id = t.device_id
      `);
    }

    if (type === 'all' || type === 'bill') {
      parts.push(`
        SELECT
          b.id,
          'bill'                   AS activity_type,
          b.template_type          AS sub_type,
          b.created_at             AS activity_at,
          s.shop_name,
          s.owner_name,
          s.phone_number           AS shop_phone,
          b.customer_name,
          b.customer_mobile,
          NULL::text               AS device_brand,
          NULL::text               AS device_model,
          NULL::text               AS imei1,
          NULL::text               AS storage,
          b.grand_total            AS amount,
          b.payment_method,
          b.bill_number,
          NULL::text               AS plan_id,
          NULL::integer            AS price_paid
        FROM bills b
        JOIN shops s ON s.id = b.shop_id
      `);
    }

    if (type === 'all' || type === 'premium') {
      parts.push(`
        SELECT
          a.id,
          'premium'                AS activity_type,
          a.plan_id                AS sub_type,
          a.activated_at           AS activity_at,
          s.shop_name,
          s.owner_name,
          s.phone_number           AS shop_phone,
          s.owner_name             AS customer_name,
          s.phone_number           AS customer_mobile,
          NULL::text               AS device_brand,
          NULL::text               AS device_model,
          NULL::text               AS imei1,
          NULL::text               AS storage,
          a.price_paid             AS amount,
          'Premium'                AS payment_method,
          NULL::text               AS bill_number,
          a.plan_id,
          a.price_paid
        FROM shop_plan_activations a
        JOIN shops s ON s.id = a.shop_id
      `);
    }

    if (parts.length === 0) return res.json({ success: true, data: [] });

    const unionQuery = `
      SELECT * FROM (${parts.join(' UNION ALL ')}) combined
      ORDER BY activity_at DESC
      LIMIT ${limit}
    `;

    const result = await query(unionQuery);
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error('Activity feed error:', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/revenue-dashboard/subscriptions
 * Individual premium subscription records with shop details — paginated.
 */
router.get('/revenue-dashboard/subscriptions', async (req, res) => {
  const { page = 1, limit = 25, search, planId, from, to } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const conditions = [];
  const params = [];
  let idx = 1;

  if (search) {
    conditions.push(`(s.shop_name ILIKE $${idx} OR s.owner_name ILIKE $${idx} OR s.phone_number ILIKE $${idx})`);
    params.push(`%${search.trim()}%`);
    idx++;
  }
  if (planId) {
    conditions.push(`a.plan_id = $${idx++}`);
    params.push(planId);
  }
  if (from) {
    conditions.push(`a.activated_at >= $${idx++}`);
    params.push(new Date(from).toISOString());
  }
  if (to) {
    conditions.push(`a.activated_at <= $${idx++}`);
    params.push(new Date(to).toISOString());
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [rowsRes, countRes] = await Promise.all([
      query(
        `SELECT a.id, a.plan_id, a.price_paid, a.activated_at, a.expires_at,
                s.shop_name, s.owner_name, s.phone_number, s.district
         FROM shop_plan_activations a
         JOIN shops s ON s.id = a.shop_id
         ${where}
         ORDER BY a.activated_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, parseInt(limit, 10), offset]
      ),
      query(
        `SELECT COUNT(*) AS total FROM shop_plan_activations a JOIN shops s ON s.id = a.shop_id ${where}`,
        params
      ),
    ]);

    return paginate(res, rowsRes.rows, parseInt(countRes.rows[0].total, 10), parseInt(page, 10), parseInt(limit, 10));
  } catch (err) {
    logger.error('Revenue subscriptions error:', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/v2/admin/revenue-dashboard/subscriptions/:id
 * Delete a premium subscription activation record (to clean up test data).
 */
router.delete('/revenue-dashboard/subscriptions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM shop_plan_activations WHERE id = $1 RETURNING shop_id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Subscription record not found' });
    }
    
    const shopId = result.rows[0].shop_id;
    
    // Find next latest activation expires date for shop
    const latestRes = await query(
      `SELECT expires_at FROM shop_plan_activations 
       WHERE shop_id = $1 
       ORDER BY expires_at DESC LIMIT 1`,
      [shopId]
    );
    
    const newExpiry = latestRes.rows.length > 0 ? latestRes.rows[0].expires_at : null;
    await query(
      `UPDATE user_features SET premium_expires_at = $1 WHERE shop_id = $2`,
      [newExpiry, shopId]
    );
    
    logger.info('Deleted premium subscription activation record', { id, shopId, newExpiry });
    return success(res, null, 'Subscription record deleted successfully');
  } catch (err) {
    logger.error('Failed to delete premium subscription record:', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});


/**
 * GET /api/v2/admin/shops
 * List all registered shops, with their feature flags merged.
 */
router.get('/shops', async (req, res) => {
  const { page = 1, limit = 50, search, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  let conditions = ['s.is_active = TRUE'];
  const params = [];
  let idx = 1;

  if (search && search.trim()) {
    conditions.push(`(s.shop_name ILIKE $${idx} OR s.owner_name ILIKE $${idx} OR s.phone_number ILIKE $${idx})`);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  // Safe mapping of sort fields to prevent SQL injection
  const allowedSortFields = {
    shop_name: 's.shop_name',
    owner_name: 's.owner_name',
    phone_number: 's.phone_number',
    district: 's.district',
    created_at: 's.created_at',
    free_entries_used: 'COALESCE(uf.free_entries_used, 0)',
    free_entries_limit: 'COALESCE(uf.free_entries_limit, 3)'
  };

  const safeSortBy = allowedSortFields[sortBy] || 's.created_at';
  const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const [rowsRes, countRes] = await Promise.all([
    query(
      `SELECT s.id, s.shop_name, s.owner_name, s.phone_number, s.district,
              s.gst_number, s.has_cctv, s.created_at, s.updated_at,
              COALESCE(uf.can_sell, false)     AS "canSell",
              COALESCE(uf.can_purchase, false) AS "canPurchase",
              COALESCE(uf.can_repair, false)   AS "canRepair",
              COALESCE(uf.can_reports, false)  AS "canReports",
              COALESCE(uf.free_entries_limit, 10) AS "freeEntriesLimit",
              COALESCE(uf.free_entries_used, 0) AS "freeEntriesUsed",
              uf.premium_expires_at            AS "premiumExpiresAt",
              COALESCE(uf.free_days_limit, 30)  AS "freeDaysLimit"
       FROM shops s
       LEFT JOIN user_features uf ON uf.shop_id = s.id
       WHERE ${where}
       ORDER BY ${safeSortBy} ${safeSortOrder}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    ),
    query(`SELECT COUNT(*) AS total FROM shops s WHERE ${where}`, params),
  ]);

  return paginate(res, rowsRes.rows, parseInt(countRes.rows[0].total, 10), parseInt(page, 10), parseInt(limit, 10));
});

router.get('/shops/multiple-devices', async (req, res) => {
  const multipleOnly = req.query.multipleOnly !== 'false';
  const minCount = multipleOnly ? 2 : 1;
  try {
    const result = await query(`
      SELECT 
        s.id AS shop_id,
        s.shop_name,
        s.owner_name,
        s.phone_number,
        COUNT(sd.device_id) AS unique_devices_count,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'device_id', sd.device_id,
            'device_name', sd.device_name,
            'os_version', sd.os_version,
            'app_version', sd.app_version,
            'login_count', sd.login_count,
            'last_login_at', sd.last_login_at
          ) ORDER BY sd.last_login_at DESC
        ) AS devices
      FROM shops s
      JOIN shop_devices sd ON sd.shop_id = s.id
      WHERE s.is_active = TRUE
      GROUP BY s.id, s.shop_name, s.owner_name, s.phone_number
      HAVING COUNT(sd.device_id) >= $1
      ORDER BY unique_devices_count DESC
    `, [minCount]);
    
    return success(res, result.rows);
  } catch (err) {
    logger.error('Failed to query shops with multiple devices:', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/shops/:shopId/devices
 * List all login devices recorded for a specific shop.
 */
router.get('/shops/:shopId/devices', async (req, res) => {
  const { shopId } = req.params;
  try {
    const result = await query(
      `SELECT * FROM shop_devices WHERE shop_id = $1 ORDER BY last_login_at DESC`,
      [shopId]
    );
    return success(res, result.rows);
  } catch (err) {
    logger.error('Failed to query devices for shop:', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/shops/:shopId/features
 * Set feature flags for a specific shop.
 */
router.post('/shops/:shopId/features', async (req, res) => {
  const { shopId } = req.params;
  const { 
    canSell, 
    canPurchase, 
    canRepair, 
    canReports, 
    freeEntriesLimit, 
    freeEntriesUsed,
    premiumExpiresAt,
    freeDaysLimit,
    planId
  } = req.body;

  // Verify shop exists
  const shopCheck = await query(`SELECT id FROM shops WHERE id = $1`, [shopId]);
  if (shopCheck.rows.length === 0) {
    return res.status(404).json({ success: false, error: `Shop not found: ${shopId}` });
  }

  const sell = typeof canSell === 'boolean' ? canSell : false;
  const purchase = typeof canPurchase === 'boolean' ? canPurchase : false;
  const repair = typeof canRepair === 'boolean' ? canRepair : false;
  const reports = typeof canReports === 'boolean' ? canReports : false;
  const limit = typeof freeEntriesLimit === 'number' ? freeEntriesLimit : 10;
  const used  = typeof freeEntriesUsed  === 'number' ? freeEntriesUsed  : 0;

  const premExpires = premiumExpiresAt ? new Date(premiumExpiresAt) : null;
  const daysLimit = typeof freeDaysLimit === 'number' ? freeDaysLimit : 30;

  await query(
    `INSERT INTO user_features (shop_id, can_sell, can_purchase, can_repair, can_reports, free_entries_limit, free_entries_used, premium_expires_at, free_days_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (shop_id) DO UPDATE SET
       can_sell            = EXCLUDED.can_sell,
       can_purchase        = EXCLUDED.can_purchase,
       can_repair          = EXCLUDED.can_repair,
       can_reports         = EXCLUDED.can_reports,
       free_entries_limit  = EXCLUDED.free_entries_limit,
       free_entries_used   = EXCLUDED.free_entries_used,
       premium_expires_at  = EXCLUDED.premium_expires_at,
       free_days_limit     = EXCLUDED.free_days_limit,
       updated_at          = NOW()`,
    [shopId, sell, purchase, repair, reports, limit, used, premExpires, daysLimit]
  );

  // Log plan activation in history
  if (premExpires && premExpires > new Date()) {
    let pricePaid = 0;
    let selectedPlanId = planId || null;
    if (selectedPlanId && selectedPlanId !== 'custom') {
      const planRes = await query('SELECT price FROM premium_plans WHERE id = $1', [selectedPlanId]);
      if (planRes.rows.length > 0) {
        pricePaid = planRes.rows[0].price;
      }
    } else {
      selectedPlanId = null;
    }
    try {
      await query(
        `INSERT INTO shop_plan_activations (shop_id, plan_id, price_paid, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [shopId, selectedPlanId, pricePaid, premExpires]
      );
      logger.info('Logged premium activation', { shopId, planId: selectedPlanId, pricePaid, expiresAt: premExpires });
    } catch (err) {
      logger.error('Failed to log premium activation history', { error: err.message });
    }
  }

  logger.info('V2 Feature flags updated', { shopId, canSell: sell, canPurchase: purchase, canRepair: repair, canReports: reports, freeEntriesLimit: limit, freeEntriesUsed: used, premiumExpiresAt: premExpires, freeDaysLimit: daysLimit });
  return success(res, { shopId, canSell: sell, canPurchase: purchase, canRepair: repair, canReports: reports, freeEntriesLimit: limit, freeEntriesUsed: used, premiumExpiresAt: premExpires, freeDaysLimit: daysLimit }, 'Features updated');
});

/**
 * GET /api/v2/admin/shops/:shopId/transactions
 * All transactions for a specific shop.
 */
router.get('/shops/:shopId/transactions', async (req, res) => {
  const { shopId } = req.params;
  const { page = 1, limit = 50, type, from, to } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const conditions = ['t.shop_id = $1'];
  const params = [shopId];
  let idx = 2;

  if (type && ['Sale', 'Purchase', 'Repair'].includes(type)) {
    conditions.push(`t.txn_type = $${idx++}`);
    params.push(type);
  }
  if (from) { conditions.push(`t.txn_date >= $${idx++}`); params.push(new Date(from).toISOString()); }
  if (to)   { conditions.push(`t.txn_date <= $${idx++}`); params.push(new Date(to).toISOString()); }

  const where = conditions.join(' AND ');

  const [rowsRes, countRes] = await Promise.all([
    query(
      `SELECT t.id, t.txn_type, t.amount, t.payment_method, t.remarks, t.txn_date,
              d.brand, d.model, d.imei1, d.storage, d.color,
              c.full_name AS customer_name, c.mobile AS customer_mobile
       FROM transactions t
       JOIN devices d   ON d.id = t.device_id
       JOIN customers c ON c.id = t.customer_id
       WHERE ${where}
       ORDER BY t.txn_date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    ),
    query(`SELECT COUNT(*) AS total FROM transactions t WHERE ${where}`, params),
  ]);

  return paginate(res, rowsRes.rows, parseInt(countRes.rows[0].total, 10), parseInt(page, 10), parseInt(limit, 10));
});

/**
 * GET /api/v2/admin/transactions/:txnId
 * Full details for a single transaction — device, customer, media documents.
 */
router.get('/transactions/:txnId', async (req, res) => {
  const { txnId } = req.params;
  try {
    const [txnRes, mediaRes] = await Promise.all([
      query(
        `SELECT
          t.id, t.android_txn_id, t.txn_type, t.amount, t.payment_method,
          t.remarks, t.purpose, t.bill_number, t.txn_date, t.created_at,
          d.id AS device_id, d.imei1, d.imei2, d.brand, d.model,
          d.storage, d.color, d.condition_label,
          c.id AS customer_id, c.full_name AS customer_name,
          c.mobile AS customer_mobile, c.address, c.state, c.district,
          c.pin_code, c.aadhaar_number, c.gstin
         FROM transactions t
         JOIN devices d   ON d.id = t.device_id
         JOIN customers c ON c.id = t.customer_id
         WHERE t.id = $1`,
        [txnId]
      ),
      query(
        `SELECT id, file_name, firebase_url, file_path, mime_type, file_size_bytes, category, created_at
         FROM transaction_media
         WHERE transaction_id = $1
         ORDER BY created_at ASC`,
        [txnId]
      ),
    ]);

    if (txnRes.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    return res.json({
      success: true,
      data: {
        transaction: txnRes.rows[0],
        media: mediaRes.rows,
      },
    });
  } catch (err) {
    console.error('Admin txn detail error:', err);
    return res.status(500).json({ error: 'Failed to load transaction details' });
  }
});

/**
 * GET /api/v2/admin/diagnostics
 * Health checks, DB latency, storage details and server logs viewer.
 */
router.get('/diagnostics', async (req, res) => {
  try {
    // 1. DB Latency check
    const startDb = Date.now();
    await query('SELECT NOW()');
    const dbLatency = Date.now() - startDb;

    // Count tables
    const tableCountRes = await query(
      `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const tableCount = parseInt(tableCountRes.rows[0].count, 10);

    // 2. Sync Logs health metrics in last 24h
    const [syncTotalRes, syncFailedRes, syncConflictRes] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM sync_log WHERE synced_at >= NOW() - INTERVAL '24 hours'`),
      query(`SELECT COUNT(*) AS total FROM sync_log WHERE sync_status = 'failed' AND synced_at >= NOW() - INTERVAL '24 hours'`),
      query(`SELECT COUNT(*) AS total FROM sync_log WHERE sync_status = 'conflict' AND synced_at >= NOW() - INTERVAL '24 hours'`),
    ]);

    const syncMetrics = {
      totalLast24h: parseInt(syncTotalRes.rows[0].total, 10),
      failedLast24h: parseInt(syncFailedRes.rows[0].total, 10),
      conflictLast24h: parseInt(syncConflictRes.rows[0].total, 10),
    };

    // 3. Storage check: uploads file count
    let fileCount = 0;
    let storageError = null;
    const uploadsDir = path.join(__dirname, '../../uploads'); // root uploads folder
    try {
      if (fs.existsSync(uploadsDir)) {
        const files = await fs.promises.readdir(uploadsDir);
        // filter out directories
        let count = 0;
        for (const file of files) {
          const stats = fs.statSync(path.join(uploadsDir, file));
          if (!stats.isDirectory()) {
            count++;
          }
        }
        fileCount = count;
      }
    } catch (err) {
      storageError = err.message;
    }

    // 4. Read logs
    const errorLogPath = path.join(__dirname, '../../logs/error.log');
    const combinedLogPath = path.join(__dirname, '../../logs/combined.log');

    const readLastLines = async (filePath, linesCount = 50) => {
      try {
        if (!fs.existsSync(filePath)) return `[Log file does not exist yet: ${path.basename(filePath)}]`;
        const data = await fs.promises.readFile(filePath, 'utf8');
        const lines = data.trim().split('\n');
        return lines.slice(-linesCount).join('\n');
      } catch (err) {
        return `[Error reading log file: ${err.message}]`;
      }
    };

    const errorLogs = await readLastLines(errorLogPath, 50);
    const combinedLogs = await readLastLines(combinedLogPath, 50);

    return success(res, {
      health: {
        database: 'connected',
        dbLatencyMs: dbLatency,
        tableCount: tableCount,
        syncMetrics: syncMetrics,
        storage: {
          fileCount: fileCount,
          error: storageError,
        },
      },
      logs: {
        error: errorLogs,
        combined: combinedLogs,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Diagnostics check failed', { error: err.message });
    return res.status(500).json({ success: false, error: 'Diagnostics failed: ' + err.message });
  }
});

/**
 * GET /api/v2/admin/maintenance
 * Get current system maintenance mode state.
 */
router.get('/maintenance', async (req, res) => {
  const mode = await getMaintenanceMode();
  return success(res, { maintenanceMode: mode });
});

/**
 * POST /api/v2/admin/maintenance
 * Toggle system maintenance mode state.
 */
router.post('/maintenance', async (req, res) => {
  const { maintenanceMode } = req.body;
  if (typeof maintenanceMode !== 'boolean') {
    return res.status(400).json({ success: false, error: 'maintenanceMode must be a boolean' });
  }

  await setMaintenanceMode(maintenanceMode);
  return success(res, { maintenanceMode }, `Maintenance mode turned ${maintenanceMode ? 'ON' : 'OFF'}`);
});

/**
 * GET /api/v2/admin/config
 * Get all app_config key-value pairs.
 */
router.get('/config', async (req, res) => {
  try {
    const result = await query('SELECT key, value FROM app_config ORDER BY key ASC');
    const config = {};
    result.rows.forEach(r => { config[r.key] = r.value; });
    return success(res, config);
  } catch (err) {
    logger.error('Failed to get app_config', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/config
 * Update or insert an app_config key-value pair.
 */
router.post('/config', async (req, res) => {
  const { key, value } = req.body;
  if (!key || typeof value !== 'string') {
    return res.status(400).json({ success: false, error: 'Valid key and value required' });
  }

  try {
    await query(
      `INSERT INTO app_config (key, value, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
    logger.info('App config updated', { key, value });
    return success(res, { key, value }, 'Config saved');
  } catch (err) {
    logger.error('Failed to update app_config', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/plans
 * Retrieve all premium plans (active and inactive) for admin CRUD panel.
 */
router.get('/plans', async (req, res) => {
  try {
    const result = await query('SELECT * FROM premium_plans ORDER BY created_at DESC');
    return success(res, result.rows);
  } catch (err) {
    logger.error('Failed to get plans for admin', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/plans
 * Create or update a premium plan.
 */
router.post('/plans', async (req, res) => {
  const { id, skuId, name, nameHi, nameGu, price, currency, duration, unit, popular, isActive } = req.body;
  if (!id || !skuId || !name || price === undefined || duration === undefined) {
    return res.status(400).json({ success: false, error: 'id, skuId, name, price, and duration are required' });
  }

  try {
    await query(
      `INSERT INTO premium_plans (id, sku_id, name, name_hi, name_gu, price, currency, duration, unit, popular, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (id) DO UPDATE SET
         sku_id = EXCLUDED.sku_id,
         name = EXCLUDED.name,
         name_hi = EXCLUDED.name_hi,
         name_gu = EXCLUDED.name_gu,
         price = EXCLUDED.price,
         currency = EXCLUDED.currency,
         duration = EXCLUDED.duration,
         unit = EXCLUDED.unit,
         popular = EXCLUDED.popular,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
      [id, skuId, name, nameHi || '', nameGu || '', price, currency || '₹', duration, unit || 'months', popular || false, isActive !== false]
    );
    logger.info('Premium plan saved', { id, skuId, price });
    return success(res, { id }, 'Plan saved successfully');
  } catch (err) {
    logger.error('Failed to save premium plan', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/v2/admin/plans/:id
 * Remove a premium plan from database.
 */
const { admin } = require('../config/firebase');

router.delete('/plans/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await query('DELETE FROM premium_plans WHERE id = $1', [id]);
    logger.info('Premium plan deleted', { id });
    return success(res, null, 'Plan removed successfully');
  } catch (err) {
    logger.error('Failed to delete premium plan', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/plan-analytics
 * Plan activation statistics and shop list.
 */
router.get('/plan-analytics', async (req, res) => {
  const { year, month } = req.query;
  const targetYear = parseInt(year, 10) || new Date().getFullYear();
  const targetMonth = parseInt(month, 10) || (new Date().getMonth() + 1);

  try {
    const [newShopsRes, activationsRes, popularRes] = await Promise.all([
      query(
        `SELECT COUNT(*)::integer AS total FROM shops 
         WHERE EXTRACT(YEAR FROM created_at) = $1 AND EXTRACT(MONTH FROM created_at) = $2 AND is_active = TRUE`,
        [targetYear, targetMonth]
      ),
      query(
        `SELECT spa.id, s.shop_name AS "shopName", s.owner_name AS "ownerName", s.phone_number AS "phone", 
                COALESCE(p.name, 'Custom / Ad-Hoc') AS "planName", 
                spa.price_paid AS "pricePaid", spa.activated_at AS "activatedAt", spa.expires_at AS "expiresAt"
         FROM shop_plan_activations spa
         JOIN shops s ON s.id = spa.shop_id
         LEFT JOIN premium_plans p ON p.id = spa.plan_id
         WHERE EXTRACT(YEAR FROM spa.activated_at) = $1 AND EXTRACT(MONTH FROM spa.activated_at) = $2
         ORDER BY spa.activated_at DESC`,
        [targetYear, targetMonth]
      ),
      query(
        `SELECT COALESCE(p.name, 'Custom / Ad-Hoc') AS "planName",
                COUNT(*)::integer AS "count",
                COALESCE(SUM(spa.price_paid), 0)::integer AS "revenue"
         FROM shop_plan_activations spa
         LEFT JOIN premium_plans p ON p.id = spa.plan_id
         WHERE EXTRACT(YEAR FROM spa.activated_at) = $1 AND EXTRACT(MONTH FROM spa.activated_at) = $2
         GROUP BY p.name
         ORDER BY revenue DESC`,
        [targetYear, targetMonth]
      )
    ]);

    const newShopsCount = newShopsRes.rows[0]?.total || 0;
    const activations = activationsRes.rows;
    const popularity = popularRes.rows;

    const totalRevenue = popularity.reduce((sum, item) => sum + item.revenue, 0);
    const totalPremiumActivations = popularity.reduce((sum, item) => sum + item.count, 0);

    return success(res, {
      year: targetYear,
      month: targetMonth,
      newShopsCount,
      totalPremiumActivations,
      totalRevenue,
      popularity,
      activations
    });
  } catch (err) {
    logger.error('Failed to retrieve plan analytics', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/notifications/send
 * Send notification to targeted shop or all shops.
 */
router.post('/notifications/send', async (req, res) => {
  const { title, body, shopId } = req.body;
  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title and body are required' });
  }

  try {
    if (!admin.apps.length) {
      return res.status(500).json({ success: false, error: 'Firebase Admin SDK is not initialized. Please configure credentials in .env file.' });
    }

    let tokens = [];

    if (shopId && shopId !== 'all') {
      const shopRes = await query('SELECT fcm_token FROM shops WHERE id = $1', [shopId]);
      if (shopRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: `Shop not found: ${shopId}` });
      }
      const token = shopRes.rows[0].fcm_token;
      if (!token) {
        return res.status(400).json({ success: false, error: 'Target shop does not have a registered FCM token.' });
      }
      tokens.push(token);
    } else {
      const shopsRes = await query('SELECT fcm_token FROM shops WHERE fcm_token IS NOT NULL AND is_active = TRUE');
      tokens = shopsRes.rows.map(r => r.fcm_token);
    }

    if (tokens.length === 0) {
      return success(res, { successCount: 0, failureCount: 0 }, 'No active FCM tokens registered.');
    }

    let successCount = 0;
    let failureCount = 0;

    if (tokens.length === 1) {
      const message = {
        token: tokens[0],
        notification: { title, body },
        data: { click_action: "FLUTTER_NOTIFICATION_CLICK" }
      };
      await admin.messaging().send(message);
      successCount = 1;
    } else {
      const chunkSize = 500;
      for (let i = 0; i < tokens.length; i += chunkSize) {
        const chunk = tokens.slice(i, i + chunkSize);
        const message = {
          tokens: chunk,
          notification: { title, body }
        };
        const batchResponse = await admin.messaging().sendEachForMulticast(message);
        successCount += batchResponse.successCount;
        failureCount += batchResponse.failureCount;
      }
    }

    logger.info('Sent push notifications', { title, shopId, successCount, failureCount });
    return success(res, { successCount, failureCount }, 'Notifications sent successfully');
  } catch (err) {
    logger.error('Failed to send push notification', { error: err.message });
    return res.status(500).json({ success: false, error: `FCM Error: ${err.message}` });
  }
});

/**
 * GET /api/v2/admin/revenue-dashboard
 * Aggregated revenue stats and trend charts.
 */
router.get('/revenue-dashboard', async (req, res) => {
  const { month, year, from, to } = req.query;

  let conditions = [];
  const params = [];
  let idx = 1;

  if (from) {
    conditions.push(`activated_at >= $${idx++}`);
    params.push(new Date(from).toISOString());
  }
  if (to) {
    conditions.push(`activated_at <= $${idx++}`);
    params.push(new Date(to).toISOString());
  }
  if (month) {
    conditions.push(`EXTRACT(MONTH FROM activated_at) = $${idx++}`);
    params.push(parseInt(month, 10));
  }
  if (year) {
    conditions.push(`EXTRACT(YEAR FROM activated_at) = $${idx++}`);
    params.push(parseInt(year, 10));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // 1. Total revenue stats
    const todayRes = await query(`SELECT COALESCE(SUM(price_paid), 0) AS total FROM shop_plan_activations WHERE activated_at >= CURRENT_DATE`);
    const monthRes = await query(`SELECT COALESCE(SUM(price_paid), 0) AS total FROM shop_plan_activations WHERE DATE_TRUNC('month', activated_at) = DATE_TRUNC('month', CURRENT_DATE)`);
    const yearRes = await query(`SELECT COALESCE(SUM(price_paid), 0) AS total FROM shop_plan_activations WHERE DATE_TRUNC('year', activated_at) = DATE_TRUNC('year', CURRENT_DATE)`);
    const lifetimeRes = await query(`SELECT COALESCE(SUM(price_paid), 0) AS total FROM shop_plan_activations`);

    // 2. Plan breakdowns
    const breakdownRes = await query(`
      SELECT plan_id AS "planId", COUNT(*) AS count, COALESCE(SUM(price_paid), 0) AS revenue
      FROM shop_plan_activations
      GROUP BY plan_id
    `);

    // 3. Subscription counts
    const activeSubRes = await query(`SELECT COUNT(*) AS total FROM user_features WHERE premium_expires_at > NOW()`);
    const expiredSubRes = await query(`SELECT COUNT(*) AS total FROM user_features WHERE premium_expires_at <= NOW()`);

    // ARPU computation
    const premiumShopsRes = await query(`SELECT COUNT(DISTINCT shop_id) AS total FROM shop_plan_activations`);
    const premiumShopsCount = parseInt(premiumShopsRes.rows[0].total, 10) || 1;
    const arpu = Math.round(parseFloat(lifetimeRes.rows[0].total) / premiumShopsCount);

    // 4. Monthly Trend (for charts)
    const trendRes = await query(`
      SELECT TO_CHAR(activated_at, 'YYYY-MM') AS month, COALESCE(SUM(price_paid), 0) AS total, COUNT(*) AS volume
      FROM shop_plan_activations
      GROUP BY 1 ORDER BY 1 ASC
    `);

    // 5. Daily Trend (for detailed date range chart)
    const dailyRes = await query(`
      SELECT DATE_TRUNC('day', activated_at)::date::text AS date, COALESCE(SUM(price_paid), 0) AS total
      FROM shop_plan_activations
      ${where}
      GROUP BY 1 ORDER BY 1 ASC
      LIMIT 30
    `, params);

    return success(res, {
      revenue: {
        today: parseInt(todayRes.rows[0].total, 10),
        monthly: parseInt(monthRes.rows[0].total, 10),
        yearly: parseInt(yearRes.rows[0].total, 10),
        lifetime: parseInt(lifetimeRes.rows[0].total, 10),
      },
      breakdown: breakdownRes.rows,
      subscribers: {
        active: parseInt(activeSubRes.rows[0].total, 10),
        expired: parseInt(expiredSubRes.rows[0].total, 10),
        arpu: arpu
      },
      trends: {
        monthly: trendRes.rows,
        daily: dailyRes.rows
      }
    });
  } catch (err) {
    logger.error('Failed to load revenue dashboard metrics', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/revenue-dashboard/export
 * Export shop activations list to CSV.
 */
router.get('/revenue-dashboard/export', async (req, res) => {
  try {
    const activations = await query(`
      SELECT a.id, s.shop_name, s.owner_name, s.phone_number, a.plan_id, a.price_paid, a.activated_at, a.expires_at
      FROM shop_plan_activations a
      JOIN shops s ON s.id = a.shop_id
      ORDER BY a.activated_at DESC
    `);

    let csvContent = 'Activation ID,Shop Name,Owner Name,Phone Number,Plan ID,Price Paid,Activated At,Expires At\n';
    activations.rows.forEach(r => {
      csvContent += `"${r.id}","${r.shop_name.replace(/"/g, '""')}","${r.owner_name.replace(/"/g, '""')}","${r.phone_number}","${r.plan_id || 'Custom'}",${r.price_paid},"${r.activated_at.toISOString()}","${r.expires_at.toISOString()}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=revenue_report.csv');
    return res.status(200).send(csvContent);
  } catch (err) {
    logger.error('Failed to export CSV report', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/premium-users
 * Get list of premium shops with search, sorting, and stats.
 */
router.get('/premium-users', async (req, res) => {
  const { page = 1, limit = 50, search, planId, status } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  let conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (search && search.trim()) {
    conditions.push(`(s.shop_name ILIKE $${idx} OR s.owner_name ILIKE $${idx} OR s.phone_number ILIKE $${idx})`);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  if (planId) {
    conditions.push(`spa.plan_id = $${idx++}`);
    params.push(planId);
  }

  if (status === 'active') {
    conditions.push(`uf.premium_expires_at IS NOT NULL AND spa.expires_at > NOW()`);
  } else if (status === 'expired') {
    conditions.push(`uf.premium_expires_at IS NOT NULL AND spa.expires_at <= NOW()`);
  } else if (status === 'cancelled') {
    conditions.push(`uf.premium_expires_at IS NULL`);
  } else if (status === 'expiring_soon') {
    conditions.push(`uf.premium_expires_at IS NOT NULL AND spa.expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`);
  }

  const where = conditions.join(' AND ');

  try {
    // 1. Dashboard summary stats
    const totalRes = await query(`SELECT COUNT(DISTINCT shop_id) AS total FROM user_features uf WHERE uf.premium_expires_at IS NOT NULL OR EXISTS(SELECT 1 FROM shop_plan_activations spa WHERE spa.shop_id = uf.shop_id)`);
    const activeRes = await query(`SELECT COUNT(*) AS total FROM user_features WHERE premium_expires_at > NOW()`);
    const expiredRes = await query(`SELECT COUNT(*) AS total FROM user_features WHERE premium_expires_at <= NOW()`);
    const expiringRes = await query(`SELECT COUNT(*) AS total FROM user_features WHERE premium_expires_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'`);

    const p6mRes = await query(`
      SELECT COUNT(DISTINCT shop_id) AS total FROM shop_plan_activations WHERE plan_id = 'plan_6m'
    `);
    const p1yRes = await query(`
      SELECT COUNT(DISTINCT shop_id) AS total FROM shop_plan_activations WHERE plan_id = 'plan_1y'
    `);

    // 2. Fetch records
    const records = await query(`
      SELECT 
        spa.id AS "activationId",
        s.id AS "id",
        s.shop_name AS "shopName",
        s.owner_name AS "ownerName",
        s.phone_number AS "phoneNumber",
        s.active_device_id AS "deviceId",
        s.updated_at AS "lastActive",
        spa.plan_id AS "currentPlan",
        spa.activated_at AS "activatedAt",
        spa.expires_at AS "premiumExpiresAt",
        CEIL(EXTRACT(EPOCH FROM (spa.expires_at - NOW()))/86400)::integer AS "remainingDays",
        CASE
          WHEN uf.premium_expires_at IS NULL THEN 'cancelled'
          WHEN spa.expires_at <= NOW() THEN 'expired'
          ELSE 'active'
        END AS "status"
      FROM shop_plan_activations spa
      JOIN shops s ON s.id = spa.shop_id
      JOIN user_features uf ON uf.shop_id = s.id
      WHERE ${where}
      ORDER BY spa.activated_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, [...params, parseInt(limit, 10), offset]);

    const countRes = await query(`
      SELECT COUNT(*) AS total 
      FROM shop_plan_activations spa
      JOIN shops s ON s.id = spa.shop_id
      JOIN user_features uf ON uf.shop_id = s.id
      WHERE ${where}
    `, params);

    return success(res, {
      stats: {
        totalPremium: parseInt(totalRes.rows[0].total, 10),
        active: parseInt(activeRes.rows[0].total, 10),
        expired: parseInt(expiredRes.rows[0].total, 10),
        expiringSoon: parseInt(expiringRes.rows[0].total, 10),
        users6m: parseInt(p6mRes.rows[0].total, 10),
        users1y: parseInt(p1yRes.rows[0].total, 10)
      },
      pagination: {
        total: parseInt(countRes.rows[0].total, 10),
        page: parseInt(page, 10),
        limit: parseInt(limit, 10)
      },
      users: records.rows
    });
  } catch (err) {
    logger.error('Failed to query premium user listing', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/premium-users/:shopId/details
 * Fetch payment, device, and log history for a single premium user.
 */
router.get('/premium-users/:shopId/details', async (req, res) => {
  const { shopId } = req.params;

  try {
    const shopRes = await query('SELECT * FROM shops WHERE id = $1', [shopId]);
    if (shopRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Shop profile not found' });
    }

    const [payments, syncLogs] = await Promise.all([
      query('SELECT * FROM shop_plan_activations WHERE shop_id = $1 ORDER BY activated_at DESC', [shopId]),
      query('SELECT synced_at, entity_type, operation, sync_status, android_device_id FROM sync_log WHERE shop_id = $1 ORDER BY synced_at DESC LIMIT 50', [shopId])
    ]);

    return success(res, {
      profile: shopRes.rows[0],
      payments: payments.rows,
      logs: syncLogs.rows
    });
  } catch (err) {
    logger.error('Failed to load shop audit details', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/premium-users/:shopId/notification
 * Send custom notification directly to single premium shop.
 */
router.post('/premium-users/:shopId/notification', async (req, res) => {
  const { shopId } = req.params;
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title and body are required' });
  }

  try {
    const shopRes = await query('SELECT fcm_token FROM shops WHERE id = $1', [shopId]);
    if (shopRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Shop not found' });
    }

    const token = shopRes.rows[0].fcm_token;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Shop does not have a registered FCM token' });
    }

    const message = {
      token: token,
      notification: { title, body },
      data: { click_action: "FLUTTER_NOTIFICATION_CLICK" }
    };

    await admin.messaging().send(message);
    logger.info('Sent individual push notification to shop', { shopId, title });
    return success(res, null, 'Notification sent successfully');
  } catch (err) {
    logger.error('Failed to send individual push notification', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});


// ─── Special Offers (One Time Offer popup) ────────────────────────────────────

/**
 * GET /api/v2/admin/offers
 * List all special offers.
 */
router.get('/offers', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         id,
         is_active           AS "isActive",
         title,
         title_hi            AS "titleHi",
         title_gu            AS "titleGu",
         subtitle,
         subtitle_hi         AS "subtitleHi",
         subtitle_gu         AS "subtitleGu",
         discount_pct        AS "discountPct",
         plan_id             AS "planId",
         original_price      AS "originalPrice",
         offer_price         AS "offerPrice",
         currency,
         price_unit          AS "priceUnit",
         price_unit_hi       AS "priceUnitHi",
         price_unit_gu       AS "priceUnitGu",
         countdown_seconds   AS "countdownSeconds",
         bg_gradient_start   AS "bgGradientStart",
         bg_gradient_end     AS "bgGradientEnd",
         accent_color_start  AS "accentColorStart",
         accent_color_end    AS "accentColorEnd",
         created_at          AS "createdAt",
         updated_at          AS "updatedAt"
       FROM special_offers
       ORDER BY created_at DESC`
    );
    return success(res, result.rows);
  } catch (err) {
    logger.error('Failed to fetch special offers', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/offers
 * Create or update a special offer (upsert by id).
 * Body: { id, isActive, title, titleHi, titleGu, subtitle, subtitleHi, subtitleGu,
 *         discountPct, planId, originalPrice, offerPrice, currency, priceUnit, priceUnitHi, priceUnitGu,
 *         countdownSeconds, bgGradientStart, bgGradientEnd, accentColorStart, accentColorEnd }
 */
router.post('/offers', async (req, res) => {
  const {
    id = 'oto_main',
    isActive = false,
    title = 'One Time Offer',
    titleHi = 'एक बार का ऑफर',
    titleGu = 'એક વખત ઓફર',
    subtitle = 'Limited Time Offer',
    subtitleHi = 'सीमित समय ऑफर',
    subtitleGu = 'સીમિત સમય ઓફર',
    discountPct = 40,
    planId = null,
    originalPrice = 999,
    offerPrice = 599,
    currency = '₹',
    priceUnit = 'per year',
    priceUnitHi = 'प्रति वर्ष',
    priceUnitGu = 'દર વર્ષ',
    countdownSeconds = 600,
    bgGradientStart = '#0f0f1a',
    bgGradientEnd = '#1a0a2e',
    accentColorStart = '#FF6B6B',
    accentColorEnd = '#FF8E53',
  } = req.body;

  try {
    await query(
      `INSERT INTO special_offers (
         id, is_active, title, title_hi, title_gu,
         subtitle, subtitle_hi, subtitle_gu,
         discount_pct, plan_id,
         original_price, offer_price, currency, price_unit, price_unit_hi, price_unit_gu,
         countdown_seconds,
         bg_gradient_start, bg_gradient_end, accent_color_start, accent_color_end
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
       )
       ON CONFLICT (id) DO UPDATE SET
         is_active         = EXCLUDED.is_active,
         title             = EXCLUDED.title,
         title_hi          = EXCLUDED.title_hi,
         title_gu          = EXCLUDED.title_gu,
         subtitle          = EXCLUDED.subtitle,
         subtitle_hi       = EXCLUDED.subtitle_hi,
         subtitle_gu       = EXCLUDED.subtitle_gu,
         discount_pct      = EXCLUDED.discount_pct,
         plan_id           = EXCLUDED.plan_id,
         original_price    = EXCLUDED.original_price,
         offer_price       = EXCLUDED.offer_price,
         currency          = EXCLUDED.currency,
         price_unit        = EXCLUDED.price_unit,
         price_unit_hi     = EXCLUDED.price_unit_hi,
         price_unit_gu     = EXCLUDED.price_unit_gu,
         countdown_seconds = EXCLUDED.countdown_seconds,
         bg_gradient_start = EXCLUDED.bg_gradient_start,
         bg_gradient_end   = EXCLUDED.bg_gradient_end,
         accent_color_start= EXCLUDED.accent_color_start,
         accent_color_end  = EXCLUDED.accent_color_end,
         updated_at        = NOW()`,
      [
        id, isActive, title, titleHi, titleGu,
        subtitle, subtitleHi, subtitleGu,
        discountPct, planId || null,
        originalPrice, offerPrice, currency, priceUnit, priceUnitHi, priceUnitGu,
        countdownSeconds,
        bgGradientStart, bgGradientEnd, accentColorStart, accentColorEnd,
      ]
    );
    logger.info('Special offer upserted', { id, isActive });
    return success(res, { id }, `Offer '${id}' saved successfully`);
  } catch (err) {
    logger.error('Failed to save special offer', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/v2/admin/offers/:id/toggle
 * Toggle is_active for a special offer.
 */
router.patch('/offers/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query(
      `UPDATE special_offers
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING id, is_active AS "isActive"`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Offer '${id}' not found` });
    }
    const { isActive } = result.rows[0];
    logger.info('Special offer toggled', { id, isActive });
    return success(res, { id, isActive }, `Offer '${id}' is now ${isActive ? 'ACTIVE ✅' : 'INACTIVE ❌'}`);
  } catch (err) {
    logger.error('Failed to toggle special offer', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/v2/admin/offers/:id
 * Delete a special offer.
 */
router.delete('/offers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query(`DELETE FROM special_offers WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: `Offer '${id}' not found` });
    }
    logger.info('Special offer deleted', { id });
    return success(res, { id }, `Offer '${id}' deleted`);
  } catch (err) {
    logger.error('Failed to delete special offer', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v2/admin/catalog
 * Get full catalog of brands and models with database IDs.
 */
router.get('/catalog', async (req, res) => {
  try {
    const brandsRes = await query('SELECT * FROM catalog_brands ORDER BY name ASC');
    const modelsRes = await query('SELECT * FROM catalog_models ORDER BY name ASC');
    return success(res, {
      brands: brandsRes.rows,
      models: modelsRes.rows
    });
  } catch (err) {
    logger.error('Failed to fetch admin catalog', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/catalog/brands
 * Create a new brand.
 */
router.post('/catalog/brands', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Brand name is required' });
  }
  try {
    const result = await query(
      'INSERT INTO catalog_brands (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    logger.info('Brand created', { id: result.rows[0].id, name });
    return success(res, result.rows[0], 'Brand created successfully');
  } catch (err) {
    logger.error('Failed to create brand', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/v2/admin/catalog/brands/:id
 * Delete a brand (will cascade delete models).
 */
router.delete('/catalog/brands/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query(
      'DELETE FROM catalog_brands WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Brand not found' });
    }
    logger.info('Brand deleted', { id });
    return success(res, result.rows[0], 'Brand deleted successfully');
  } catch (err) {
    logger.error('Failed to delete brand', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v2/admin/catalog/models
 * Add a new model under a brand.
 */
router.post('/catalog/models', async (req, res) => {
  const { brandId, name } = req.body;
  if (!brandId || !name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Brand ID and model name are required' });
  }
  try {
    const result = await query(
      'INSERT INTO catalog_models (brand_id, name) VALUES ($1, $2) RETURNING *',
      [brandId, name.trim()]
    );
    logger.info('Model created', { id: result.rows[0].id, name });
    return success(res, result.rows[0], 'Model created successfully');
  } catch (err) {
    logger.error('Failed to create model', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/v2/admin/catalog/models/:id
 * Delete a model.
 */
router.delete('/catalog/models/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query(
      'DELETE FROM catalog_models WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Model not found' });
    }
    logger.info('Model deleted', { id });
    return success(res, result.rows[0], 'Model deleted successfully');
  } catch (err) {
    logger.error('Failed to delete model', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
