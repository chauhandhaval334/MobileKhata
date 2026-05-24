'use strict';

const { Router } = require('express');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { getSummaryReport, getDailyReport } = require('../controllers/reportController');

const router = Router();

router.use(verifyFirebaseToken, requireShop);

/** GET /api/v1/reports/summary?from=&to=&type= */
router.get('/summary', getSummaryReport);

/** GET /api/v1/reports/daily?date= */
router.get('/daily', getDailyReport);

module.exports = router;
