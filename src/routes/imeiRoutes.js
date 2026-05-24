'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { query } = require('../config/database');
const { success, notFound } = require('../utils/response');
const { isValidImei } = require('../utils/helpers');

const router = Router();

router.use(verifyFirebaseToken, requireShop);

/**
 * GET /api/v1/imei/:imei
 * Full IMEI lookup:
 *  - Is it valid (Luhn check)?
 *  - Is it currently in stock?
 *  - Full transaction lifecycle history
 *  - Last known owner
 */
router.get(
  '/:imei',
  [param('imei').trim().notEmpty().withMessage('IMEI is required')],
  validate,
  async (req, res) => {
    const shopId = req.shop.id;
    const { imei } = req.params;

    const luhnValid = isValidImei(imei);

    // Check stock status
    const stockRes = await query(
      `SELECT * FROM current_stock WHERE shop_id=$1 AND (imei1=$2 OR imei2=$2)`,
      [shopId, imei]
    );

    // Full lifecycle
    const historyRes = await query(
      `SELECT
         t.txn_type, t.amount, t.payment_method, t.txn_date,
         c.full_name AS customer_name, c.mobile AS customer_mobile,
         c.district AS customer_district,
         d.brand, d.model, d.storage, d.color, d.condition_label
       FROM transactions t
       JOIN devices   d ON d.id = t.device_id
       JOIN customers c ON c.id = t.customer_id
       WHERE t.shop_id=$1 AND (d.imei1=$2 OR d.imei2=$2)
       ORDER BY t.txn_date ASC`,
      [shopId, imei]
    );

    if (historyRes.rows.length === 0 && stockRes.rows.length === 0) {
      return notFound(res, `IMEI ${imei} not found in your records`);
    }

    const lastTxn = historyRes.rows[historyRes.rows.length - 1] || null;
    const inStock  = stockRes.rows.length > 0;

    return success(res, {
      imei,
      luhnValid,
      inStock,
      currentStock: inStock ? stockRes.rows[0] : null,
      lastTransaction: lastTxn,
      history: historyRes.rows,
      transactionCount: historyRes.rows.length,
    });
  }
);

module.exports = router;
