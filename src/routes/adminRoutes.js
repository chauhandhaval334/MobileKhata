'use strict';

const { Router } = require('express');
const { query } = require('../config/database');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/auth');
const { success, paginate } = require('../utils/response');

const router = Router();

router.use(verifyFirebaseToken, requireAdmin);

/**
 * GET /api/v1/admin/shops
 * List all registered shops.
 */
router.get('/shops', async (req, res) => {
  const { page = 1, limit = 50, search } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  let conditions = ['is_active = TRUE'];
  const params = [];
  let idx = 1;

  if (search && search.trim()) {
    conditions.push(`(shop_name ILIKE $${idx} OR owner_name ILIKE $${idx} OR phone_number ILIKE $${idx})`);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const [rowsRes, countRes] = await Promise.all([
    query(
      `SELECT id, shop_name, owner_name, phone_number, district,
              gst_number, has_cctv, created_at, updated_at
       FROM shops
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    ),
    query(`SELECT COUNT(*) AS total FROM shops WHERE ${where}`, params),
  ]);

  return paginate(res, rowsRes.rows, parseInt(countRes.rows[0].total, 10), parseInt(page, 10), parseInt(limit, 10));
});

/**
 * GET /api/v1/admin/shops/:shopId/transactions
 * All transactions for a specific shop.
 */
router.get('/shops/:shopId/transactions', async (req, res) => {
  const { shopId } = req.params;
  const { page = 1, limit = 50, type, from, to } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  const conditions = ['t.shop_id = $1'];
  const params = [shopId];
  let idx = 2;

  if (type && ['Sale', 'Purchase'].includes(type)) {
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
 * GET /api/v1/admin/stats
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

module.exports = router;
