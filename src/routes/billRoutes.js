'use strict';

/**
 * Unified Bill Book Sync & Management Routes
 * Base: /api/v1/bills
 * All routes require Firebase token + shop scope
 */

const { Router }  = require('express');
const { body, query: qv } = require('express-validator');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { validate }  = require('../middleware/validate');
const { query: db } = require('../config/database');
const R           = require('../utils/response');
const logger      = require('../utils/logger');

const router = Router();
router.use(verifyFirebaseToken, requireShop);

// ── GET /pull ────────────────────────────────────────────────────────────────
// Server -> Android Delta Sync
router.get(
  '/pull',
  [qv('since').optional().isNumeric()],
  validate,
  async (req, res) => {
    try {
      const shopId = req.shop.id;
      const since  = parseInt(req.query.since) || 0;

      const result = await db(
        `SELECT * FROM bills
         WHERE shop_id = $1 AND (EXTRACT(EPOCH FROM updated_at) * 1000) > $2
         ORDER BY created_at_millis ASC`,
        [shopId, since]
      );

      return R.success(res, result.rows);
    } catch (err) {
      logger.error('pullBills error', { error: err.message });
      return R.error(res, 'Failed to pull bills');
    }
  }
);

// ── POST /push ────────────────────────────────────────────────────────────────
// Android -> Server Sync (inserts or updates bills)
router.post(
  '/push',
  [
    body('bills').isArray().withMessage('Bills must be an array'),
    body('bills.*.androidBillId').isNumeric(),
    body('bills.*.billNumber').trim().notEmpty(),
    body('bills.*.customerName').trim().notEmpty(),
    body('bills.*.customerMobile').trim().notEmpty(),
    body('bills.*.grandTotal').isFloat({ min: 0 }),
    body('bills.*.createdAtMillis').isNumeric(),
  ],
  validate,
  async (req, res) => {
    try {
      const shopId = req.shop.id;
      const { bills } = req.body;
      const syncedIds = [];

      for (const bill of bills) {
        // Upsert bill record using (shop_id, android_bill_id)
        const result = await db(
          `INSERT INTO bills (
             android_bill_id, shop_id, bill_number, bill_type, source_module, payment_status,
             customer_name, customer_mobile, customer_address, customer_gstin,
             items_json, subtotal, tax_percent, tax_amount, discount_amount, grand_total,
             payment_method, template_type, timeline_json, created_at_millis, updated_at
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, NOW())
           ON CONFLICT (shop_id, android_bill_id) DO UPDATE SET
             bill_number      = EXCLUDED.bill_number,
             bill_type        = EXCLUDED.bill_type,
             source_module    = EXCLUDED.source_module,
             payment_status   = EXCLUDED.payment_status,
             customer_name    = EXCLUDED.customer_name,
             customer_mobile  = EXCLUDED.customer_mobile,
             customer_address = EXCLUDED.customer_address,
             customer_gstin   = EXCLUDED.customer_gstin,
             items_json       = EXCLUDED.items_json,
             subtotal         = EXCLUDED.subtotal,
             tax_percent      = EXCLUDED.tax_percent,
             tax_amount       = EXCLUDED.tax_amount,
             discount_amount  = EXCLUDED.discount_amount,
             grand_total      = EXCLUDED.grand_total,
             payment_method   = EXCLUDED.payment_method,
             template_type    = EXCLUDED.template_type,
             timeline_json    = EXCLUDED.timeline_json,
             updated_at       = NOW()
           RETURNING remote_id, android_bill_id`,
          [
            parseInt(bill.androidBillId), shopId, bill.billNumber, bill.billType || 'Invoice',
            bill.sourceModule || 'manual', bill.paymentStatus || 'Paid',
            bill.customerName, bill.customerMobile, bill.customerAddress || '', bill.customerGstin || '',
            bill.itemsJson || '[]', parseFloat(bill.subtotal || 0), parseFloat(bill.taxPercent || 0),
            parseFloat(bill.taxAmount || 0), parseFloat(bill.discountAmount || 0), parseFloat(bill.grandTotal),
            bill.paymentMethod || 'Cash', bill.templateType || 'Simple', bill.timelineJson || '[]',
            parseInt(bill.createdAtMillis)
          ]
        );
        
        syncedIds.push({
          androidBillId: parseInt(result.rows[0].android_bill_id),
          remoteUuid: result.rows[0].remote_id
        });
      }

      return R.success(res, syncedIds, 'Bills synced successfully');
    } catch (err) {
      logger.error('pushBills error', { error: err.message });
      return R.error(res, 'Failed to sync push bills');
    }
  }
);

// ── GET / ────────────────────────────────────────────────────────────────────
// Search/Filter Bills on Backend (Admin or general query)
router.get('/', async (req, res) => {
  try {
    const shopId = req.shop.id;
    const { status, source, from, to, search } = req.query;

    let where = 'WHERE shop_id = $1';
    const params = [shopId];
    let pIdx = 2;

    if (status) {
      where += ` AND payment_status = $${pIdx++}`;
      params.push(status);
    }
    if (source) {
      where += ` AND source_module = $${pIdx++}`;
      params.push(source);
    }
    if (from) {
      where += ` AND created_at_millis >= $${pIdx++}`;
      params.push(from);
    }
    if (to) {
      where += ` AND created_at_millis <= $${pIdx++}`;
      params.push(to);
    }
    if (search) {
      where += ` AND (bill_number ILIKE $${pIdx} OR customer_name ILIKE $${pIdx} OR customer_mobile ILIKE $${pIdx} OR items_json ILIKE $${pIdx})`;
      params.push(`%${search}%`);
      pIdx++;
    }

    const result = await db(
      `SELECT * FROM bills ${where} ORDER BY created_at_millis DESC`,
      params
    );

    return R.success(res, result.rows);
  } catch (err) {
    logger.error('queryBills error', { error: err.message });
    return R.error(res, 'Failed to load bills');
  }
});

// ── PATCH /:id/status ─────────────────────────────────────────────────────────
// Update bill payment status and update timeline log
router.patch(
  '/:id/status',
  [body('status').isIn(['Draft','Paid','Unpaid','Partial Payment','Cancelled'])],
  validate,
  async (req, res) => {
    try {
      const shopId = req.shop.id;
      const { id } = req.params;
      const { status } = req.body;

      const billRes = await db(
        `SELECT timeline_json FROM bills WHERE id = $1 AND shop_id = $2`, [id, shopId]
      );
      if (!billRes.rows[0]) return R.notFound(res, 'Bill not found');

      let timeline = [];
      try {
        timeline = JSON.parse(billRes.rows[0].timeline_json || '[]');
      } catch (_) {}

      timeline.push({
        status: status,
        timestamp: Date.now(),
        remarks: `Payment Status updated to ${status} by user`
      });

      const updated = await db(
        `UPDATE bills
         SET payment_status = $1, timeline_json = $2, updated_at = NOW()
         WHERE id = $3 AND shop_id = $4
         RETURNING *`,
        [status, JSON.stringify(timeline), id, shopId]
      );

      return R.success(res, updated.rows[0], 'Payment status updated');
    } catch (err) {
      logger.error('updateBillStatus error', { error: err.message });
      return R.error(res, 'Failed to update status');
    }
  }
);

module.exports = router;
