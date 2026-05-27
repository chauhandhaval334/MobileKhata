'use strict';

const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  createTransaction, listTransactions,
  getTransaction, getImeiHistory,
  deleteTransactionByAndroidId, deleteTransactionsByCustomer,
} = require('../controllers/transactionController');
const { upload } = require('../services/uploadService');
const { uploadMedia } = require('../controllers/mediaController');

const router = Router();

router.use(verifyFirebaseToken, requireShop);

/**
 * POST /api/v1/transactions
 * Create a new purchase or sale transaction.
 */
router.post(
  '/',
  [
    body('txnType').isIn(['Purchase', 'Sale', 'Repair']).withMessage('txnType must be Purchase, Sale or Repair'),
    body('amount').isInt({ min: 0 }).withMessage('Amount must be a non-negative integer'),
    body('paymentMethod').optional().isIn(['Cash', 'Online', 'Cheque']),
    body('imei1').trim().notEmpty().withMessage('IMEI1 is required').isLength({ min: 14, max: 16 }),
    body('imei2').optional().trim().isLength({ max: 16 }),
    body('brand').trim().notEmpty().withMessage('Brand is required'),
    body('model').trim().notEmpty().withMessage('Model is required'),
    body('customerName').trim().notEmpty().withMessage('Customer name is required'),
    body('customerMobile').trim().notEmpty().withMessage('Customer mobile is required')
      .isMobilePhone('any', { strictMode: false }),
    body('txnDateMillis').optional().isNumeric(),
    body('androidTxnId').optional().trim(),
  ],
  validate,
  createTransaction
);

/**
 * GET /api/v1/transactions
 * List transactions with optional filters.
 */
router.get(
  '/',
  [
    query('type').optional().isIn(['Sale', 'Purchase']),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  listTransactions
);

/**
 * GET /api/v1/transactions/imei/:imei
 * Full lifecycle history for an IMEI.
 */
router.get(
  '/imei/:imei',
  [param('imei').trim().notEmpty().isLength({ min: 14, max: 16 })],
  validate,
  getImeiHistory
);

/**
 * GET /api/v1/transactions/:id
 * Get single transaction detail.
 */
router.get(
  '/:id',
  [param('id').isUUID().withMessage('Invalid transaction ID')],
  validate,
  getTransaction
);

/**
 * POST /api/v1/transactions/:txnId/media
 * Upload files for a transaction (shortcut route).
 */
router.post(
  '/:txnId/media',
  [param('txnId').isUUID()],
  validate,
  upload.fields([
    { name: 'aadhaar_front',  maxCount: 1 },
    { name: 'aadhaar_back',   maxCount: 1 },
    { name: 'pan',            maxCount: 1 },
    { name: 'invoice',        maxCount: 5 },
    { name: 'customer_photo', maxCount: 1 },
    { name: 'device_image',   maxCount: 5 },
    { name: 'warranty',       maxCount: 2 },
    { name: 'other',          maxCount: 5 },
  ]),
  uploadMedia
);

/**
 * DELETE /api/v1/transactions/by-android-id/:androidTxnId
 * Delete a single transaction by Android txn ID.
 */
router.delete(
  '/by-android-id/:androidTxnId',
  [param('androidTxnId').trim().notEmpty()],
  validate,
  deleteTransactionByAndroidId
);

/**
 * DELETE /api/v1/transactions/by-customer/:mobile
 * Delete all transactions for a customer mobile number.
 */
router.delete(
  '/by-customer/:mobile',
  [param('mobile').trim().notEmpty()],
  validate,
  deleteTransactionsByCustomer
);

module.exports = router;
