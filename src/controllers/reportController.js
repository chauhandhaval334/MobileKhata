'use strict';

const { query } = require('../config/database');
const { success } = require('../utils/response');

/**
 * GET /api/v1/reports/summary
 * Aggregated report for a date range.
 * Mirrors Android's ReportGeneratorScreen / CombinedReportScreen logic.
 *
 * Query params: from (ISO), to (ISO), type ('Sale'|'Purchase'|'All')
 */
const getSummaryReport = async (req, res) => {
  const shopId = req.shop.id;
  const { from, to, type = 'All' } = req.query;

  const fromDate = from ? new Date(from).toISOString() : new Date(0).toISOString();
  const toDate   = to   ? new Date(to).toISOString()   : new Date().toISOString();

  const typeFilter = type === 'All' ? '' : `AND t.txn_type = '${type === 'Sale' ? 'Sale' : 'Purchase'}'`;

  // Aggregate summary
  const summaryRes = await query(
    `SELECT
       t.txn_type,
       COUNT(*) AS count,
       SUM(t.amount) AS total_amount,
       AVG(t.amount) AS avg_amount,
       MIN(t.amount) AS min_amount,
       MAX(t.amount) AS max_amount
     FROM transactions t
     WHERE t.shop_id=$1
       AND t.txn_date >= $2
       AND t.txn_date <= $3
       ${typeFilter}
     GROUP BY t.txn_type`,
    [shopId, fromDate, toDate]
  );

  // Payment method breakdown
  const paymentRes = await query(
    `SELECT payment_method, COUNT(*) AS count, SUM(amount) AS total
     FROM transactions
     WHERE shop_id=$1 AND txn_date >= $2 AND txn_date <= $3
       ${typeFilter}
     GROUP BY payment_method
     ORDER BY total DESC`,
    [shopId, fromDate, toDate]
  );

  // Top devices by value
  const topDevicesRes = await query(
    `SELECT d.brand, d.model, d.storage,
            COUNT(*) AS txn_count, SUM(t.amount) AS total_value
     FROM transactions t
     JOIN devices d ON d.id = t.device_id
     WHERE t.shop_id=$1 AND t.txn_date >= $2 AND t.txn_date <= $3
       ${typeFilter}
     GROUP BY d.brand, d.model, d.storage
     ORDER BY total_value DESC
     LIMIT 10`,
    [shopId, fromDate, toDate]
  );

  // Monthly trend
  const trendRes = await query(
    `SELECT
       DATE_TRUNC('month', t.txn_date) AS month,
       t.txn_type,
       COUNT(*) AS count,
       SUM(t.amount) AS total
     FROM transactions t
     WHERE t.shop_id=$1 AND t.txn_date >= $2 AND t.txn_date <= $3
       ${typeFilter}
     GROUP BY DATE_TRUNC('month', t.txn_date), t.txn_type
     ORDER BY month ASC`,
    [shopId, fromDate, toDate]
  );

  // Full transaction list for the range
  const txnsRes = await query(
    `SELECT
       t.id, t.android_txn_id, t.txn_type, t.amount, t.payment_method,
       t.remarks, t.txn_date,
       d.brand, d.model, d.storage, d.color, d.imei1, d.imei2, d.condition_label,
       c.full_name AS customer_name, c.mobile AS customer_mobile,
       c.address AS customer_address, c.district AS customer_district,
       c.aadhaar_number, c.gstin
     FROM transactions t
     JOIN devices d   ON d.id = t.device_id
     JOIN customers c ON c.id = t.customer_id
     WHERE t.shop_id=$1 AND t.txn_date >= $2 AND t.txn_date <= $3
       ${typeFilter}
     ORDER BY t.txn_date ASC`,
    [shopId, fromDate, toDate]
  );

  return success(res, {
    period:       { from: fromDate, to: toDate, type },
    summary:      summaryRes.rows,
    byPayment:    paymentRes.rows,
    topDevices:   topDevicesRes.rows,
    monthlyTrend: trendRes.rows,
    transactions: txnsRes.rows,
  });
};

/**
 * GET /api/v1/reports/daily
 * Today's transactions grouped for dashboard quick view.
 */
const getDailyReport = async (req, res) => {
  const shopId = req.shop.id;
  const { date } = req.query; // optional YYYY-MM-DD

  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay   = new Date(targetDate.setHours(23, 59, 59, 999)).toISOString();

  const result = await query(
    `SELECT
       t.txn_type, COUNT(*) AS count, SUM(t.amount) AS total,
       json_agg(json_build_object(
         'id', t.id,
         'brand', d.brand, 'model', d.model,
         'imei1', d.imei1, 'amount', t.amount,
         'txn_type', t.txn_type, 'payment_method', t.payment_method,
         'customer_name', c.full_name, 'txn_date', t.txn_date
       ) ORDER BY t.txn_date DESC) AS entries
     FROM transactions t
     JOIN devices   d ON d.id = t.device_id
     JOIN customers c ON c.id = t.customer_id
     WHERE t.shop_id=$1 AND t.txn_date >= $2 AND t.txn_date <= $3
     GROUP BY t.txn_type`,
    [shopId, startOfDay, endOfDay]
  );

  return success(res, result.rows);
};

module.exports = { getSummaryReport, getDailyReport };
