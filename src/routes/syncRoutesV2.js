'use strict';

const { Router } = require('express');
const { body, query } = require('express-validator');
const { verifyFirebaseToken, requireShopV2 } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { pushSync, pullSync } = require('../controllers/syncControllerV2');

const router = Router();

router.use(verifyFirebaseToken, requireShopV2);

/**
 * POST /api/v2/sync/push
 * Android → Server batch sync.
 */
router.post(
  '/push',
  [
    body('androidDeviceId').optional().trim(),
    body('transactions').isArray().withMessage('transactions must be an array'),
    body('transactions.*.transactionId').notEmpty(),
    body('transactions.*.transactionType').isIn(['Purchase', 'Sale', 'Repair']),
    body('transactions.*.amount').isInt({ min: 0 }),
    body('transactions.*.imei1').optional({ checkFalsy: true }).trim(),
    body('transactions.*.customerName').trim().notEmpty(),
    body('transactions.*.customerMobile').trim().notEmpty(),
    body('transactions.*.createdAtMillis').isNumeric(),
  ],
  validate,
  pushSync
);

/**
 * GET /api/v2/sync/pull?since=
 * Server → Android data restore.
 */
router.get(
  '/pull',
  [query('since').optional().isNumeric()],
  validate,
  pullSync
);

module.exports = router;
