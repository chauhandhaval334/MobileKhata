'use strict';

/**
 * Feedback Routes — User-facing
 * Base: /api/v1/feedback
 * All routes require Firebase auth + shop
 */

const { Router }  = require('express');
const { body }    = require('express-validator');
const { verifyFirebaseToken, requireShop } = require('../middleware/auth');
const { validate }  = require('../middleware/validate');
const { query: db } = require('../config/database');
const R           = require('../utils/response');
const logger      = require('../utils/logger');

const router = Router();
router.use(verifyFirebaseToken, requireShop);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate ticket number: MK-YYYY-NNNNNN */
async function generateTicketNumber() {
  const year = new Date().getFullYear();
  const res  = await db(`SELECT nextval('feedback_ticket_seq') AS n`);
  const n    = String(res.rows[0].n).padStart(6, '0');
  return `MK-${year}-${n}`;
}

const VALID_TYPES = [
  'bug_report','feature_request','improvement',
  'ui_ux','performance','payment_issue',
  'premium_issue','report_issue','sync_issue','other'
];

// ── POST /api/v1/feedback ─────────────────────────────────────────────────────
// Submit a new feedback ticket
router.post(
  '/',
  [
    body('feedbackType').isIn(VALID_TYPES).withMessage('Invalid feedback type'),
    body('subject').trim().notEmpty().isLength({ max: 200 }),
    body('description').trim().notEmpty().isLength({ max: 5000 }),
    body('appVersion').optional().trim().isLength({ max: 50 }),
    body('appVersionCode').optional().trim().isLength({ max: 20 }),
    body('androidVersion').optional().trim().isLength({ max: 30 }),
    body('deviceBrand').optional().trim().isLength({ max: 60 }),
    body('deviceModel').optional().trim().isLength({ max: 100 }),
    body('screenResolution').optional().trim().isLength({ max: 30 }),
    body('appLanguage').optional().trim().isLength({ max: 10 }),
    body('subscriptionStatus').optional().trim().isIn(['free','premium','']),
    body('loginAccount').optional().trim().isLength({ max: 20 }),
    body('attachments').optional().isArray({ max: 10 }),
    body('attachments.*.firebaseUrl').optional().trim().isURL(),
    body('attachments.*.fileName').optional().trim().isLength({ max: 255 }),
    body('attachments.*.mimeType').optional().trim().isLength({ max: 100 }),
    body('attachments.*.fileSizeBytes').optional().isInt({ min: 0, max: 52428800 }), // 50MB
    body('attachments.*.attachmentType').optional().isIn(['screenshot','video','voice','document']),
  ],
  validate,
  async (req, res) => {
    try {
      const shopId = req.shop.id;
      const {
        feedbackType, subject, description,
        appVersion = '', appVersionCode = '',
        androidVersion = '', deviceBrand = '', deviceModel = '',
        screenResolution = '', appLanguage = '',
        subscriptionStatus = '', loginAccount = '',
        attachments = []
      } = req.body;

      const ticketNumber = await generateTicketNumber();

      // Insert ticket
      const ticketRes = await db(
        `INSERT INTO feedback_tickets
           (ticket_number, shop_id, feedback_type, subject, description,
            app_version, app_version_code, android_version, device_brand, device_model,
            screen_resolution, app_language, subscription_status, login_account, firebase_uid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          ticketNumber, shopId, feedbackType, subject, description,
          appVersion, appVersionCode, androidVersion, deviceBrand, deviceModel,
          screenResolution, appLanguage, subscriptionStatus, loginAccount,
          req.user.uid
        ]
      );
      const ticket = ticketRes.rows[0];

      // Insert attachments
      if (attachments.length > 0) {
        for (const att of attachments) {
          await db(
            `INSERT INTO feedback_attachments
               (ticket_id, shop_id, firebase_url, file_name, mime_type, file_size_bytes, attachment_type)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              ticket.id, shopId,
              att.firebaseUrl || '', att.fileName || '', att.mimeType || '',
              att.fileSizeBytes || 0, att.attachmentType || 'document'
            ]
          );
        }
      }

      logger.info('Feedback submitted', { ticketNumber, shopId, feedbackType });
      return R.created(res, {
        ticketId:     ticket.id,
        ticketNumber: ticket.ticket_number,
        status:       ticket.status,
        createdAt:    ticket.created_at,
      }, `Feedback submitted. Your ticket ID: ${ticketNumber}`);

    } catch (err) {
      logger.error('submitFeedback error', { error: err.message });
      return R.error(res, 'Failed to submit feedback');
    }
  }
);

