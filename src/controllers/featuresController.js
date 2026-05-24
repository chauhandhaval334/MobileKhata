'use strict';

const { query } = require('../config/database');
const { success, notFound, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * GET /api/v1/shop/features
 * Returns feature flags for the authenticated user's shop.
 * If no row exists yet, returns all false (default locked).
 */
const getFeatures = async (req, res) => {
  const shopId = req.shop.id;

  const result = await query(
    `SELECT can_sell, can_purchase, can_reports
     FROM user_features WHERE shop_id = $1`,
    [shopId]
  );

  if (result.rows.length === 0) {
    // No row yet — all features locked by default
    return success(res, { canSell: false, canPurchase: false, canReports: false });
  }

  const row = result.rows[0];
  return success(res, {
    canSell:     row.can_sell,
    canPurchase: row.can_purchase,
    canReports:  row.can_reports,
  });
};

/**
 * POST /api/v1/admin/features/:shopId
 * Admin-only: Set feature flags for a specific shop.
 * Body: { canSell, canPurchase, canReports }
 */
const setFeatures = async (req, res) => {
  const { shopId } = req.params;
  const { canSell, canPurchase, canReports } = req.body;

  if (typeof canSell !== 'boolean' || typeof canPurchase !== 'boolean' || typeof canReports !== 'boolean') {
    return badRequest(res, 'canSell, canPurchase, canReports must all be booleans');
  }

  // Verify shop exists
  const shopCheck = await query(`SELECT id FROM shops WHERE id = $1`, [shopId]);
  if (shopCheck.rows.length === 0) {
    return notFound(res, `Shop not found: ${shopId}`);
  }

  await query(
    `INSERT INTO user_features (shop_id, can_sell, can_purchase, can_reports)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (shop_id) DO UPDATE SET
       can_sell     = EXCLUDED.can_sell,
       can_purchase = EXCLUDED.can_purchase,
       can_reports  = EXCLUDED.can_reports,
       updated_at   = NOW()`,
    [shopId, canSell, canPurchase, canReports]
  );

  logger.info('Feature flags updated', { shopId, canSell, canPurchase, canReports });
  return success(res, { shopId, canSell, canPurchase, canReports }, 'Features updated');
};

/**
 * GET /api/v1/admin/features
 * Admin-only: List all shops with their feature flags.
 */
const listAllFeatures = async (req, res) => {
  const result = await query(
    `SELECT s.id AS "shopId", s.shop_name AS "shopName", s.phone_number AS "phone",
            COALESCE(uf.can_sell, false)     AS "canSell",
            COALESCE(uf.can_purchase, false) AS "canPurchase",
            COALESCE(uf.can_reports, false)  AS "canReports"
     FROM shops s
     LEFT JOIN user_features uf ON uf.shop_id = s.id
     ORDER BY s.created_at DESC`
  );
  return success(res, result.rows);
};

/**
 * GET /api/v1/shop/plans
 * Returns available premium plans and support contact.
 * Public within auth — no shop required.
 */
const getPlans = async (req, res) => {
  return success(res, {
    supportWhatsapp: '+918160707979',
    plans: [
      {
        id:       'plan_6m',
        name:     '6 Months',
        nameHi:   '6 महीने',
        nameGu:   '6 મહિના',
        price:    699,
        currency: '₹',
        duration: 6,
        unit:     'months',
        popular:  false,
      },
      {
        id:       'plan_1y',
        name:     '1 Year',
        nameHi:   '1 साल',
        nameGu:   '1 વર્ષ',
        price:    799,
        currency: '₹',
        duration: 12,
        unit:     'months',
        popular:  true,
      },
    ],
  });
};

module.exports = { getFeatures, setFeatures, listAllFeatures, getPlans };
