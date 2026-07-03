'use strict';

const { query } = require('../config/database');
const { success, notFound, badRequest } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * GET /api/v1/shop/features
 * Returns feature flags for the authenticated user's shop.
 * Calculates access permission based on premium expiry and trial limits.
 */
const getFeatures = async (req, res) => {
  const shopId = req.shop.id;

  const result = await query(
    `SELECT uf.can_sell, uf.can_purchase, uf.can_repair, uf.can_reports,
            COALESCE(uf.free_entries_limit, 10) AS free_entries_limit,
            uf.premium_expires_at,
            COALESCE(uf.free_days_limit, 30) AS free_days_limit,
            s.created_at AS shop_created_at
     FROM shops s
     LEFT JOIN user_features uf ON uf.shop_id = s.id
     WHERE s.id = $1`,
    [shopId]
  );

  const txnResult = await query(
    `SELECT COUNT(*)::integer AS total FROM transactions WHERE shop_id = $1`,
    [shopId]
  );
  const freeEntriesUsed = txnResult.rows[0]?.total || 0;

  if (result.rows.length === 0) {
    return success(res, {
      canSell: false, canPurchase: false, canRepair: false, canReports: false,
      freeEntriesLimit: 10, freeEntriesUsed: 0,
      isPremium: false, premiumExpiresAt: null,
      freeDaysLimit: 30, freeDaysRemaining: 30
    });
  }

  const row = result.rows[0];
  const now = new Date();
  const premiumExpiresAt = row.premium_expires_at ? new Date(row.premium_expires_at) : null;
  const isPremium = premiumExpiresAt !== null && premiumExpiresAt > now;

  const shopCreatedAt = new Date(row.shop_created_at);
  const daysActive = Math.floor((now - shopCreatedAt) / (1000 * 60 * 60 * 24));
  const freeDaysLimit = row.free_days_limit;
  const freeDaysRemaining = Math.max(0, freeDaysLimit - daysActive);

  const freeEntriesLimit = row.free_entries_limit;
  const isTrialExpired = (freeEntriesUsed >= freeEntriesLimit) || (freeDaysRemaining <= 0);

  // backwards-compatible flag calculation:
  const hasAccess = isPremium || !isTrialExpired;

  return success(res, {
    canSell:          hasAccess,
    canPurchase:      hasAccess,
    canRepair:        hasAccess,
    canReports:       hasAccess,
    freeEntriesLimit: freeEntriesLimit,
    freeEntriesUsed:  freeEntriesUsed,
    isPremium:        isPremium,
    premiumExpiresAt: premiumExpiresAt ? premiumExpiresAt.getTime() : null,
    freeDaysLimit:     freeDaysLimit,
    freeDaysRemaining: freeDaysRemaining
  });
};

/**
 * POST /api/v1/admin/features/:shopId
 * Admin-only: Set feature flags for a specific shop.
 * Body: { canSell, canPurchase, canReports, premiumExpiresAt, freeDaysLimit }
 */
