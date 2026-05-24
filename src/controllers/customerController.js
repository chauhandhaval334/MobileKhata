'use strict';

const { query } = require('../config/database');
const { success, notFound, paginate } = require('../utils/response');

/**
 * GET /api/v1/customers
 * List all customers for the shop with optional search.
 */
const listCustomers = async (req, res) => {
  const shopId = req.shop.id;
  const { search, page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  let conditions = ['c.shop_id = $1'];
  const params = [shopId];
  let idx = 2;

  if (search && search.trim()) {
    conditions.push(`(c.full_name ILIKE $${idx} OR c.mobile ILIKE $${idx})`);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  const where = conditions.join(' AND ');

  const [rowsRes, countRes] = await Promise.all([
    query(
      `SELECT
         c.id, c.full_name, c.mobile, c.address, c.state, c.district,
         c.pin_code, c.gstin, c.photo_path, c.created_at, c.updated_at,
         COUNT(t.id) AS transaction_count,
         MAX(t.txn_date) AS last_transaction_date
       FROM customers c
       LEFT JOIN transactions t ON t.customer_id = c.id
       WHERE ${where}
       GROUP BY c.id
       ORDER BY MAX(t.txn_date) DESC NULLS LAST
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit, 10), offset]
    ),
    query(`SELECT COUNT(*) AS total FROM customers c WHERE ${where}`, params),
  ]);

  return paginate(res, rowsRes.rows, parseInt(countRes.rows[0].total, 10), parseInt(page, 10), parseInt(limit, 10));
};

/**
 * GET /api/v1/customers/:mobile
 * Get full customer profile + all their transactions.
 */
const getCustomerByMobile = async (req, res) => {
  const shopId = req.shop.id;
  const { mobile } = req.params;

  const customerRes = await query(
    'SELECT * FROM customers WHERE shop_id=$1 AND mobile=$2 LIMIT 1',
    [shopId, mobile]
  );
  if (customerRes.rows.length === 0) {
    return notFound(res, 'Customer not found');
  }

  const customer = customerRes.rows[0];
  // Mask Aadhaar — only show last 4 digits
  if (customer.aadhaar_number && customer.aadhaar_number.length > 4) {
    customer.aadhaar_number = 'XXXX-XXXX-' + customer.aadhaar_number.slice(-4);
  }

  const txnsRes = await query(
    `SELECT
       t.id, t.txn_type, t.amount, t.payment_method, t.remarks, t.txn_date,
       d.brand, d.model, d.storage, d.color, d.imei1, d.imei2, d.condition_label
     FROM transactions t
     JOIN devices d ON d.id = t.device_id
     WHERE t.customer_id = $1 AND t.shop_id = $2
     ORDER BY t.txn_date DESC`,
    [customer.id, shopId]
  );

  return success(res, { ...customer, transactions: txnsRes.rows });
};

module.exports = { listCustomers, getCustomerByMobile };
