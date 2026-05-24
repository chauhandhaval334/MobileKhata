'use strict';

const { query, withTransaction } = require('../config/database');
const { success, created, notFound, conflict, paginate } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/v1/transactions
 * Create a new transaction (Purchase or Sale).
 * Handles device upsert + customer upsert within a DB transaction.
 * Idempotent via android_txn_id dedup.
 */
const createTransaction = async (req, res) => {
  const shopId = req.shop.id;
  const {
    // Android transactionId for dedup
    androidTxnId,
    // Transaction
    txnType, amount, paymentMethod, remarks,
    txnDateMillis,
    // Device
    imei1, imei2, brand, model, storage, color, conditionLabel,
    // Customer
    customerName, customerMobile, customerAddress,
    customerState, customerDistrict, customerPinCode,
    gstin, aadhaarNumber,
  } = req.body;

  // Check for duplicate sync
  if (androidTxnId) {
    const existing = await query(
      'SELECT id FROM transactions WHERE shop_id=$1 AND android_txn_id=$2',
      [shopId, androidTxnId]
    );
    if (existing.rows.length > 0) {
      return conflict(res, 'Transaction already synced', 'ALREADY_SYNCED');
    }
  }

  const result = await withTransaction(async (client) => {
    // 1. Upsert device (imei1 + shop_id identifies a device lineage)
    const deviceRes = await client.query(
      `INSERT INTO devices (shop_id, imei1, imei2, brand, model, storage, color, condition_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [shopId, imei1, imei2 || '', brand, model, storage || '', color || '', conditionLabel || '']
    );

    let deviceId;
    if (deviceRes.rows.length > 0) {
      deviceId = deviceRes.rows[0].id;
    } else {
      // Device exists — get latest device row for this IMEI
      const existingDevice = await client.query(
        `SELECT id FROM devices WHERE shop_id=$1 AND imei1=$2 ORDER BY created_at DESC LIMIT 1`,
        [shopId, imei1]
      );
      deviceId = existingDevice.rows[0]?.id;
    }

    if (!deviceId) throw new Error('Failed to resolve device ID');

    // 2. Upsert customer (mobile + shop_id)
    const customerRes = await client.query(
      `INSERT INTO customers
         (shop_id, full_name, mobile, address, state, district, pin_code, aadhaar_number, gstin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (shop_id, mobile)
       DO UPDATE SET
         full_name      = EXCLUDED.full_name,
         address        = EXCLUDED.address,
         state          = EXCLUDED.state,
         district       = EXCLUDED.district,
         pin_code       = EXCLUDED.pin_code,
         aadhaar_number = CASE WHEN EXCLUDED.aadhaar_number != '' THEN EXCLUDED.aadhaar_number
                               ELSE customers.aadhaar_number END,
         gstin          = CASE WHEN EXCLUDED.gstin != '' THEN EXCLUDED.gstin
                               ELSE customers.gstin END,
         updated_at     = NOW()
       RETURNING id`,
      [shopId, customerName, customerMobile, customerAddress || '',
       customerState || '', customerDistrict || '', customerPinCode || '',
       aadhaarNumber || '', gstin || '']
    );
    const customerId = customerRes.rows[0].id;

    // 3. Insert transaction
    const txnDate = txnDateMillis
      ? new Date(parseInt(txnDateMillis, 10)).toISOString()
      : new Date().toISOString();

    const txnRes = await client.query(
      `INSERT INTO transactions
         (android_txn_id, shop_id, device_id, customer_id, txn_type,
          amount, payment_method, remarks, txn_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [androidTxnId || null, shopId, deviceId, customerId,
       txnType, amount, paymentMethod || 'Cash', remarks || '', txnDate]
    );
    const txn = txnRes.rows[0];

    // 4. Insert timeline event
    await client.query(
      `INSERT INTO timeline_events
         (shop_id, transaction_id, device_id, imei1, imei2, event_type, title, value, event_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [shopId, txn.id, deviceId, imei1, imei2 || '',
       txnType,
       `${txnType}: ${brand} ${model}`,
       `₹${amount}`,
       txnDate]
    );

    return { txn, deviceId, customerId };
  });

  logger.info('Transaction created', {
    txnId: result.txn.id, shopId, type: txnType, amount,
  });

  return created(res, {
    transactionId:  result.txn.id,
    deviceId:       result.deviceId,
    customerId:     result.customerId,
    androidTxnId,
  }, `${txnType} transaction recorded`);
};

/**
 * GET /api/v1/transactions
 * List transactions for the shop with pagination, filtering by type and date range.
 */
const listTransactions = async (req, res) => {
  const shopId = req.shop.id;
  const {
    type,       // 'Sale' | 'Purchase'
    from,       // ISO date string
    to,         // ISO date string
    page = 1,
    limit = 20,
  } = req.query;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const params = [shopId];
  const conditions = ['t.shop_id = $1'];
  let paramIndex = 2;

  if (type && ['Sale', 'Purchase'].includes(type)) {
    conditions.push(`t.txn_type = $${paramIndex++}`);
    params.push(type);
  }
  if (from) {
    conditions.push(`t.txn_date >= $${paramIndex++}`);
    params.push(new Date(from).toISOString());
  }
  if (to) {
    conditions.push(`t.txn_date <= $${paramIndex++}`);
    params.push(new Date(to).toISOString());
  }

  const whereClause = conditions.join(' AND ');

  const [rowsRes, countRes] = await Promise.all([
    query(
      `SELECT
         t.id, t.android_txn_id, t.txn_type, t.amount, t.payment_method,
         t.remarks, t.txn_date,
         d.brand, d.model, d.storage, d.color, d.imei1, d.imei2, d.condition_label,
         c.full_name AS customer_name, c.mobile AS customer_mobile,
         c.aadhaar_number, c.district AS customer_district
       FROM transactions t
       JOIN devices   d ON d.id = t.device_id
       JOIN customers c ON c.id = t.customer_id
       WHERE ${whereClause}
       ORDER BY t.txn_date DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit, 10), offset]
    ),
    query(
      `SELECT COUNT(*) AS total FROM transactions t WHERE ${whereClause}`,
      params
    ),
  ]);

  const total = parseInt(countRes.rows[0].total, 10);
  return paginate(res, rowsRes.rows, total, parseInt(page, 10), parseInt(limit, 10));
};

