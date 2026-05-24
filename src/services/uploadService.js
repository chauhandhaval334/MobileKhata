'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const logger = require('../utils/logger');

/**
 * File category → subdirectory mapping.
 * Files are stored OUTSIDE public web root for security.
 * Served only via signed/authenticated API routes.
 */
const CATEGORY_DIRS = {
  aadhaar_front:    'aadhaar',
  aadhaar_back:     'aadhaar',
  pan:              'pan',
  invoice:          'invoices',
  customer_photo:   'customer_photos',
  device_image:     'device_images',
  warranty:         'invoices',
  other:            'documents',
};

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/**
 * Ensure all upload subdirectories exist on startup.
 */
const initUploadDirs = () => {
  const dirs = [...new Set(Object.values(CATEGORY_DIRS))];
  dirs.forEach((dir) => {
    const fullPath = path.join(env.uploads.dir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      logger.info(`Created upload directory: ${fullPath}`);
    }
  });
};

/**
 * Multer disk storage — resolves subdirectory from field name.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const category = file.fieldname;
    const subDir = CATEGORY_DIRS[category] || CATEGORY_DIRS.other;
    const destDir = path.join(env.uploads.dir, subDir);

    // Ensure directory exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    cb(null, destDir);
  },

  filename: (req, file, cb) => {
    // Format: {shopId}_{uuid}.{ext}  — no original filename (prevents path traversal)
    const shopId = req.shop?.id || 'unknown';
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) ? ext : '.bin';
    const filename = `${shopId}_${uuidv4()}${safeExt}`;
    cb(null, filename);
  },
});

/**
 * File filter — only allow image and PDF files.
 */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.uploads.maxFileSizeMb * 1024 * 1024,
    files: 10, // max 10 files per request
  },
});

/**
 * Get relative path for DB storage (relative to uploads root).
 * @param {string} absolutePath
 * @returns {string} relative path like "aadhaar/shopId_uuid.jpg"
 */
const getRelativePath = (absolutePath) => {
  return path.relative(env.uploads.dir, absolutePath);
};

/**
 * Delete a file from disk.
 * @param {string} relativePath — relative path from uploads root
 */
const deleteFile = (relativePath) => {
  try {
    const fullPath = path.join(env.uploads.dir, relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      logger.info('Deleted file', { path: relativePath });
    }
  } catch (err) {
    logger.error('Failed to delete file', { path: relativePath, error: err.message });
  }
};

/**
 * Get absolute path for serving a file.
 * @param {string} relativePath
 * @returns {string}
 */
const getAbsolutePath = (relativePath) => {
  return path.join(env.uploads.dir, relativePath);
};

module.exports = {
  upload,
  initUploadDirs,
  getRelativePath,
  deleteFile,
  getAbsolutePath,
  CATEGORY_DIRS,
};