// ── GET /api/v1/feedback ──────────────────────────────────────────────────────
// List user's own tickets
router.get('/', async (req, res) => {
  try {
    const shopId = req.shop.id;
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const countRes = await db(
      `SELECT COUNT(*) AS total FROM feedback_tickets WHERE shop_id = $1`, [shopId]
    );
    const total = parseInt(countRes.rows[0].total);

    const rows = await db(
      `SELECT
         t.id, t.ticket_number, t.feedback_type, t.subject, t.status, t.priority,
         t.created_at, t.updated_at, t.resolved_at, t.closed_at,
         (SELECT COUNT(*) FROM feedback_replies r WHERE r.ticket_id = t.id) AS reply_count,
         (SELECT COUNT(*) FROM feedback_attachments a WHERE a.ticket_id = t.id) AS attachment_count,
         (SELECT r.message FROM feedback_replies r
           WHERE r.ticket_id = t.id AND r.sender_type = 'admin'
           ORDER BY r.created_at DESC LIMIT 1) AS last_admin_reply
       FROM feedback_tickets t
       WHERE t.shop_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [shopId, limit, offset]
    );

    return R.paginate(res, rows.rows, total, page, limit);
  } catch (err) {
    logger.error('getMyFeedback error', { error: err.message });
    return R.error(res, 'Failed to load feedback');
  }
});

// ── GET /api/v1/feedback/:ticketId ────────────────────────────────────────────
// Get single ticket with replies and attachments
router.get('/:ticketId', async (req, res) => {
  try {
    const shopId   = req.shop.id;
    const { ticketId } = req.params;

    const ticketRes = await db(
      `SELECT * FROM feedback_tickets WHERE id = $1 AND shop_id = $2`,
      [ticketId, shopId]
    );
    if (!ticketRes.rows[0]) return R.notFound(res, 'Ticket not found');
    const ticket = ticketRes.rows[0];

    const [attachRes, repliesRes] = await Promise.all([
      db(`SELECT * FROM feedback_attachments WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticketId]),
      db(`SELECT * FROM feedback_replies WHERE ticket_id = $1 ORDER BY created_at ASC`, [ticketId]),
    ]);

    return R.success(res, {
      ticket,
      attachments: attachRes.rows,
      replies:     repliesRes.rows,
    });
  } catch (err) {
    logger.error('getFeedbackDetail error', { error: err.message });
    return R.error(res, 'Failed to load ticket');
  }
});

// ── POST /api/v1/feedback/:ticketId/reply ────────────────────────────────────
// User adds a reply to a thread
router.post(
  '/:ticketId/reply',
  [body('message').trim().notEmpty().isLength({ max: 3000 })],
  validate,
  async (req, res) => {
    try {
      const shopId   = req.shop.id;
      const { ticketId } = req.params;
      const { message }  = req.body;

      const ticketRes = await db(
        `SELECT id, status, login_account FROM feedback_tickets WHERE id = $1 AND shop_id = $2`,
        [ticketId, shopId]
      );
      if (!ticketRes.rows[0]) return R.notFound(res, 'Ticket not found');
      const ticket = ticketRes.rows[0];

      // If ticket was closed, reopen on user reply
      if (ticket.status === 'closed') {
        await db(`UPDATE feedback_tickets SET status='open', closed_at=NULL WHERE id=$1`, [ticketId]);
      }

      const senderLabel = ticket.login_account || req.user.uid.slice(0, 8);
      const replyRes = await db(
        `INSERT INTO feedback_replies (ticket_id, sender_type, sender_label, message)
         VALUES ($1,'user',$2,$3) RETURNING *`,
        [ticketId, senderLabel, message]
      );

      return R.created(res, replyRes.rows[0], 'Reply sent');
    } catch (err) {
      logger.error('userReply error', { error: err.message });
      return R.error(res, 'Failed to send reply');
    }
  }
);

// ── PATCH /api/v1/feedback/:ticketId/reopen ───────────────────────────────────
// User reopens a resolved/closed ticket
router.patch('/:ticketId/reopen', async (req, res) => {
  try {
    const shopId   = req.shop.id;
    const { ticketId } = req.params;

    const ticketRes = await db(
      `SELECT id, status FROM feedback_tickets WHERE id = $1 AND shop_id = $2`,
      [ticketId, shopId]
    );
    if (!ticketRes.rows[0]) return R.notFound(res, 'Ticket not found');
    if (!['resolved','closed'].includes(ticketRes.rows[0].status)) {
      return R.badRequest(res, 'Only resolved or closed tickets can be reopened');
    }

    await db(
      `UPDATE feedback_tickets
       SET status='open', resolved_at=NULL, closed_at=NULL
       WHERE id=$1`,
      [ticketId]
    );

    return R.success(res, { ticketId, status: 'open' }, 'Ticket reopened');
  } catch (err) {
    logger.error('reopenTicket error', { error: err.message });
    return R.error(res, 'Failed to reopen ticket');
  }
});

module.exports = router;
