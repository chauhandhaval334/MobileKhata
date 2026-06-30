'use strict';

const { Router } = require('express');
const { query } = require('../config/database');

const router = Router();

/**
 * GET /api/v1/catalog
 * Returns full brand & model catalog formatted as JSON array for Android app.
 */
router.get('/', async (req, res) => {
  try {
    const brandsRes = await query('SELECT * FROM catalog_brands ORDER BY name ASC');
    const modelsRes = await query('SELECT * FROM catalog_models ORDER BY name ASC');
    
    // Group models by brand_id
    const modelsByBrand = {};
    for (const model of modelsRes.rows) {
      if (!modelsByBrand[model.brand_id]) {
        modelsByBrand[model.brand_id] = [];
      }
      modelsByBrand[model.brand_id].push(model.name);
    }
    
    const catalog = brandsRes.rows.map(brand => ({
      brand: brand.name,
      models: modelsByBrand[brand.id] || []
    }));
    
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