const setFeatures = async (req, res) => {
  const { shopId } = req.params;
  const { 
    canSell, 
    canPurchase, 
    canRepair, 
    canReports, 
    freeEntriesLimit, 
    freeEntriesUsed,
    premiumExpiresAt,
    freeDaysLimit
  } = req.body;

  // Verify shop exists
  const shopCheck = await query(`SELECT id FROM shops WHERE id = $1`, [shopId]);
  if (shopCheck.rows.length === 0) {
    return notFound(res, `Shop not found: ${shopId}`);
  }

  const sell = typeof canSell === 'boolean' ? canSell : false;
  const purchase = typeof canPurchase === 'boolean' ? canPurchase : false;
  const repair = typeof canRepair === 'boolean' ? canRepair : false;
  const reports = typeof canReports === 'boolean' ? canReports : false;
  const limit = typeof freeEntriesLimit === 'number' ? freeEntriesLimit : 10;
  const used  = typeof freeEntriesUsed  === 'number' ? freeEntriesUsed  : 0;
  
  const premExpires = premiumExpiresAt ? new Date(premiumExpiresAt) : null;
  const daysLimit = typeof freeDaysLimit === 'number' ? freeDaysLimit : 30;

  await query(
    `INSERT INTO user_features (shop_id, can_sell, can_purchase, can_repair, can_reports, free_entries_limit, free_entries_used, premium_expires_at, free_days_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (shop_id) DO UPDATE SET
       can_sell            = EXCLUDED.can_sell,
       can_purchase        = EXCLUDED.can_purchase,
       can_repair          = EXCLUDED.can_repair,
       can_reports         = EXCLUDED.can_reports,
       free_entries_limit  = EXCLUDED.free_entries_limit,
       free_entries_used   = EXCLUDED.free_entries_used,
       premium_expires_at  = EXCLUDED.premium_expires_at,
       free_days_limit     = EXCLUDED.free_days_limit,
       updated_at          = NOW()`,
    [shopId, sell, purchase, repair, reports, limit, used, premExpires, daysLimit]
  );

  logger.info('Feature flags updated', { shopId, canSell: sell, canPurchase: purchase, canRepair: repair, canReports: reports, freeEntriesLimit: limit, freeEntriesUsed: used, premiumExpiresAt: premExpires, freeDaysLimit: daysLimit });
  return success(res, { shopId, canSell: sell, canPurchase: purchase, canRepair: repair, canReports: reports, freeEntriesLimit: limit, freeEntriesUsed: used, premiumExpiresAt: premExpires, freeDaysLimit: daysLimit }, 'Features updated');
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
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  let supportWhatsapp = '+918160707979';
  let supportEmail = 'support@mobilekhata.com';
  let privacyPolicyUrl = `${baseUrl}/privacy.html`;
  let termsOfServiceUrl = `${baseUrl}/terms.html`;
  let minAppVersionCode = 3;
  let appUpdateUrl = 'https://play.google.com/store/apps/details?id=com.mobilekhata';

  try {
    const configRes = await query('SELECT key, value FROM app_config');
    const configs = {};
    configRes.rows.forEach(r => { configs[r.key] = r.value; });
    if (configs.support_whatsapp) supportWhatsapp = configs.support_whatsapp;
    if (configs.support_email) supportEmail = configs.support_email;
    if (configs.privacy_policy_url) privacyPolicyUrl = configs.privacy_policy_url;
    if (configs.terms_of_service_url) termsOfServiceUrl = configs.terms_of_service_url;
    if (configs.min_app_version_code) minAppVersionCode = parseInt(configs.min_app_version_code, 10);
    if (configs.app_update_url) appUpdateUrl = configs.app_update_url;
  } catch (err) {
    logger.error('Failed to load app_config for plans', { error: err.message });
  }

  try {
    // Fetch active premium plans
    const plansRes = await query(
      `SELECT id, sku_id AS "skuId", name, name_hi AS "nameHi", name_gu AS "nameGu",
              price, currency, duration, unit, popular
       FROM premium_plans
       WHERE is_active = TRUE
       ORDER BY price ASC`
    );

    // Fetch the active special offer (One Time Offer popup)
    let specialOffer = null;
    try {
      const offerRes = await query(
        `SELECT
           id,
           is_active           AS "isActive",
           title,
           title_hi            AS "titleHi",
           title_gu            AS "titleGu",
           subtitle,
           subtitle_hi         AS "subtitleHi",
           subtitle_gu         AS "subtitleGu",
           discount_pct        AS "discountPct",
           plan_id             AS "planId",
           original_price      AS "originalPrice",
           offer_price         AS "offerPrice",
           currency,
           price_unit          AS "priceUnit",
           price_unit_hi       AS "priceUnitHi",
           price_unit_gu       AS "priceUnitGu",
           countdown_seconds   AS "countdownSeconds",
           bg_gradient_start   AS "bgGradientStart",
           bg_gradient_end     AS "bgGradientEnd",
           accent_color_start  AS "accentColorStart",
           accent_color_end    AS "accentColorEnd"
         FROM special_offers
         WHERE is_active = TRUE
         LIMIT 1`
      );
      if (offerRes.rows.length > 0) {
        specialOffer = offerRes.rows[0];
      }
    } catch (offerErr) {
      // special_offers table may not exist yet (pre-migration) — safe to ignore
      logger.warn('Could not fetch special_offers (table may not exist yet)', { error: offerErr.message });
    }

    return success(res, {
      supportWhatsapp,
      supportEmail,
      privacyPolicyUrl,
      termsOfServiceUrl,
      minAppVersionCode,
      appUpdateUrl,
      plans: plansRes.rows,
      offer: specialOffer,
    });
  } catch (err) {
    logger.error('Failed to query premium plans', { error: err.message });
    return res.status(500).json({ success: false, error: 'Database query failed' });
  }
};

/**
 * GET /api/v2/shop/how-to-use-videos
 * Returns the list of tutorial and how-to-use videos.
 */
const getHowToUseVideos = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, title, description, duration, video_url AS "videoUrl"
       FROM how_to_use_videos
       ORDER BY id ASC`
    );
    return success(res, result.rows);
  } catch (err) {
    logger.error('Failed to query how-to-use videos', { error: err.message });
    return res.status(500).json({ success: false, error: 'Database query failed' });
  }
};

module.exports = { getFeatures, setFeatures, listAllFeatures, getPlans, getHowToUseVideos };
