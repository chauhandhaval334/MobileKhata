'use strict';

/**
 * Shared utility helpers used across controllers.
 */

/**
 * Mask Aadhaar number — show only last 4 digits.
 * "123456789012" → "XXXX-XXXX-9012"
 * @param {string} aadhaar
 * @returns {string}
 */
const maskAadhaar = (aadhaar) => {
  if (!aadhaar || aadhaar.length < 4) return '';
  return `XXXX-XXXX-${aadhaar.slice(-4)}`;
};

/**
 * Parse pagination query params with safe defaults.
 * @param {object} query — req.query
 * @returns {{ page: number, limit: number, offset: number }}
 */
const parsePagination = (query, defaultLimit = 20, maxLimit = 100) => {
  const page  = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
};

/**
 * Convert Android millisecond timestamp to ISO string.
 * @param {number|string} millis
 * @returns {string} ISO date string
 */
const millisToIso = (millis) => {
  const ms = parseInt(millis, 10);
  return isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
};

/**
 * Convert ISO/Date to milliseconds (for Android sync responses).
 * @param {Date|string} date
 * @returns {number}
 */
const isoToMillis = (date) => new Date(date).getTime();

/**
 * Sanitize a string — trim and remove any null bytes.
 * @param {string} str
 * @returns {string}
 */
const sanitizeStr = (str) =>
  typeof str === 'string' ? str.trim().replace(/\0/g, '') : '';

/**
 * Build a standard paginated meta object.
 * @param {number} total
 * @param {number} page
 * @param {number} limit
 */
const buildPaginationMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  hasNext: page * limit < total,
  hasPrev: page > 1,
});

/**
 * Validate IMEI using Luhn algorithm.
 * @param {string} imei
 * @returns {boolean}
 */
const isValidImei = (imei) => {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = parseInt(imei[i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

module.exports = {
  maskAadhaar,
  parsePagination,
  millisToIso,
  isoToMillis,
  sanitizeStr,
  buildPaginationMeta,
  isValidImei,
};
