'use strict';

/**
 * Standardised API response helpers.
 * All responses follow the same envelope shape for Android client consistency.
 *
 * Success: { success: true,  data: {...},    message: "...", meta: {...} }
 * Error:   { success: false, error: "...",   code: "ERROR_CODE" }
 */

const success = (res, data = null, message = 'OK', statusCode = 200, meta = null) => {
  const body = { success: true, message };
  if (data !== null) body.data = data;
  if (meta !== null) body.meta = meta;
  return res.status(statusCode).json(body);
};

const created = (res, data, message = 'Created') =>
  success(res, data, message, 201);

const error = (res, message = 'Internal server error', statusCode = 500, code = 'INTERNAL_ERROR') =>
  res.status(statusCode).json({ success: false, error: message, code });

const badRequest = (res, message = 'Bad request', code = 'BAD_REQUEST') =>
  error(res, message, 400, code);

const unauthorized = (res, message = 'Unauthorized', code = 'UNAUTHORIZED') =>
  error(res, message, 401, code);

const forbidden = (res, message = 'Forbidden', code = 'FORBIDDEN') =>
  error(res, message, 403, code);

const notFound = (res, message = 'Not found', code = 'NOT_FOUND') =>
  error(res, message, 404, code);

const conflict = (res, message = 'Conflict', code = 'CONFLICT') =>
  error(res, message, 409, code);

const paginate = (res, rows, total, page, limit) =>
  success(res, rows, 'OK', 200, {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });

module.exports = { success, created, error, badRequest, unauthorized, forbidden, notFound, conflict, paginate };
