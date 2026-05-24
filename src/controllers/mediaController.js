'use strict';

const path = require('path');
const fs = require('fs');
const { query, withTransaction } = require('../config/database');
const { success, created, notFound, forbidden } = require('../utils/response');
const { getRelativePath, getAbsolutePath, deleteFile } = require('../services/uploadService');
const logger = require('../utils/logger');

/**
 * POST /api/v1/transactions/:txnId/media
 * Upload one or more files for a transaction.
 * Files are stored outside web root — never publicly accessible.
 * Field names must match category values:
 *   aadhaar_front, aadhaar_back, pan, invoice,
 *   customer_photo, device_image, warranty, other
 */
const uploadMedia = async (req, res) => {
  const shopId = req.shop.id;
  const { txnId } = req.params;

  // Verify transaction belongs to this shop
  const txnCheck = await query(
    'SELECT id FROM transactions WHERE id=$1 AND shop_id=$2',
    [txnId, shopId]
  );
  if (txnCheck.rows.length === 0) {
    return notFound(res, 'Transaction not found');
  }

  if (!req.files || Object.keys(req.files).length === 0) {
    return success(res, [], 'No files uploaded');
  }

  // req.files is an object keyed by fieldname when using upload.fields()
  const uploadedFiles = [];
  const allFiles = Object.entries(req.files).flatMap(([fieldname, files]) =>
    files.map((f) => ({ ...f, category: fieldname }))
  );

  await withTransaction(async (client) => {
    for (const file of allFiles) {
      const relativePath = getRelativePath(file.path);
      const result = await client.query(
        `INSERT INTO transaction_media
           (transaction_id, shop_id, file_path, file_name, mime_type, file_size_bytes, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, file_name, category, mime_type, file_size_bytes, created_at`,
        [txnId, shopId, relativePath, file.originalname,
         file.mimetype, file.size, file.category]
      );
      uploadedFiles.push(result.rows[0]);
    }
  });

  logger.info('Media uploaded', { txnId, shopId, count: uploadedFiles.length });
  return created(res, uploadedFiles, `${uploadedFiles.length} file(s) uploaded`);
};

/**
 * GET /api/v1/media/:mediaId
 * Serve a protected file — verifies ownership before streaming.
 * Files are never served directly from disk by the web server.
 */
const serveMedia = async (req, res) => {
  const shopId = req.shop.id;
  const { mediaId } = req.params;

  const result = await query(
    'SELECT * FROM transaction_media WHERE id=$1 AND shop_id=$2',
    [mediaId, shopId]
  );
  if (result.rows.length === 0) {
    return notFound(res, 'Media not found');
  }

  const media = result.rows[0];
  const absolutePath = getAbsolutePath(media.file_path);

  if (!fs.existsSync(absolutePath)) {
    return notFound(res, 'File not found on server');
  }

  // Set content-disposition to inline for images, attachment for docs
  const isImage = media.mime_type.startsWith('image/');
  res.setHeader('Content-Type', media.mime_type);
  res.setHeader(
    'Content-Disposition',
    `${isImage ? 'inline' : 'attachment'}; filename="${media.file_name}"`
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  return res.sendFile(absolutePath);
};

/**
 * DELETE /api/v1/media/:mediaId
 * Delete a media file — verifies ownership.
 */
const deleteMedia = async (req, res) => {
  const shopId = req.shop.id;
  const { mediaId } = req.params;

  const result = await query(
    'DELETE FROM transaction_media WHERE id=$1 AND shop_id=$2 RETURNING file_path',
    [mediaId, shopId]
  );
  if (result.rows.length === 0) {
    return notFound(res, 'Media not found');
  }

  deleteFile(result.rows[0].file_path);
  logger.info('Media deleted', { mediaId, shopId });
  return success(res, null, 'File deleted');
};

module.exports = { uploadMedia, serveMedia, deleteMedia };