/**
 * GET /api/v1/transactions/:id
 * Get a single transaction with full detail including media.
 */
const getTransaction = async (req, res) => {
  const shopId = req.shop.id;
  const { id } = req.params;

  const txnRes = await query(
    `SELECT
       t.*,
       d.brand, d.model, d.storage, d.color, d.imei1, d.imei2, d.condition_label,
       c.full_name AS customer_name, c.mobile AS customer_mobile,
       c.address AS customer_address, c.state AS customer_state,
       c.district AS customer_district, c.pin_code AS customer_pin_code,
       c.aadhaar_number, c.gstin
     FROM transactions t
     JOIN devices   d ON d.id = t.device_id
     JOIN customers c ON c.id = t.customer_id
     WHERE t.id = $1 AND t.shop_id = $2`,
    [id, shopId]
  );

  if (txnRes.rows.length === 0) {
    return notFound(res, 'Transaction not found');
  }

  const mediaRes = await query(
    'SELECT id, file_name, category, mime_type, file_size_bytes, created_at FROM transaction_media WHERE transaction_id=$1',
    [id]
  );

  return success(res, { ...txnRes.rows[0], media: mediaRes.rows });
};

/**
 * GET /api/v1/transactions/imei/:imei
 * Full IMEI lifecycle — all transactions for this IMEI across time.
 */
const getImeiHistory = async (req, res) => {
  const shopId = req.shop.id;
  const { imei } = req.params;

  const result = await query(
    `SELECT * FROM imei_lifecycle
     WHERE (imei1 = $1 OR imei2 = $1) AND shop_id = $2
     ORDER BY txn_date ASC`,
    [imei, shopId]
  );

  return success(res, result.rows);
};

module.exports = { createTransaction, listTransactions, getTransaction, getImeiHistory };
