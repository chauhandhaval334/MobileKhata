'use strict';

const { query, withTransaction } = require('../config/database');
const { success, created, forbidden } = require('../utils/response');
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

  // ── Server-side feature gate ──────────────────────────────────────────────
  // Fetch this shop's feature flags. If no row → free tier defaults.
  const featResult = await query(
    `SELECT can_sell, can_purchase, can_repair, can_reports, free_entries_limit, free_entries_used
     FROM user_features WHERE shop_id = $1`,
    [shopId]
  );
  const flags = featResult.rows[0] || {
    can_sell: false, can_purchase: false, can_repair: false, can_reports: false,
    free_entries_limit: 3, free_entries_used: 0,
  };

  const isPremium = flags.can_sell || flags.can_purchase || flags.can_repair;

  // Free tier limit: only count truly NEW entries (not already synced ones)
  if (!isPremium) {
    const androidIds = transactions.map(t => t.transactionId);
    const alreadySynced = await query(
      `SELECT android_txn_id FROM transactions WHERE shop_id = $1 AND android_txn_id = ANY($2)`,
      [shopId, androidIds]
    );
    const alreadySyncedIds = new Set(alreadySynced.rows.map(r => r.android_txn_id));
    const trulyNewCount = transactions.filter(t => !alreadySyncedIds.has(t.transactionId)).length;

    const existingCount = await query(
      `SELECT COUNT(*) FROM transactions WHERE shop_id = $1`, [shopId]
    );
    const currentTotal = parseInt(existingCount.rows[0].count, 10);

    if (trulyNewCount > 0 && currentTotal + trulyNewCount > flags.free_entries_limit) {
      return forbidden(
        res,
        `Free plan allows only ${flags.free_entries_limit} entries. You have ${currentTotal} synced entries. Upgrade to premium.`,
        'FREE_LIMIT_EXCEEDED'
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

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
        const imei1Val = (entry.imei1 || '').trim();
        const imei2Val = (entry.imei2 || '').trim();

        const existingDevice = await client.query(
          'SELECT id FROM devices WHERE shop_id=$1 AND imei1=$2 ORDER BY created_at DESC LIMIT 1',
          [shopId, imei1Val]
        );

        if (existingDevice.rows.length > 0) {
          deviceId = existingDevice.rows[0].id;
          // Update device details in case they changed
          await client.query(
            `UPDATE devices SET brand=$1, model=$2, storage=$3, color=$4,
             condition_label=$5, imei2=$6, updated_at=NOW() WHERE id=$7`,
            [entry.brand, entry.model, entry.storage || '', entry.color || '',
             entry.condition || '', imei2Val, deviceId]
          );
        } else {
          const devRes = await client.query(
            `INSERT INTO devices (shop_id, imei1, imei2, brand, model, storage, color, condition_label)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [shopId, imei1Val, imei2Val, entry.brand, entry.model,
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
              amount, payment_method, remarks, purpose, bill_number, txn_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [entry.transactionId, shopId, deviceId, customerId,
           entry.transactionType, entry.amount,
           entry.paymentMethod || 'Cash', entry.remarks || '',
           entry.purpose || '', entry.billNumber || '', txnDate]
        );

        // Insert timeline event
        await client.query(
          `INSERT INTO timeline_events
             (shop_id, transaction_id, device_id, imei1, imei2,
              event_type, title, value, event_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [shopId, txnRes.rows[0].id, deviceId, imei1Val, imei2Val,
           entry.transactionType,
           `${entry.transactionType}: ${entry.brand} ${entry.model}`,
           `₹${entry.amount}`, txnDate]
        );

        // Save media URLs (Firebase Storage URLs sent from Android)
        const mediaItems = [
          ...(entry.mediaUris        || []).map(url => ({ url, category: 'device_image' })),
          ...(entry.invoiceUris      || []).map(url => ({ url, category: 'invoice' })),
          ...(entry.billUris         || []).map(url => ({ url, category: 'bill' })),
          ...(entry.warrantyUris     || []).map(url => ({ url, category: 'warranty' })),
          ...(entry.otherDocUris     || []).map(url => ({ url, category: 'other' })),
          ...(entry.aadhaarFrontUri  ? [{ url: entry.aadhaarFrontUri,  category: 'aadhaar_front'   }] : []),
          ...(entry.aadhaarBackUri   ? [{ url: entry.aadhaarBackUri,   category: 'aadhaar_back'    }] : []),
          ...(entry.panUri           ? [{ url: entry.panUri,           category: 'pan'             }] : []),
          ...(entry.customerPhotoUri ? [{ url: entry.customerPhotoUri, category: 'customer_photo'  }] : []),
        ].filter(m => m.url && m.url.startsWith('https://'));

        for (const media of mediaItems) {
          await client.query(
            `INSERT INTO transaction_media (transaction_id, shop_id, firebase_url, category)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [txnRes.rows[0].id, shopId, media.url, media.category]
          );
        }

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

  // Update free_entries_used with actual server count (source of truth)
  const totalCount = await query(
    `SELECT COUNT(*) FROM transactions WHERE shop_id = $1`, [shopId]
  );
  const totalNow = parseInt(totalCount.rows[0].count, 10);

  await query(
    `INSERT INTO user_features (shop_id, free_entries_used)
     VALUES ($1, $2)
     ON CONFLICT (shop_id) DO UPDATE SET
       free_entries_used = $2,
       updated_at = NOW()`,
    [shopId, totalNow]
  );

  return created(res, { synced, skipped, failed, errors, freeEntriesUsed: totalNow }, 'Sync push completed');
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
       t.purpose,
       t.bill_number            AS "billNumber",
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

  // Fetch media for all pulled transactions
  const txnIds = result.rows.map(r => r.transactionId).filter(Boolean);
  let mediaMap = {};
  if (txnIds.length > 0) {
    const mediaResult = await query(
      `SELECT tm.firebase_url AS "firebaseUrl", tm.category,
              t.android_txn_id AS "transactionId"
       FROM transaction_media tm
       JOIN transactions t ON t.id = tm.transaction_id
       WHERE t.shop_id = $1
         AND t.android_txn_id = ANY($2)
         AND tm.firebase_url != ''`,
      [shopId, txnIds]
    );
    for (const row of mediaResult.rows) {
      if (!mediaMap[row.transactionId]) mediaMap[row.transactionId] = [];
      mediaMap[row.transactionId].push({ firebaseUrl: row.firebaseUrl, category: row.category });
    }
  }

  // Attach media arrays to each transaction
  const transactions = result.rows.map(row => ({
    ...row,
    mediaUris:       (mediaMap[row.transactionId] || []).filter(m => m.category === 'device_image').map(m => m.firebaseUrl),
    invoiceUris:     (mediaMap[row.transactionId] || []).filter(m => m.category === 'invoice').map(m => m.firebaseUrl),
    billUris:        (mediaMap[row.transactionId] || []).filter(m => m.category === 'bill').map(m => m.firebaseUrl),
    warrantyUris:    (mediaMap[row.transactionId] || []).filter(m => m.category === 'warranty').map(m => m.firebaseUrl),
    otherDocUris:    (mediaMap[row.transactionId] || []).filter(m => m.category === 'other').map(m => m.firebaseUrl),
    aadhaarFrontUri: (mediaMap[row.transactionId] || []).find(m => m.category === 'aadhaar_front')?.firebaseUrl || '',
    aadhaarBackUri:  (mediaMap[row.transactionId] || []).find(m => m.category === 'aadhaar_back')?.firebaseUrl  || '',
    panUri:          (mediaMap[row.transactionId] || []).find(m => m.category === 'pan')?.firebaseUrl           || '',
    customerPhotoUri:(mediaMap[row.transactionId] || []).find(m => m.category === 'customer_photo')?.firebaseUrl|| '',
  }));

  return success(res, {
    transactions,
    count: transactions.length,
    pulledAt: new Date().toISOString(),
  });
};

module.exports = { pushSync, pullSync };
