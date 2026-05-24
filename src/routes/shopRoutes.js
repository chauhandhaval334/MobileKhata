'use strict';

const { Router } = require('express');
const { body } = require('express-validator');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { setupShop, getProfile, getStats } = require('../controllers/shopController');
const { getFeatures, getPlans } = require('../controllers/featuresController');

const router = Router();

// All shop routes require Firebase auth
router.use(verifyFirebaseToken);

/**
 * POST /api/v1/shop/setup
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
 * GET /api/v1/shop/profile
 * Get shop profile for authenticated user.
 */
router.get('/profile', requireShop, getProfile);

/**
 * GET /api/v1/shop/stats
 * Dashboard stats — total sales, purchases, stock, customers.
 */
router.get('/stats', requireShop, getStats);

/**
 * GET /api/v1/shop/features
 * Get feature flags for the authenticated user's shop.
 */
router.get('/features', requireShop, getFeatures);

/**
 * GET /api/v1/shop/plans
 * Premium plan list + support WhatsApp number.
 */
router.get('/plans', getPlans);

module.exports = router;
