'use strict';

const { Router } = require('express');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { listCustomers, getCustomerByMobile } = require('../controllers/customerController');

const router = Router();

router.use(verifyFirebaseToken, requireShop);

/** GET /api/v1/customers */
router.get('/', listCustomers);

/** GET /api/v1/customers/:mobile */
router.get('/:mobile', getCustomerByMobile);

module.exports = router;
