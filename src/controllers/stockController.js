'use strict';

const { query } = require('../config/database');
const { success } = require('../utils/response');

/**
 * GET /api/v1/stock
 * Current stock — devices purchased but not yet sold.
 * Mirrors Android's getInStockDevices() using the current_stock view.
 */
const getCurrentStock = async (req, res) => {
  const shopId = req.shop.id;
  const { search } = req.query;

  let sql = `SELECT * FROM current_stock WHERE shop_id = $1`;
  const params = [shopId];

  if (search && search.trim()) {
    sql += ` AND (
      imei1 ILIKE $2 OR
      imei2 ILIKE $2 OR
      brand ILIKE $2 OR
      model ILIKE $2 OR
      color ILIKE $2 OR
      storage ILIKE $2
    )`;
    params.push(`%${search.trim()}%`);
  }

  sql += ' ORDER BY purchased_at DESC';

  const result = await query(sql, params);
  return success(res, result.rows);
};

/**
 * GET /api/v1/stock/check/:imei
 * Check if a specific IMEI is currently in stock.
 */
const checkImeiStock = async (req, res) => {
  const shopId = req.shop.id;
  const { imei } = req.params;

  const result = await query(
    `SELECT * FROM current_stock WHERE shop_id=$1 AND (imei1=$2 OR imei2=$2)`,
    [shopId, imei]
  );

  return success(res, {
    inStock: result.rows.length > 0,
    device: result.rows[0] || null,
  });
};

module.exports = { getCurrentStock, checkImeiStock };
