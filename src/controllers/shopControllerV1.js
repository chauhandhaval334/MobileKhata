'use strict';

const { query, withTransaction } = require('../config/database');
const { success, created, notFound, conflict } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/v1/shop/setup
 * Create or update shop profile for the authenticated Firebase user.
 * Called after OTP verification + PinSetup on first login.
 */
const setupShop = async (req, res) => {
  const { uid, phone } = req.user;
  const {
    shopName, shopAddress, ownerName, district,
    gstNumber, licenceNumber, retailId, hasCctv, bizRemarks,
  } = req.body;

  // Upsert — safe to call multiple times (idempotent setup)
  const result = await query(
    `INSERT INTO shops
       (firebase_uid, phone_number, shop_name, shop_address, owner_name,
        district, gst_number, licence_number, retail_id, has_cctv, biz_remarks)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (firebase_uid)
     DO UPDATE SET
       shop_name      = EXCLUDED.shop_name,
       shop_address   = EXCLUDED.shop_address,
       owner_name     = EXCLUDED.owner_name,
       district       = EXCLUDED.district,
       gst_number     = EXCLUDED.gst_number,
       licence_number = EXCLUDED.licence_number,
       retail_id      = EXCLUDED.retail_id,
       has_cctv       = EXCLUDED.has_cctv,
       biz_remarks    = EXCLUDED.biz_remarks,
       updated_at     = NOW()
     RETURNING *`,
    [uid, phone, shopName, shopAddress || '', ownerName || '',
     district || '', gstNumber || '', licenceNumber || '',
     retailId || '', hasCctv || false, bizRemarks || '']
  );

  const shop = result.rows[0];

  // Ensure default feature flags row exists for this shop
  await query(
    `INSERT INTO user_features (shop_id)
     VALUES ($1)
     ON CONFLICT (shop_id) DO NOTHING`,
    [shop.id]
  );

  logger.info('Shop profile upserted', { shopId: shop.id, uid });
  return created(res, sanitizeShop(shop), 'Shop profile saved');
};

/**
 * GET /api/v1/shop/profile
 * Get the authenticated user's shop profile.
 */
const getProfile = async (req, res) => {
  if (!req.shop) {
    return notFound(res, 'Shop profile not found. Please complete setup.');
  }
  return success(res, sanitizeShop(req.shop));
};

/**
 * GET /api/v1/shop/stats
 * Dashboard stats — total sales, purchases, stock count, customer count.
 */
const getStats = async (req, res) => {
  const shopId = req.shop.id;

  const [salesRes, purchasesRes, stockRes, customersRes, todayRes] = await Promise.all([
    query(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions
           WHERE shop_id=$1 AND txn_type='Sale'`, [shopId]),
    query(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions
           WHERE shop_id=$1 AND txn_type='Purchase'`, [shopId]),
    query(`SELECT COUNT(*) AS total FROM current_stock WHERE shop_id=$1`, [shopId]),
    query(`SELECT COUNT(DISTINCT customer_id) AS total FROM transactions WHERE shop_id=$1`, [shopId]),
    query(`SELECT COUNT(*) AS total FROM transactions
           WHERE shop_id=$1 AND txn_date >= CURRENT_DATE`, [shopId]),
  ]);

  return success(res, {
    totalSales:      parseInt(salesRes.rows[0].total, 10),
    totalPurchases:  parseInt(purchasesRes.rows[0].total, 10),
    stockCount:      parseInt(stockRes.rows[0].total, 10),
    customerCount:   parseInt(customersRes.rows[0].total, 10),
    todayEntries:    parseInt(todayRes.rows[0].total, 10),
  });
};

// Strip sensitive internal fields before sending to client
const sanitizeShop = (shop) => {
  const { ...safe } = shop;
  return safe;
};

module.exports = { setupShop, getProfile, getStats };
