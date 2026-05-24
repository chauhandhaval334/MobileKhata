'use strict';

const { validationResult } = require('express-validator');
const { badRequest } = require('../utils/response');

/**
 * validate
 * ────────
 * Middleware factory — place after express-validator chain.
 * Collects all validation errors and returns a structured 400 response.
 *
 * Usage:
 *   router.post('/entries', [...validators], validate, controller)
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => `${e.path}: ${e.msg}`).join('; ');
    return badRequest(res, messages, 'VALIDATION_ERROR');
  }
  return next();
};

module.exports = { validate };
