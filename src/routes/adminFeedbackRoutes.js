'use strict';

/**
 * Admin Feedback Routes
 * Base: /api/v2/admin/feedback
 * All routes require Firebase admin auth (handled by adminRoutesV2 middleware)
 */

const { Router }    = require('express');
const { body, query: qv } = require('express-validator');
const { validate }  = require('../middleware/validate');
const { query: db } = require('../config/database');
const R             = require('../utils/response');
const logger        = require('../utils/logger');
const admin         = require('firebase-admin');

const router = Router();

const VALID_STATUSES   = ['open','under_review','in_progress','resolved','closed'];
const VALID_PRIORITIES = ['critical','high','medium','low'];
const VALID_TYPES      = [
  'bug_report','feature_request','improvement','ui_ux','performance',
  'payment_issue','premium_issue','report_issue','sync_issue','other'
];

// ── GET /stats ────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [total, byStatus, today, byType, byPriority] = await Promise.all([
      db(`SELECT COUNT(*) AS n FROM feedback_tickets`),
      db(`SELECT status, COUNT(*) AS n FROM feedback_tickets GROUP BY status`),
      db(`SELECT COUNT(*) AS n FROM feedback_tickets WHERE created_at >= CURRENT_DATE`),
      db(`SELECT feedback_type, COUNT(*) AS n FROM feedback_tickets GROUP BY feedback_type ORDER BY n DESC`),
      db(`SELECT priority, COUNT(*) AS n FROM feedback_tickets GROUP BY priority`),
    ]);

    const statusMap = {};
    byStatus.rows.forEach(r => { statusMap[r.status] = parseInt(r.n); });

    return R.success(res, {
      total:       parseInt(total.rows[0].n),
      open:        statusMap['open']        || 0,
      under_review: statusMap['under_review'] || 0,
      in_progress:  statusMap['in_progress']  || 0,
      resolved:    statusMap['resolved']    || 0,
      closed:      statusMap['closed']      || 0,
      today:       parseInt(today.rows[0].n),
      byType:      byType.rows,
      byPriority:  byPriority.rows,
    });
  } catch (err) {
    logger.error('feedbackStats error', { error: err.message });
    return R.error(res, 'Failed to load stats');
  }
});

