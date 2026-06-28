'use strict';

/**
 * Migration: Add Feedback & Improvement Center tables.
 * Run: node src/migrate_add_feedback.js
 */

require('dotenv').config();
const { query } = require('./config/database');
const logger = require('./utils/logger');

async function migrate() {
  logger.info('Running migration: Feedback & Improvement Center...');

  // ── 1. Ticket Number Sequence ────────────────────────────────────────────────
  await query(`
    CREATE SEQUENCE IF NOT EXISTS feedback_ticket_seq
      START WITH 1
      INCREMENT BY 1
      NO MAXVALUE
      CACHE 1;
  `);
  logger.info('✅ Created feedback_ticket_seq sequence');

  // ── 2. feedback_tickets ───────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS feedback_tickets (
      id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      ticket_number     TEXT        NOT NULL UNIQUE,          -- MK-2026-000245
      shop_id           UUID        REFERENCES shops(id) ON DELETE SET NULL,

      -- Feedback content
      feedback_type     TEXT        NOT NULL DEFAULT 'other'
                        CHECK (feedback_type IN (
                          'bug_report','feature_request','improvement',
                          'ui_ux','performance','payment_issue',
                          'premium_issue','report_issue','sync_issue','other'
                        )),
      subject           TEXT        NOT NULL DEFAULT '',
      description       TEXT        NOT NULL DEFAULT '',

      -- Admin management
      status            TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','under_review','in_progress','resolved','closed')),
      priority          TEXT        NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('critical','high','medium','low')),

      -- Auto-collected device & app info
      app_version       TEXT        NOT NULL DEFAULT '',
      app_version_code  TEXT        NOT NULL DEFAULT '',
      android_version   TEXT        NOT NULL DEFAULT '',
      device_brand      TEXT        NOT NULL DEFAULT '',
      device_model      TEXT        NOT NULL DEFAULT '',
      screen_resolution TEXT        NOT NULL DEFAULT '',
      app_language      TEXT        NOT NULL DEFAULT '',
      subscription_status TEXT      NOT NULL DEFAULT '',   -- free | premium
      login_account     TEXT        NOT NULL DEFAULT '',   -- phone number
      firebase_uid      TEXT        NOT NULL DEFAULT '',

      -- Timestamps
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at       TIMESTAMPTZ DEFAULT NULL,
      closed_at         TIMESTAMPTZ DEFAULT NULL
    );
  `);
  logger.info('✅ Created feedback_tickets table');

  // ── 3. feedback_attachments ──────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS feedback_attachments (
      id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      ticket_id       UUID        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
      shop_id         UUID        REFERENCES shops(id) ON DELETE SET NULL,
      firebase_url    TEXT        NOT NULL DEFAULT '',
      file_name       TEXT        NOT NULL DEFAULT '',
      mime_type       TEXT        NOT NULL DEFAULT '',
      file_size_bytes INTEGER     NOT NULL DEFAULT 0,
      attachment_type TEXT        NOT NULL DEFAULT 'document'
                      CHECK (attachment_type IN ('screenshot','video','voice','document')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  logger.info('✅ Created feedback_attachments table');

  // ── 4. feedback_replies ──────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS feedback_replies (
      id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      ticket_id     UUID        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
      sender_type   TEXT        NOT NULL CHECK (sender_type IN ('user','admin')),
      sender_label  TEXT        NOT NULL DEFAULT '',   -- phone / "Support Team"
      message       TEXT        NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  logger.info('✅ Created feedback_replies table');

  // ── 5. feedback_notes (internal admin only) ──────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS feedback_notes (
      id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      ticket_id  UUID        NOT NULL REFERENCES feedback_tickets(id) ON DELETE CASCADE,
      admin_uid  TEXT        NOT NULL DEFAULT '',
      note       TEXT        NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  logger.info('✅ Created feedback_notes table');

  // ── 6. Indexes ──────────────────────────────────────────────────────────────
  await query(`
    CREATE INDEX IF NOT EXISTS idx_feedback_tickets_shop_id    ON feedback_tickets(shop_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_tickets_status     ON feedback_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_tickets_priority   ON feedback_tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_feedback_tickets_type       ON feedback_tickets(feedback_type);
    CREATE INDEX IF NOT EXISTS idx_feedback_tickets_created_at ON feedback_tickets(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feedback_attachments_ticket ON feedback_attachments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_replies_ticket     ON feedback_replies(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_notes_ticket       ON feedback_notes(ticket_id);
  `);
  logger.info('✅ Created indexes');

  // ── 7. Auto updated_at trigger ───────────────────────────────────────────────
  await query(`
    DROP TRIGGER IF EXISTS trg_feedback_tickets_updated_at ON feedback_tickets;
    CREATE TRIGGER trg_feedback_tickets_updated_at
      BEFORE UPDATE ON feedback_tickets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);
  logger.info('✅ Added updated_at trigger');

  logger.info('✅ Migration completed! Feedback & Improvement Center is ready.');
  process.exit(0);
}

migrate().catch(err => {
  logger.error('Migration failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
