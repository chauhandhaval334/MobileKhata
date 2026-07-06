'use strict';

const { Router } = require('express');
const { query } = require('../config/database');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/auth');
const { success, paginate } = require('../utils/response');
const { setFeatures, listAllFeatures } = require('../controllers/featuresController');

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

  const conditions = ['q.shop_id = $1'];
  const params = [shopId];
  let idx = 2;

  if (type && ['Sale', 'Purchase', 'Repair', 'Custom Bill'].includes(type)) {
    conditions.push(`q.txn_type = $${idx++}`);
    params.push(type);
  }
  if (from) { conditions.push(`q.txn_date >= $${idx++}`); params.push(new Date(from).toISOString()); }
  if (to)   { conditions.push(`q.txn_date <= $${idx++}`); params.push(new Date(to).toISOString()); }

  const where = conditions.join(' AND ');

  const baseQuery = `
    SELECT * FROM (
      SELECT t.id, t.txn_type, t.amount, t.payment_method, t.remarks, t.txn_date,
             d.brand, d.model, d.imei1, d.storage, d.color,
             c.full_name AS customer_name, c.mobile AS customer_mobile,
             t.shop_id
      FROM transactions t
      JOIN devices d   ON d.id = t.device_id
      JOIN customers c ON c.id = t.customer_id

      UNION ALL

      SELECT b.id, 'Custom Bill' AS txn_type, CAST(b.grand_total AS INTEGER) AS amount,
             b.payment_method, 'Bill No: ' || b.bill_number || ' | Status: ' || b.payment_status AS remarks,
             b.created_at AS txn_date, 'Custom' AS brand, b.bill_type AS model,
             b.bill_number AS imei1, '' AS storage, '' AS color,
             b.customer_name, b.customer_mobile, b.shop_id
      FROM bills b
    ) q
    WHERE ${where}
  `;

  const [rowsRes, countRes] = await Promise.all([
    query(
      `${baseQuery}
       ORDER BY q.txn_date DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    ),
    query(`SELECT COUNT(*) AS total FROM (${baseQuery}) c`, params),
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

/**
 * GET /api/v1/admin/features
 * List all shops and their feature flags.
 */
router.get('/features', listAllFeatures);

/**
 * POST /api/v1/admin/features/:shopId
 * Set feature flags for a specific shop.
 * Body: { canSell: bool, canPurchase: bool, canReports: bool }
 */
router.post('/features/:shopId', setFeatures);

module.exports = router;