// ── GET /analytics ────────────────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const [
      topBugs, topFeatures, avgResolution, trendLast30,
      topDevices, topAndroid, premiumVsFree
    ] = await Promise.all([
      db(`SELECT subject, COUNT(*) AS n FROM feedback_tickets
          WHERE feedback_type='bug_report' GROUP BY subject ORDER BY n DESC LIMIT 10`),
      db(`SELECT subject, COUNT(*) AS n FROM feedback_tickets
          WHERE feedback_type='feature_request' GROUP BY subject ORDER BY n DESC LIMIT 10`),
      db(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600),1) AS avg_hours
          FROM feedback_tickets WHERE resolved_at IS NOT NULL`),
      db(`SELECT DATE(created_at) AS day, COUNT(*) AS n
          FROM feedback_tickets
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY day ORDER BY day`),
      db(`SELECT device_model, COUNT(*) AS n FROM feedback_tickets
          WHERE device_model != '' GROUP BY device_model ORDER BY n DESC LIMIT 10`),
      db(`SELECT android_version, COUNT(*) AS n FROM feedback_tickets
          WHERE android_version != '' GROUP BY android_version ORDER BY n DESC LIMIT 10`),
      db(`SELECT subscription_status, COUNT(*) AS n FROM feedback_tickets
          WHERE subscription_status != '' GROUP BY subscription_status`),
    ]);

    return R.success(res, {
      topBugs:        topBugs.rows,
      topFeatures:    topFeatures.rows,
      avgResolutionHours: parseFloat(avgResolution.rows[0]?.avg_hours) || 0,
      trendLast30:    trendLast30.rows,
      topDevices:     topDevices.rows,
      topAndroidVersions: topAndroid.rows,
      premiumVsFree:  premiumVsFree.rows,
    });
  } catch (err) {
    logger.error('feedbackAnalytics error', { error: err.message });
    return R.error(res, 'Failed to load analytics');
  }
});

// ── GET /export ───────────────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { format = 'csv', status, feedbackType, priority, from, to } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let pIdx = 1;

    if (status)       { whereClause += ` AND t.status = $${pIdx++}`;        params.push(status); }
    if (feedbackType) { whereClause += ` AND t.feedback_type = $${pIdx++}`; params.push(feedbackType); }
    if (priority)     { whereClause += ` AND t.priority = $${pIdx++}`;      params.push(priority); }
    if (from)         { whereClause += ` AND t.created_at >= $${pIdx++}`;   params.push(from); }
    if (to)           { whereClause += ` AND t.created_at <= $${pIdx++}`;   params.push(to + 'T23:59:59Z'); }

    const rows = await db(
      `SELECT
         t.ticket_number, s.shop_name, s.owner_name, s.phone_number,
         t.feedback_type, t.subject, t.priority, t.status,
         t.app_version, t.android_version, t.device_brand, t.device_model,
         t.subscription_status, t.login_account,
         t.created_at, t.updated_at, t.resolved_at
       FROM feedback_tickets t
       LEFT JOIN shops s ON s.id = t.shop_id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT 5000`,
      params
    );

    if (format === 'csv') {
      const headers = [
        'Ticket No','Shop Name','Owner','Phone','Type','Subject',
        'Priority','Status','App Version','Android','Device Brand',
        'Device Model','Subscription','Account','Submitted','Updated','Resolved'
      ];
      const lines = [headers.join(',')];
      rows.rows.forEach(r => {
        lines.push([
          r.ticket_number, `"${(r.shop_name||'').replace(/"/g,'""')}"`,
          `"${(r.owner_name||'').replace(/"/g,'""')}"`, r.phone_number,
          r.feedback_type, `"${(r.subject||'').replace(/"/g,'""')}"`,
          r.priority, r.status, r.app_version, r.android_version,
          r.device_brand, r.device_model, r.subscription_status,
          r.login_account,
          r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '',
          r.updated_at ? new Date(r.updated_at).toLocaleString('en-IN') : '',
          r.resolved_at ? new Date(r.resolved_at).toLocaleString('en-IN') : '',
        ].join(','));
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="feedback_export_${Date.now()}.csv"`);
      return res.send(lines.join('\n'));
    }

    // Default: JSON
    return R.success(res, rows.rows);
  } catch (err) {
    logger.error('feedbackExport error', { error: err.message });
    return R.error(res, 'Failed to export');
  }
});

// ── GET / — List all tickets with filters + pagination ────────────────────────
router.get('/', async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;

    const {
      status, feedbackType, priority, subscription,
      appVersion, androidVersion, deviceBrand, deviceModel,
      from, to, search
    } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    let pIdx = 1;

    if (status)        { where += ` AND t.status = $${pIdx++}`;           params.push(status); }
    if (feedbackType)  { where += ` AND t.feedback_type = $${pIdx++}`;    params.push(feedbackType); }
    if (priority)      { where += ` AND t.priority = $${pIdx++}`;         params.push(priority); }
    if (subscription)  { where += ` AND t.subscription_status = $${pIdx++}`; params.push(subscription); }
    if (appVersion)    { where += ` AND t.app_version = $${pIdx++}`;      params.push(appVersion); }
    if (androidVersion){ where += ` AND t.android_version = $${pIdx++}`;  params.push(androidVersion); }
    if (deviceBrand)   { where += ` AND t.device_brand ILIKE $${pIdx++}`; params.push(`%${deviceBrand}%`); }
    if (deviceModel)   { where += ` AND t.device_model ILIKE $${pIdx++}`; params.push(`%${deviceModel}%`); }
    if (from)          { where += ` AND t.created_at >= $${pIdx++}`;      params.push(from); }
    if (to)            { where += ` AND t.created_at <= $${pIdx++}`;      params.push(to + 'T23:59:59Z'); }
    if (search)        {
      where += ` AND (t.ticket_number ILIKE $${pIdx} OR t.subject ILIKE $${pIdx} OR s.shop_name ILIKE $${pIdx} OR s.phone_number ILIKE $${pIdx})`;
      params.push(`%${search}%`); pIdx++;
    }

    const countRes = await db(
      `SELECT COUNT(*) AS total FROM feedback_tickets t LEFT JOIN shops s ON s.id=t.shop_id ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].total);

    const countParams  = [...params];
    const rowParams    = [...params, limit, offset];

    const rows = await db(
      `SELECT
         t.id, t.ticket_number, t.feedback_type, t.subject,
         t.status, t.priority, t.subscription_status,
         t.app_version, t.android_version, t.device_brand, t.device_model,
         t.created_at, t.updated_at,
         s.shop_name, s.owner_name, s.phone_number,
         (SELECT COUNT(*) FROM feedback_replies r WHERE r.ticket_id=t.id) AS reply_count,
         (SELECT COUNT(*) FROM feedback_attachments a WHERE a.ticket_id=t.id) AS attachment_count
       FROM feedback_tickets t
       LEFT JOIN shops s ON s.id = t.shop_id
       ${where}
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         t.created_at DESC
       LIMIT $${pIdx} OFFSET $${pIdx+1}`,
      rowParams
    );

    return R.paginate(res, rows.rows, total, page, limit);
  } catch (err) {
    logger.error('adminListFeedback error', { error: err.message });
    return R.error(res, 'Failed to load feedback list');
  }
});

