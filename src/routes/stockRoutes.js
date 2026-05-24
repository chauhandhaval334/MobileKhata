'use strict';

const { Router } = require('express');
const { param } = require('express-validator');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { getCurrentStock, checkImeiStock } = require('../controllers/stockController');

const router = Router();

router.use(verifyFirebaseToken, requireShop);

/** GET /api/v1/stock */
router.get('/', getCurrentStock);

/** GET /api/v1/stock/check/:imei */
router.get(
  '/check/:imei',
  [param('imei').trim().notEmpty()],
  validate,
  checkImeiStock
);

module.exports = router;
