'use strict';

const { admin } = require('../config/firebase');
const { query } = require('../config/database');
const { unauthorized, forbidden } = require('../utils/response');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * verifyFirebaseToken
 * ──────────────────
 * Extracts the Bearer token from Authorization header,
 * verifies it against Firebase Admin SDK,
 * and attaches decoded user info to req.user.
 *
 * Then looks up the shop record from our DB using firebase_uid.
 * Attaches req.shop for downstream use in controllers.
 */
const verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'Missing or malformed Authorization header');
    }

    const token = authHeader.split('Bearer ')[1];

    // Verify token with Firebase Admin
    const decoded = await admin.auth().verifyIdToken(token); // signature-only verification

    req.user = {
      uid: decoded.uid,
      phone: decoded.phone_number || '',
      email: decoded.email || '',
    };

    // Load shop record for this Firebase UID
    const shopResult = await query(
      'SELECT * FROM shops WHERE firebase_uid = $1 AND is_active = TRUE LIMIT 1',
      [decoded.uid]
    );

    if (shopResult.rows.length === 0) {
      // User authenticated but hasn't completed shop setup yet
      // Allow through with req.shop = null — setup endpoints handle this
      req.shop = null;
    } else {
      req.shop = shopResult.rows[0];
    }

    return next();
  } catch (err) {
    logger.warn('Auth middleware rejected request', {
      error: err.code || err.message,
      ip: req.ip,
    });

    if (err.code === 'auth/id-token-expired') {
      return unauthorized(res, 'Token expired — refresh and retry', 'TOKEN_EXPIRED');
    }
    if (err.code === 'auth/id-token-revoked') {
      return unauthorized(res, 'Token revoked — please sign in again', 'TOKEN_REVOKED');
    }
    return unauthorized(res, 'Invalid authentication token');
  }
};

/**
 * requireShop
 * ──────────
 * Must be used AFTER verifyFirebaseToken.
 * Rejects request if shop profile is not set up yet.
 */
const requireShop = (req, res, next) => {
  if (!req.shop) {
    return forbidden(res, 'Shop profile not set up. Complete onboarding first.', 'SHOP_NOT_SETUP');
  }

  // Active Device validation ONLY for v2 routes
  const isV2 = (req.baseUrl && req.baseUrl.startsWith('/api/v2')) || (req.path && req.path.startsWith('/api/v2'));
  if (isV2) {
    const incomingDeviceId = req.headers['x-device-id'];
    const activeDeviceId = req.shop.active_device_id;

    if (activeDeviceId && incomingDeviceId && incomingDeviceId !== activeDeviceId) {
      logger.warn('Session conflict: request from inactive device', {
        shopId: req.shop.id,
        incomingDeviceId,
        activeDeviceId
      });
      res.setHeader('X-Session-Invalid', 'another_device');
      return unauthorized(res, 'Your account has been logged in on another device.', 'SESSION_INVALID_ANOTHER_DEVICE');
    }

    // If no active device is set yet, register this one
    if (!activeDeviceId && incomingDeviceId) {
      query('UPDATE shops SET active_device_id = $1, updated_at = NOW() WHERE id = $2', [incomingDeviceId, req.shop.id])
        .catch(err => logger.error('Failed to auto-set active device ID', { error: err.message }));
      req.shop.active_device_id = incomingDeviceId;
    }
  }

  return next();
};

const requireShopV2 = requireShop;

/**
 * requireAdmin
 * ────────────
 * Must be used AFTER verifyFirebaseToken.
 * Only allows requests from Firebase UIDs listed in ADMIN_UIDS env variable.
 * Admin can access all shops' data — never expose to regular shopkeepers.
 *
 * Usage in .env:
 *   ADMIN_UIDS=firebase_uid_1,firebase_uid_2
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.uid) {
    return unauthorized(res, 'Authentication required');
  }
  if (!env.adminUids.includes(req.user.uid)) {
    logger.warn('Admin access denied', { uid: req.user.uid, ip: req.ip });
    return forbidden(res, 'Admin access required', 'ADMIN_REQUIRED');
  }
  return next();
};

module.exports = { verifyFirebaseToken, requireShop, requireShopV2, requireAdmin };