// ── GET /:ticketId — Full ticket details ──────────────────────────────────────
router.get('/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;

    const [ticketRes, attachRes, repliesRes, notesRes, prevTickets] = await Promise.all([
      db(`SELECT t.*, s.shop_name, s.owner_name, s.phone_number, s.shop_address
          FROM feedback_tickets t LEFT JOIN shops s ON s.id=t.shop_id
          WHERE t.id=$1`, [ticketId]),
      db(`SELECT * FROM feedback_attachments WHERE ticket_id=$1 ORDER BY created_at ASC`, [ticketId]),
      db(`SELECT * FROM feedback_replies WHERE ticket_id=$1 ORDER BY created_at ASC`, [ticketId]),
      db(`SELECT * FROM feedback_notes WHERE ticket_id=$1 ORDER BY created_at DESC`, [ticketId]),
      db(`SELECT ticket_number, feedback_type, status, created_at
          FROM feedback_tickets
          WHERE shop_id=(SELECT shop_id FROM feedback_tickets WHERE id=$1) AND id!=$1
          ORDER BY created_at DESC LIMIT 5`, [ticketId]),
    ]);

    if (!ticketRes.rows[0]) return R.notFound(res, 'Ticket not found');

    return R.success(res, {
      ticket:       ticketRes.rows[0],
      attachments:  attachRes.rows,
      replies:      repliesRes.rows,
      notes:        notesRes.rows,
      prevTickets:  prevTickets.rows,
    });
  } catch (err) {
    logger.error('adminGetTicket error', { error: err.message });
    return R.error(res, 'Failed to load ticket');
  }
});

// ── PATCH /:ticketId/status ───────────────────────────────────────────────────
router.patch(
  '/:ticketId/status',
  [body('status').isIn(VALID_STATUSES)],
  validate,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { status }   = req.body;

      let extra = '';
      if (status === 'resolved') extra = `, resolved_at = NOW()`;
      if (status === 'closed')   extra = `, closed_at = NOW()`;
      if (status === 'open')     extra = `, resolved_at = NULL, closed_at = NULL`;

      const upd = await db(
        `UPDATE feedback_tickets SET status=$1${extra} WHERE id=$2 RETURNING id,ticket_number,status`,
        [status, ticketId]
      );
      if (!upd.rows[0]) return R.notFound(res, 'Ticket not found');

      // Push notification to user when resolved/closed
      if (['resolved','closed'].includes(status)) {
        try {
          const shopRes = await db(
            `SELECT s.fcm_token FROM shops s
             INNER JOIN feedback_tickets t ON t.shop_id=s.id WHERE t.id=$1`, [ticketId]
          );
          const token = shopRes.rows[0]?.fcm_token;
          if (token) {
            await admin.messaging().send({
            token,
            notification: {
              title: status === 'resolved' ? '✅ Ticket Resolved' : '🔒 Ticket Closed',
              body: `Your ticket ${upd.rows[0].ticket_number} has been ${status}.`
            },
            data: { ticketId, type: 'feedback_status' }
          });
          }
        } catch (_) { /* non-fatal */ }
      }

      return R.success(res, upd.rows[0], `Status updated to ${status}`);
    } catch (err) {
      logger.error('changeStatus error', { error: err.message });
      return R.error(res, 'Failed to update status');
    }
  }
);

