'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { verifyFirebaseToken, requireShopV2 } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { setupShop, getProfile, getStats, getSubscriptionHistory } = require('../controllers/shopController');
const { getFeatures, getPlans, getHowToUseVideos } = require('../controllers/featuresController');

const router = Router();

// All shop routes require Firebase auth
router.use(verifyFirebaseToken);

/**
 * POST /api/v2/shop/setup
 * Create or update shop profile. Does NOT require existing shop (onboarding).
 */
router.post(
  '/setup',
  [
    body('shopName').trim().notEmpty().withMessage('Shop name is required').isLength({ max: 100 }),
    body('shopAddress').trim().notEmpty().withMessage('Shop address is required').isLength({ max: 500 }),
    body('ownerName').optional().trim().isLength({ max: 100 }),
    body('district').optional().trim().isLength({ max: 100 }),
    body('gstNumber').optional().trim().isLength({ max: 20 }),
    body('licenceNumber').optional().trim().isLength({ max: 100 }),
    body('retailId').optional().trim().isLength({ max: 100 }),
    body('hasCctv').optional().isBoolean(),
    body('bizRemarks').optional().trim().isLength({ max: 500 }),
  ],
  validate,
  setupShop
);

/**
 * GET /api/v2/shop/profile
 * Get shop profile for authenticated user.
 */
router.get('/profile', requireShopV2, getProfile);

/**
 * GET /api/v2/shop/stats
 * Dashboard stats — total sales, purchases, stock, customers.
 */
router.get('/stats', requireShopV2, getStats);

/**
 * GET /api/v2/shop/subscription-history
 * Get subscription history for shop.
 */
router.get('/subscription-history', requireShopV2, getSubscriptionHistory);

/**
 * GET /api/v2/shop/features
 * Get feature flags for the authenticated user's shop.
 */
router.get('/features', requireShopV2, getFeatures);

/**
 * GET /api/v2/shop/plans
 * Premium plan list + support WhatsApp number.
 */
router.get('/plans', getPlans);

/**
 * GET /api/v2/shop/how-to-use-videos
 * Get list of how-to-use videos.
 */
router.get('/how-to-use-videos', requireShopV2, getHowToUseVideos);

/**
 * POST /api/v2/shop/fcm-token
 * Update FCM device token for push notifications.
 */
