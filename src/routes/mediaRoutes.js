'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { upload } = require('../services/uploadService');
const { uploadMedia, serveMedia, deleteMedia } = require('../controllers/mediaController');

const router = Router();

router.use(verifyFirebaseToken, requireShop);

/**
 * POST /api/v1/transactions/:txnId/media
 * Upload files for a transaction.
 * Accepts multiple fields: aadhaar_front, aadhaar_back, pan, invoice,
 *                          customer_photo, device_image, warranty, other
 */
router.post(
  '/transactions/:txnId/media',
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
 * GET /api/v1/media/:mediaId
 * Serve a protected file — ownership verified before streaming.
 */
router.get(
  '/:mediaId',
  [param('mediaId').isUUID()],
  validate,
  serveMedia
);

/**
 * DELETE /api/v1/media/:mediaId
 * Delete a media file.
 */
router.delete(
  '/:mediaId',
  [param('mediaId').isUUID()],
  validate,
  deleteMedia
);

module.exports = router;