// ── PATCH /:ticketId/priority ─────────────────────────────────────────────────
router.patch(
  '/:ticketId/priority',
  [body('priority').isIn(VALID_PRIORITIES)],
  validate,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { priority } = req.body;
      const upd = await db(
        `UPDATE feedback_tickets SET priority=$1 WHERE id=$2 RETURNING id,ticket_number,priority`,
        [priority, ticketId]
      );
      if (!upd.rows[0]) return R.notFound(res, 'Ticket not found');
      return R.success(res, upd.rows[0], `Priority set to ${priority}`);
    } catch (err) {
      logger.error('changePriority error', { error: err.message });
      return R.error(res, 'Failed to update priority');
    }
  }
);

// ── POST /:ticketId/reply — Admin reply (+ FCM push) ──────────────────────────
router.post(
  '/:ticketId/reply',
  [body('message').trim().notEmpty().isLength({ max: 3000 })],
  validate,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { message }  = req.body;

      const ticketRes = await db(
        `SELECT t.ticket_number, s.fcm_token
         FROM feedback_tickets t LEFT JOIN shops s ON s.id=t.shop_id
         WHERE t.id=$1`, [ticketId]
      );
      if (!ticketRes.rows[0]) return R.notFound(res, 'Ticket not found');

      // Set status to under_review if was open
      await db(
        `UPDATE feedback_tickets SET status=CASE WHEN status='open' THEN 'under_review' ELSE status END WHERE id=$1`,
        [ticketId]
      );

      const replyRes = await db(
        `INSERT INTO feedback_replies (ticket_id, sender_type, sender_label, message)
         VALUES ($1,'admin','Support Team',$2) RETURNING *`,
        [ticketId, message]
      );

      // FCM push
      const fcmToken = ticketRes.rows[0].fcm_token;
      if (fcmToken) {
        try {
          await admin.messaging().send({
            token: fcmToken,
            notification: {
              title: '💬 Reply from MobileKhata Support',
              body: message.length > 80 ? message.slice(0, 77) + '...' : message,
            },
            data: { ticketId, type: 'feedback_reply' }
          });
        } catch (_) { /* non-fatal */ }
      }

      return R.created(res, replyRes.rows[0], 'Reply sent to user');
    } catch (err) {
      logger.error('adminReply error', { error: err.message });
      return R.error(res, 'Failed to send reply');
    }
  }
);

// ── POST /:ticketId/note — Internal admin note ────────────────────────────────
router.post(
  '/:ticketId/note',
  [body('note').trim().notEmpty().isLength({ max: 2000 })],
  validate,
  async (req, res) => {
    try {
      const { ticketId }  = req.params;
      const { note }      = req.body;
      const adminUid      = req.user?.uid || 'admin';

      const noteRes = await db(
        `INSERT INTO feedback_notes (ticket_id, admin_uid, note) VALUES ($1,$2,$3) RETURNING *`,
        [ticketId, adminUid, note]
      );
      return R.created(res, noteRes.rows[0], 'Note added');
    } catch (err) {
      logger.error('addNote error', { error: err.message });
      return R.error(res, 'Failed to add note');
    }
  }
);

// ── DELETE /:ticketId ─────────────────────────────────────────────────────────
router.delete('/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;
    const del = await db(
      `DELETE FROM feedback_tickets WHERE id=$1 RETURNING ticket_number`, [ticketId]
    );
    if (!del.rows[0]) return R.notFound(res, 'Ticket not found');
    return R.success(res, { deleted: del.rows[0].ticket_number }, 'Ticket deleted');
  } catch (err) {
    logger.error('deleteTicket error', { error: err.message });
    return R.error(res, 'Failed to delete ticket');
  }
});

module.exports = router;
