'use strict';

const express = require('express');
const router = express.Router();
const websiteController = require('../controllers/websiteController');

router.get('/', websiteController.getWebsiteConfig);

module.exports = router;