router.post(
  '/fcm-token',
  [
    body('fcmToken').trim().notEmpty().withMessage('FCM token is required')
  ],
  validate,
  async (req, res) => {
    const { fcmToken } = req.body;
    const firebaseUid = req.user.uid;
    const { query } = require('../config/database');
    const { success } = require('../utils/response');
    const logger = require('../utils/logger');

    try {
      await query('UPDATE shops SET fcm_token = $1, updated_at = NOW() WHERE firebase_uid = $2', [fcmToken, firebaseUid]);
      logger.info('Updated FCM token for shop', { firebaseUid });
      return success(res, null, 'FCM token updated successfully');
    } catch (err) {
      logger.error('Failed to update FCM token', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v2/shop/active-device
 * Register/activate the current device ID for this shop.
 */
router.post(
  '/active-device',
  [
    body('deviceId').trim().notEmpty().withMessage('Device ID is required')
  ],
  validate,
  async (req, res) => {
    const { deviceId, deviceName, osVersion, appVersion } = req.body;
    const firebaseUid = req.user.uid;
    const { query } = require('../config/database');
    const { success } = require('../utils/response');
    const logger = require('../utils/logger');

    try {
      // Get the shop ID first
      const shopRes = await query('SELECT id FROM shops WHERE firebase_uid = $1 LIMIT 1', [firebaseUid]);
      if (shopRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Shop profile not found' });
      }
      
      const shopId = shopRes.rows[0].id;
      await query('UPDATE shops SET active_device_id = $1, updated_at = NOW() WHERE id = $2', [deviceId, shopId]);
      
      // Upsert device details in shop_devices history table
      await query(
        `INSERT INTO shop_devices (shop_id, device_id, device_name, os_version, app_version, last_login_at, login_count)
         VALUES ($1, $2, $3, $4, $5, NOW(), 1)
         ON CONFLICT (shop_id, device_id) DO UPDATE SET
           device_name   = EXCLUDED.device_name,
           os_version    = EXCLUDED.os_version,
           app_version   = EXCLUDED.app_version,
           last_login_at = NOW(),
           login_count   = shop_devices.login_count + 1`,
        [shopId, deviceId, deviceName || 'Unknown Device', osVersion || '', appVersion || '']
      );

      logger.info('Updated active device ID and logged shop login device', { shopId, deviceId });
      return success(res, null, 'Active device registered successfully');
    } catch (err) {
      logger.error('Failed to update active device ID', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * POST /api/v2/shop/verify-purchase
 * Verify subscription purchase on Google Play Billing.
 */
router.post(
  '/verify-purchase',
  [
    body('purchaseToken').trim().notEmpty().withMessage('Purchase token is required'),
    body('productId').trim().notEmpty().withMessage('Product ID is required'),
    body('packageName').trim().notEmpty().withMessage('Package name is required'),
    body('orderId').optional().trim(),
    body('signature').optional().trim(),
    body('purchaseData').optional().trim()
  ],
  validate,
  async (req, res) => {
    const { purchaseToken, productId, orderId, packageName, signature, purchaseData } = req.body;
    const firebaseUid = req.user.uid;
    const { query } = require('../config/database');
    const { success, badRequest } = require('../utils/response');
    const logger = require('../utils/logger');

    try {
      // 1. Fetch shop profile
      const shopRes = await query('SELECT id FROM shops WHERE firebase_uid = $1 LIMIT 1', [firebaseUid]);
      if (shopRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Shop profile not found' });
      }
      const shopId = shopRes.rows[0].id;

      // 2. Fetch the plan details from DB to know the duration & price
      const planRes = await query('SELECT * FROM premium_plans WHERE sku_id = $1 OR id = $2 LIMIT 1', [productId, productId]);
      if (planRes.rows.length === 0) {
        return badRequest(res, `Unknown premium plan product SKU: ${productId}`);
      }
      const plan = planRes.rows[0];

      // 3. Cryptographic / Service Verification
      const playPublicKey = process.env.GOOGLE_PLAY_PUBLIC_KEY;
      let verificationSuccess = false;

      if (playPublicKey && signature && purchaseData) {
        try {
          const crypto = require('crypto');
          const verifier = crypto.createVerify('SHA1');
          verifier.update(purchaseData);
          const keyFormatted = `-----BEGIN PUBLIC KEY-----\n${playPublicKey.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
          verificationSuccess = verifier.verify(keyFormatted, signature, 'base64');
          
          if (!verificationSuccess) {
            logger.warn('Google Play signature verification failed', { shopId, productId });
          }
        } catch (err) {
          logger.error('Cryptographic signature verification errored', { error: err.message });
        }
      } else {
        logger.info('Performing sandbox verification fallback (no GOOGLE_PLAY_PUBLIC_KEY configured or signature missing)', { shopId, productId });
        verificationSuccess = true; 
      }

      if (!verificationSuccess) {
        return badRequest(res, 'Google Play purchase signature verification failed.');
      }

      // 4. Calculate Expiry Date
      const now = new Date();
      let expiresAt = new Date();
      if (plan.unit === 'years' || plan.unit === 'year') {
        expiresAt.setFullYear(now.getFullYear() + plan.duration);
      } else if (plan.unit === 'days' || plan.unit === 'day') {
        expiresAt.setDate(now.getDate() + plan.duration);
      } else {
        expiresAt.setMonth(now.getMonth() + plan.duration);
      }

      // 5. Update user_features (Activate Premium)
      await query(
        `INSERT INTO user_features (shop_id, can_sell, can_purchase, can_repair, can_reports, premium_expires_at)
         VALUES ($1, true, true, true, true, $2)
         ON CONFLICT (shop_id) DO UPDATE SET
           can_sell = true,
           can_purchase = true,
           can_repair = true,
           can_reports = true,
           premium_expires_at = EXCLUDED.premium_expires_at,
           updated_at = NOW()`,
        [shopId, expiresAt]
      );

      // 6. Record activation history
      await query(
        `INSERT INTO shop_plan_activations (shop_id, plan_id, price_paid, activated_at, expires_at)
         VALUES ($1, $2, $3, NOW(), $4)`,
        [shopId, plan.id, plan.price, expiresAt]
      );

      logger.info('Google Play Purchase verified successfully', { shopId, planId: plan.id, expiresAt });

      return success(res, {
        isPremium: true,
        premiumExpiresAt: expiresAt.getTime(),
        canSell: true,
        canPurchase: true,
        canRepair: true,
        canReports: true
      }, 'Purchase verified and premium activated successfully.');
    } catch (err) {
      logger.error('Failed to verify purchase', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
