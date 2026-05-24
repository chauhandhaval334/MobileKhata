'use strict';

const { query, withTransaction } = require('../config/database');
const { success, created } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/v1/sync/push
 * Batch sync push from Android → Server.
 *
 * Android sends all locally created/modified records since last sync.
 * Server processes them idempotently (safe to retry).
 *
 * Body: {
 *   androidDeviceId: string,
 *   lastSyncMillis: number,
 *   transactions: [ ...AndroidRoomEntries ],
 * }
 *
 * Each transaction item maps to Android's MobileEntryEntity structure.
 */
const pushSync = async (req, res) => {
  const shopId = req.shop.id;
  const { androidDeviceId, transactions = [] } = req.body;

  if (transactions.length === 0) {
    return success(res, { synced: 0, skipped: 0, failed: 0 }, 'Nothing to sync');
  }

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const entry of transactions) {
    try {
      // Check dedup by androidTxnId
      const existing = await query(
        'SELECT id FROM transactions WHERE shop_id=$1 AND android_txn_id=$2',
        [shopId, entry.transactionId]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      await withTransaction(async (client) => {
        // Upsert device
        let deviceId;
        const existingDevice = await client.query(
          'SELECT id FROM devices WHERE shop_id=$1 AND imei1=$2 ORDER BY created_at DESC LIMIT 1',
          [shopId, entry.imei1]
        );

        if (existingDevice.rows.length > 0) {
          deviceId = existingDevice.rows[0].id;
          // Update device details in case they changed
          await client.query(
            `UPDATE devices SET brand=$1, model=$2, storage=$3, color=$4,
             condition_label=$5, imei2=$6, updated_at=NOW() WHERE id=$7`,
            [entry.brand, entry.model, entry.storage || '', entry.color || '',
             entry.condition || '', entry.imei2 || '', deviceId]
          );
        } else {
          const devRes = await client.query(
            `INSERT INTO devices (shop_id, imei1, imei2, brand, model, storage, color, condition_label)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [shopId, entry.imei1, entry.imei2 || '', entry.brand, entry.model,
             entry.storage || '', entry.color || '', entry.condition || '']
          );
          deviceId = devRes.rows[0].id;
        }

        // Upsert customer
        const custRes = await client.query(
          `INSERT INTO customers
             (shop_id, full_name, mobile, address, state, district, pin_code, aadhaar_number, gstin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (shop_id, mobile) DO UPDATE SET
             full_name      = EXCLUDED.full_name,
             address        = EXCLUDED.address,
             state          = EXCLUDED.state,
             district       = EXCLUDED.district,
             pin_code       = EXCLUDED.pin_code,
             aadhaar_number = CASE WHEN EXCLUDED.aadhaar_number != ''
                                   THEN EXCLUDED.aadhaar_number
                                   ELSE customers.aadhaar_number END,
             updated_at     = NOW()
           RETURNING id`,
          [shopId, entry.customerName, entry.customerMobile,
           entry.customerAddress || '', entry.customerState || '',
           entry.customerDistrict || '', entry.customerPinCode || '',
           entry.aadhaarNumber || '', entry.gstin || '']
        );
        const customerId = custRes.rows[0].id;

        // Insert transaction
        const txnDate = new Date(parseInt(entry.createdAtMillis, 10)).toISOString();
        const txnRes = await client.query(
          `INSERT INTO transactions
             (android_txn_id, shop_id, device_id, customer_id, txn_type,
              amount, payment_method, remarks, txn_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [entry.transactionId, shopId, deviceId, customerId,
           entry.transactionType, entry.amount,
           entry.paymentMethod || 'Cash', entry.remarks || '', txnDate]
        );

        // Insert timeline event
        await client.query(
          `INSERT INTO timeline_events
             (shop_id, transaction_id, device_id, imei1, imei2,
              event_type, title, value, event_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [shopId, txnRes.rows[0].id, deviceId, entry.imei1, entry.imei2 || '',
           entry.transactionType,
           `${entry.transactionType}: ${entry.brand} ${entry.model}`,
           `₹${entry.amount}`, txnDate]
        );

        // Log sync
        await client.query(
          `INSERT INTO sync_log
             (shop_id, android_device_id, entity_type, entity_id, android_id, operation, sync_status)
           VALUES ($1,$2,'transaction',$3,$4,'INSERT','success')`,
          [shopId, androidDeviceId || 'unknown', txnRes.rows[0].id, entry.transactionId]
        );
      });

      synced++;
    } catch (err) {
      failed++;
      errors.push({ androidTxnId: entry.transactionId, error: err.message });
      logger.error('Sync push failed for entry', {
        androidTxnId: entry.transactionId, error: err.message,
      });
    }
  }

  logger.info('Sync push completed', { shopId, synced, skipped, failed });

  return created(res, { synced, skipped, failed, errors }, 'Sync push completed');
};

/**
 * GET /api/v1/sync/pull
 * Pull all server-side transactions for this shop since lastSyncMillis.
 * Used when installing on a new device to restore data.
 *
 * Query params: since (millis timestamp)
 */
const pullSync = async (req, res) => {
  const shopId = req.shop.id;
  const { since } = req.query;

  const sinceDate = since
    ? new Date(parseInt(since, 10)).toISOString()
    : new Date(0).toISOString();

  const result = await query(
    `SELECT
       t.android_txn_id        AS "transactionId",
       t.txn_type               AS "transactionType",
       t.amount,
       t.payment_method         AS "paymentMethod",
       t.remarks,
       (EXTRACT(EPOCH FROM t.txn_date) * 1000)::BIGINT AS "createdAtMillis",
       d.brand, d.model, d.storage, d.color, d.imei1, d.imei2,
       d.condition_label        AS "condition",
       c.full_name              AS "customerName",
       c.mobile                 AS "customerMobile",
       c.address                AS "customerAddress",
       c.state                  AS "customerState",
       c.district               AS "customerDistrict",
       c.pin_code               AS "customerPinCode",
       c.aadhaar_number         AS "aadhaarNumber",
       c.gstin
     FROM transactions t
     JOIN devices   d ON d.id = t.device_id
     JOIN customers c ON c.id = t.customer_id
     WHERE t.shop_id = $1 AND t.created_at >= $2
     ORDER BY t.txn_date ASC`,
    [shopId, sinceDate]
  );

  return success(res, {
    transactions: result.rows,
    count: result.rows.length,
    pulledAt: new Date().toISOString(),
  });
};

module.exports = { pushSync, pullSync };
